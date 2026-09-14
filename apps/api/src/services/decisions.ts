/**
 * Human decisions on approvals and clarifications (specs/001 US2, FR-012..FR-015, research R11–R13). Distinct from
 * the agent ingestion path: a session user, role-gated with `canDecide`, one READ COMMITTED transaction that locks the
 * workflow row and then the item row (`SELECT … FOR UPDATE`, the ingestion lock order) so an item is resolved exactly once — a later caller receives the recorded outcome
 * as a 409 `already-resolved` Problem. Writes the decision, the workflow transition out of WAITING_FOR_HUMAN via the
 * 0001 state machine, an `audit_events` row; the existing triggers append the inbox change for SSE.
 */
import {
  PROBLEM_TYPES,
  answerIsValid,
  canDecide,
  canTransition,
  decisionAllowed,
  requiresConfirmation,
  resultingState,
  type AnswerRequest,
  type ApproveRequest,
  type AuditAction,
  type RejectRequest,
  type Resolution,
  type RiskLevel,
  type WorkflowState,
} from '@cdevi/contracts';
import type pg from 'pg';
import { ProblemError, problems } from '../lib/problem';
import {
  isPending,
  loadDecisionRow,
  resolutionOf,
  type CenterScope,
  type DecisionRow,
} from './approval-center';
import type { SessionUser } from './auth';
import { loadStages, syncWorkflowStagePointer } from './workflow-detail';

export class AlreadyResolvedError extends ProblemError {
  constructor(public readonly resolution: Resolution) {
    super(
      409,
      PROBLEM_TYPES.alreadyResolved,
      'Already resolved',
      `This item was already ${resolution.outcome} by ${resolution.by.name}.`,
      undefined,
      { resolution },
    );
    this.name = 'AlreadyResolvedError';
  }
}

export type DecisionInput =
  | { kind: 'approve'; body: ApproveRequest }
  | { kind: 'reject'; body: RejectRequest }
  | { kind: 'answer'; body: AnswerRequest };

