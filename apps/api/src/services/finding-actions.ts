/**
 * Human actions on review findings (specs/001 US6 AS-2..AS-4, FR-021, FR-029, FR-032). Distinct from the ingestion
 * path: a session user gated by `canActOnFinding` (viewer → 403), one READ COMMITTED transaction, exactly once — only
 * an OPEN finding can be acted on, a later caller gets a 409 `invalid-transition` Problem carrying the recorded state
 * (`{ state, dismissedReason?, fixCycleId? }`). Every action writes an append-only `audit_events` row (actor = the
 * session user, target = the finding, details without free text beyond the dismissal reason); the 0007 triggers append
 * the inbox change for SSE.
 *
 * Lock order (the one discipline shared with `review-ingestion.ts`, whose pull request and cycle routes lock the
 * workflow first): resolve the pull request without locking, lock its workflow row, then the pull request row, then
 * the finding row, then the RUNNING review cycle row. Apply Fix also updates the workflow's Review stage through
 * the 0001 state machine (and the workflow's stage pointer), which the per-row triggers of 0001/0002 notify on
 * their own — that write is why the workflow row comes first.
 */
import {
  PROBLEM_TYPES,
  canTransition,
  type ApplyFixBody,
  type CreateIssueBody,
  type DismissFindingBody,
  type FindingActionResult,
  type FindingState,
  type WorkflowState,
} from '@cdevi/contracts';
import {
  blockingOpenCount,
  canActOnFinding,
  canActOnFindingState,
  readyForMerge,
  type FindingLike,
} from '@cdevi/contracts/review-model';
import type pg from 'pg';
import { ProblemError, problems } from '../lib/problem';
import { visibleProjects, type SessionUser } from './auth';
import {
  CYCLE_SELECT,
  FINDING_SELECT,
  toCycleView,
  toFindingView,
  type CycleRow,
  type FindingRow,
} from './review-center';
import { syncWorkflowStagePointer } from './workflow-detail';

export type FindingAction =
  | { kind: 'dismiss'; body: DismissFindingBody }
  | { kind: 'fix'; body: ApplyFixBody }
  | { kind: 'issue'; body: CreateIssueBody };

const AUDIT_ACTIONS = {
  dismiss: 'finding.dismissed',
  fix: 'finding.fix_requested',
  issue: 'finding.issue_requested',
} as const;

const RESULT_STATES: Record<FindingAction['kind'], FindingState> = {
  dismiss: 'DISMISSED',
  fix: 'FIX_REQUESTED',
  issue: 'ISSUE_REQUESTED',
};

const DEFAULT_MAX_ITERATIONS = 5;

interface PullRequestRow {
  id: string;
  project_id: string;
  workflow_id: string;
  review_stage_id: string | null;
}

interface StageRow {
  id: string;
  state: WorkflowState;
  state_observed_at: Date;
}

/** 409 carrying the recorded outcome so a second caller sees what happened first (exactly once). */
export class FindingNotOpenError extends ProblemError {
  constructor(finding: FindingRow) {
    super(
      409,
      PROBLEM_TYPES.invalidTransition,
      'Finding is not open',
      `This finding is already ${finding.state.toLowerCase().replace('_', ' ')}.`,
      undefined,
      {
        state: finding.state,
        ...(finding.dismissed_reason !== null ? { dismissedReason: finding.dismissed_reason } : {}),
        ...(finding.fix_cycle_id !== null ? { fixCycleId: finding.fix_cycle_id } : {}),
      },
    );
    this.name = 'FindingNotOpenError';
  }
}