/** Applies one decision inside the caller's transaction; returns the item id (for re-reading the detail). */
export async function applyDecision(
  client: pg.PoolClient,
  user: SessionUser,
  scope: CenterScope,
  id: string,
  input: DecisionInput,
  now: Date,
): Promise<string> {
  if (!canDecide(user.role))
    throw problems.forbidden(
      `Your role (${user.role}) may not decide approvals or clarifications.`,
    );
  const row = await loadDecisionRow(client, scope, id, true);
  const expectedKind = input.kind === 'answer' ? 'clarification' : 'approval';
  if (!row || row.kind !== expectedKind)
    throw problems.notFound("This item isn't available to you.");
  if (!isPending(row)) {
    const resolution = resolutionOf(row);
    if (resolution) throw new AlreadyResolvedError(resolution);
    throw problems.invalidTransition('This item has already been resolved.');
  }
  if (!decisionAllowed(row.workflow_state, true))
    throw problems.invalidTransition(
      `Cannot decide an item whose workflow is ${row.workflow_state}.`,
    );

  let to: WorkflowState;
  let action: AuditAction;
  let reason: string;
  let details: Record<string, unknown>;
  const who = user.displayName;

  if (input.kind === 'approve') {
    if (requiresConfirmation(row.risk_level) && !input.body.confirmed)
      throw problems.validation([
        {
          path: 'confirmed',
          message: `${row.risk_level} risk: confirm the action to approve it`,
        },
      ]);
    to = resultingState({ kind: 'approve' });
    action = 'approval.approved';
    reason = `Approved by ${who}`;
    details = { ask: row.ask };
    await client.query(
      `UPDATE approvals SET decision = 'approved', decided_at = $2, decided_by = $3, decided_by_user_id = $4 WHERE id = $1`,
      [row.id, now, who, user.id],
    );
  } else if (input.kind === 'reject') {
    to = resultingState({ kind: 'reject', target: input.body.target });
    action = 'approval.rejected';
    reason = `Rejected by ${who}: ${input.body.reason}`;
    details = { ask: row.ask, reason: input.body.reason, target: input.body.target };
    await client.query(
      `UPDATE approvals SET decision = 'rejected', decided_at = $2, decided_by = $3, decided_by_user_id = $4,
              rejection_reason = $5, rejection_target = $6 WHERE id = $1`,
      [row.id, now, who, user.id, input.body.reason, input.body.target],
    );
  } else {
    const v = answerIsValid(input.body, row.options);
    if (!v.ok) throw problems.validation([{ path: v.path, message: v.message }]);
    to = resultingState({ kind: 'answer' });
    action = 'clarification.answered';
    reason = `Answered by ${who}: ${v.text}`;
    details = { question: row.ask, answerOption: v.option, answerText: v.text };
    await client.query(
      `UPDATE clarifications SET answered_at = $2, answered_by = $3, answered_by_user_id = $4, answer_option = $5, answer_text = $6 WHERE id = $1`,
      [row.id, now, who, user.id, v.option, v.text],
    );
  }

  await transitionWorkflow(client, scope.organizationId, user, row, to, reason, now);
  await client.query(
    `INSERT INTO audit_events (organization_id, project_id, workflow_id, actor_type, actor_id, actor_name, action, target_type, target_id, risk_level, policy, result, details, occurred_at)
     VALUES ($1,$2,$3,'user',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      scope.organizationId,
      row.project_id,
      row.workflow_id,
      user.id,
      who,
      action,
      row.kind,
      row.id,
      row.risk_level as RiskLevel | null,
      requiresConfirmation(row.risk_level) ? 'explicit-confirmation' : null,
      to,
      JSON.stringify(details),
      now,
    ],
  );
  return row.id;
}

/**
 * Moves the workflow (and any stage waiting on this item) out of WAITING_FOR_HUMAN with the 0001 state machine.
 * `state_observed_at` is the monotonic clock ingestion compares against, so the transition is stamped no earlier than
 * the clocks it replaces; the decision and audit rows keep the request time.
 */
async function transitionWorkflow(
  client: pg.PoolClient,
  organizationId: string,
  user: SessionUser,
  row: DecisionRow,
  to: WorkflowState,
  reason: string,
  now: Date,
): Promise<void> {
  const from = row.workflow_state;
  if (!canTransition(from, to))
    throw problems.invalidTransition(`Cannot move a ${from} workflow to ${to}.`);
  const finished = to === 'CANCELLED';
  const waiting = (await loadStages(client, row.workflow_id)).filter(
    (s) => s.state === 'WAITING_FOR_HUMAN' && canTransition(s.state, to),
  );
  const linked = waiting.filter((s) =>
    row.kind === 'approval' ? s.approvalId === row.id : s.clarificationId === row.id,
  );
  // Stages that reference another pending item keep waiting; an item with no linked stage (legacy ingestion) moves
  // the stages that reference nothing.
  const stages = linked.length
    ? linked
    : waiting.filter((s) => s.approvalId == null && s.clarificationId == null);
  const observedAt = new Date(
    Math.max(
      now.getTime(),
      row.workflow_state_observed_at.getTime(),
      ...stages.map((s) => s.stateObservedAt.getTime()),
    ),
  );
  const record = (stageId: string | null, f: WorkflowState, t: WorkflowState) =>
    client.query(
      `INSERT INTO workflow_transitions (organization_id, workflow_id, stage_id, from_state, to_state, observed_at, reason, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [organizationId, row.workflow_id, stageId, f, t, observedAt, reason, user.id],
    );
  for (const s of stages) {
    await client.query(
      `UPDATE workflow_stages SET state = $2, state_observed_at = $3, state_reason = $4,
              started_at = COALESCE(started_at, CASE WHEN $2::workflow_state = 'RUNNING' THEN $3::timestamptz END),
              finished_at = CASE WHEN $5::boolean THEN $3::timestamptz ELSE NULL END
        WHERE id = $1`,
      [s.id, to, observedAt, reason, finished],
    );
    await record(s.id, s.state, to);
  }
  await client.query(
    `UPDATE workflows SET state = $2, state_observed_at = $3, state_reason = $4,
            started_at = COALESCE(started_at, CASE WHEN $2::workflow_state = 'RUNNING' THEN $3::timestamptz END),
            finished_at = CASE WHEN $5::boolean THEN $3::timestamptz ELSE NULL END
      WHERE id = $1`,
    [row.workflow_id, to, observedAt, reason, finished],
  );
  await syncWorkflowStagePointer(client, row.workflow_id);
  await record(null, from, to);
}