/** Applies one action inside the caller's transaction and returns the finding, cycle and recomputed readiness. */
export async function applyFindingAction(
  client: pg.PoolClient,
  user: SessionUser,
  pullRequestId: string,
  findingId: string,
  action: FindingAction,
  now: Date,
): Promise<FindingActionResult> {
  if (!canActOnFinding(user.role))
    throw problems.forbidden(
      'Viewers are read-only; ask an engineer or approver to act on findings.',
    );

  const projectIds = (await visibleProjects(client, user)).map((p) => p.id);
  const notFound = () => problems.notFound("This finding isn't available to you.");
  if (projectIds.length === 0) throw notFound();

  // A pull request never changes workflow, so the unlocked read is a stable key for the workflow lock.
  const key = (
    await client.query<{ id: string; workflow_id: string }>(
      `SELECT id, workflow_id FROM pull_requests
        WHERE organization_id = $1 AND id = $2 AND project_id = ANY($3::uuid[])`,
      [user.organizationId, pullRequestId, projectIds],
    )
  ).rows[0];
  if (!key) throw notFound();
  await client.query(`SELECT id FROM workflows WHERE id = $1 FOR UPDATE`, [key.workflow_id]);
  const pr = (
    await client.query<PullRequestRow>(
      `SELECT id, project_id, workflow_id, review_stage_id FROM pull_requests
        WHERE organization_id = $1 AND id = $2 AND project_id = ANY($3::uuid[]) FOR UPDATE`,
      [user.organizationId, pullRequestId, projectIds],
    )
  ).rows[0];
  if (!pr) throw notFound();

  const finding = (
    await client.query<FindingRow>(
      // Only the latest review's findings are shown and actionable; a finding a newer cycle dropped is gone.
      `${FINDING_SELECT} WHERE f.id = $1 AND f.pull_request_id = $2
          AND f.review_id = (SELECT id FROM reviews WHERE pull_request_id = $2 ORDER BY cycle_number DESC LIMIT 1)
        FOR UPDATE OF f`,
      [findingId, pr.id],
    )
  ).rows[0];
  if (!finding) throw notFound();
  if (!canActOnFindingState(finding.state)) throw new FindingNotOpenError(finding);

  let cycle: CycleRow | undefined;
  const details: Record<string, unknown> = { findingExternalId: finding.external_id };
  switch (action.kind) {
    case 'dismiss':
      await client.query(
        `UPDATE review_findings SET state = 'DISMISSED', dismissed_reason = $2, dismissed_by_user_id = $3, dismissed_at = $4 WHERE id = $1`,
        [finding.id, action.body.reason, user.id, now],
      );
      details['reason'] = action.body.reason;
      break;
    case 'issue':
      await client.query(
        `UPDATE review_findings SET state = 'ISSUE_REQUESTED', issue_requested_by_user_id = $2, issue_requested_at = $3 WHERE id = $1`,
        [finding.id, user.id, now],
      );
      break;
    case 'fix':
      cycle = await joinOrCreateCycle(client, user, pr, finding, now);
      await client.query(
        `UPDATE review_findings SET state = 'FIX_REQUESTED', fix_cycle_id = $2 WHERE id = $1`,
        [finding.id, cycle.id],
      );
      await setReviewStageRunning(client, user, pr, finding.external_id, now);
      details['cycleId'] = cycle.id;
      details['cycleNumber'] = cycle.cycle_number;
      details['iteration'] = cycle.iteration;
      break;
  }

  await client.query(
    `INSERT INTO audit_events (organization_id, project_id, workflow_id, actor_type, actor_id, actor_name, action, target_type, target_id, risk_level, policy, result, details, occurred_at)
     VALUES ($1,$2,$3,'user',$4,$5,$6,'review_finding',$7,NULL,NULL,$8,$9,$10)`,
    [
      user.organizationId,
      pr.project_id,
      pr.workflow_id,
      user.id,
      user.displayName,
      AUDIT_ACTIONS[action.kind],
      finding.id,
      RESULT_STATES[action.kind],
      JSON.stringify(details),
      now,
    ],
  );

  const after = (await client.query<FindingRow>(`${FINDING_SELECT} WHERE f.id = $1`, [finding.id]))
    .rows[0]!;
  const siblings = (
    await client.query<FindingLike>(
      `SELECT lane, blocking, state FROM review_findings WHERE review_id = $1`,
      [finding.review_id],
    )
  ).rows;
  return {
    finding: toFindingView(after),
    ...(cycle ? { cycle: toCycleView(cycle) } : {}),
    readyForMerge: readyForMerge(siblings),
    blockingOpenCount: blockingOpenCount(siblings),
  };
}

/**
 * Joins the pull request's RUNNING cycle or opens the next one: cycle_number = max + 1, iteration = last + 1 (409 once
 * the iteration budget of the last cycle is spent), findings_count = findings OPEN or FIX_REQUESTED once this finding
 * is FIX_REQUESTED, fixed_count 0, remaining_count = findings_count. The runtime reports real progress afterwards.
 */
async function joinOrCreateCycle(
  client: pg.PoolClient,
  user: SessionUser,
  pr: PullRequestRow,
  finding: FindingRow,
  now: Date,
): Promise<CycleRow> {
  const running = (
    await client.query<CycleRow>(
      `${CYCLE_SELECT} WHERE c.pull_request_id = $1 AND c.state = 'RUNNING' ORDER BY c.cycle_number DESC LIMIT 1 FOR UPDATE OF c`,
      [pr.id],
    )
  ).rows[0];
  if (running) return running;

  const last = (
    await client.query<{ cycle_number: number; iteration: number; max_iterations: number }>(
      `SELECT cycle_number, iteration, max_iterations FROM review_cycles WHERE pull_request_id = $1 ORDER BY cycle_number DESC LIMIT 1`,
      [pr.id],
    )
  ).rows[0];
  const iteration = (last?.iteration ?? 0) + 1;
  const maxIterations = last?.max_iterations ?? DEFAULT_MAX_ITERATIONS;
  if (iteration > maxIterations)
    throw problems.invalidTransition(
      `The fix-cycle budget of ${maxIterations} iterations is exhausted for this pull request.`,
    );
  // This finding becomes FIX_REQUESTED in the same transaction, so it counts as open here.
  const open = Number(
    (
      await client.query<{ c: string }>(
        `SELECT count(*) c FROM review_findings WHERE review_id = $1 AND (state IN ('OPEN', 'FIX_REQUESTED') OR id = $2)`,
        [finding.review_id, finding.id],
      )
    ).rows[0]!.c,
  );
  const id = (
    await client.query<{ id: string }>(
      `INSERT INTO review_cycles (organization_id, project_id, workflow_id, pull_request_id, cycle_number, findings_count, fixed_count, remaining_count,
                                  iteration, max_iterations, state, requested_by_user_id, started_at, observed_at)
       VALUES ($1,$2,$3,$4,$5,$6,0,$6,$7,$8,'RUNNING',$9,$10,$10) RETURNING id`,
      [
        user.organizationId,
        pr.project_id,
        pr.workflow_id,
        pr.id,
        (last?.cycle_number ?? 0) + 1,
        open,
        iteration,
        maxIterations,
        user.id,
        now,
      ],
    )
  ).rows[0]!.id;
  return (await client.query<CycleRow>(`${CYCLE_SELECT} WHERE c.id = $1`, [id])).rows[0]!;
}

/**
 * Moves the workflow's Review stage to RUNNING the way `transitionWorkflow` (decisions.ts) moves a stage: a
 * `workflow_transitions` row with `user_id` and the reason, the stage pointer re-synced. The stage is the one the
 * runtime linked on the pull request (`review_stage_id`), else the stage named Review; a workflow without one keeps
 * its stages unchanged. A stage already RUNNING is left alone; a stage the 0001 state machine cannot restart
 * (COMPLETED, CANCELLED) is left alone as well — the runtime reports the cycle's outcome through the cycles route.
 */
async function setReviewStageRunning(
  client: pg.PoolClient,
  user: SessionUser,
  pr: PullRequestRow,
  findingExternalId: string,
  now: Date,
): Promise<void> {
  const stage = (
    await client.query<StageRow>(
      `SELECT id, state, state_observed_at FROM workflow_stages
        WHERE workflow_id = $1 AND id = COALESCE($2::uuid, (SELECT id FROM workflow_stages WHERE workflow_id = $1 AND name = 'Review' ORDER BY position LIMIT 1))
        FOR UPDATE`,
      [pr.workflow_id, pr.review_stage_id],
    )
  ).rows[0];
  if (!stage || stage.state === 'RUNNING' || !canTransition(stage.state, 'RUNNING')) return;
  const observedAt = new Date(Math.max(now.getTime(), stage.state_observed_at.getTime()));
  const reason = `Fix requested for finding ${findingExternalId}`;
  await client.query(
    `UPDATE workflow_stages SET state = 'RUNNING', state_observed_at = $2, state_reason = $3,
            started_at = COALESCE(started_at, $2), finished_at = NULL WHERE id = $1`,
    [stage.id, observedAt, reason],
  );
  await client.query(
    `INSERT INTO workflow_transitions (organization_id, workflow_id, stage_id, from_state, to_state, observed_at, reason, user_id)
     VALUES ($1,$2,$3,$4,'RUNNING',$5,$6,$7)`,
    [user.organizationId, pr.workflow_id, stage.id, stage.state, observedAt, reason, user.id],
  );
  await syncWorkflowStagePointer(client, pr.workflow_id);
}
