/**
 * Approval Center read model (specs/001 US2 scenario 1, FR-011/FR-012, data-model.md §14). Pending approvals and
 * clarifications of the visible projects, ordered highest risk first then oldest first (`orderApprovalCenter`).
 * Distinct from the Inbox read model: this is the list a reviewer works through and the decision-screen detail.
 */
import {
  APPROVAL_CENTER_LIMIT,
  AUDIT_LIMIT,
  canDecide,
  decisionAllowed,
  orderApprovalCenter,
  requiresConfirmation,
  type ApprovalCenterDetail,
  type ApprovalCenterItem,
  type ApprovalCenterSnapshot,
  type AuditEventView,
  type ClarificationOption,
  type DecisionLinks,
  type Resolution,
  type RiskLevel,
  type Role,
  type WorkflowState,
} from '@cdevi/contracts';
import type pg from 'pg';

export interface CenterScope {
  organizationId: string;
  projectIds: string[];
  role: Role;
}

interface ItemRow {
  id: string;
  kind: 'approval' | 'clarification';
  workflow_id: string;
  workflow_external_id: string;
  workflow_title: string;
  workflow_state: WorkflowState;
  workflow_state_observed_at: Date;
  project_id: string;
  project_key: string;
  project_name: string;
  ask: string;
  risk_level: RiskLevel | null;
  requested_by: string | null;
  requested_at: Date;
  expires_at: Date | null;
  has_recommended_answer: boolean;
}

/** Full row of one approval or clarification, joined with its workflow and project (either kind by id). */
export interface DecisionRow extends ItemRow {
  context: string | null;
  why_it_matters: string | null;
  options: ClarificationOption[];
  links: DecisionLinks;
  decision: 'approved' | 'rejected' | null;
  decided_at: Date | null;
  decided_by: string | null;
  decided_by_user_id: string | null;
  rejection_reason: string | null;
  rejection_target: 'BLOCKED' | 'CANCELLED' | null;
  answered_at: Date | null;
  answered_by: string | null;
  answered_by_user_id: string | null;
  answer_option: string | null;
  answer_text: string | null;
}

const ITEM_SELECT = `
  SELECT x.id, x.kind, x.workflow_id, w.external_id AS workflow_external_id, w.title AS workflow_title, w.state AS workflow_state,
         w.state_observed_at AS workflow_state_observed_at, p.id AS project_id, p.key AS project_key, p.name AS project_name,
         x.ask, x.risk_level, x.requested_by, x.requested_at, x.expires_at, x.has_recommended_answer,
         x.context, x.why_it_matters, x.options, x.links,
         x.decision, x.decided_at, x.decided_by, x.decided_by_user_id, x.rejection_reason, x.rejection_target,
         x.answered_at, x.answered_by, x.answered_by_user_id, x.answer_option, x.answer_text
    FROM (
      SELECT a.id, 'approval'::text AS kind, a.organization_id, a.project_id, a.workflow_id, a.ask, a.risk_level,
             a.requested_by_agent AS requested_by, a.requested_at, a.expires_at, false AS has_recommended_answer,
             a.context, NULL::text AS why_it_matters, '[]'::jsonb AS options, a.links,
             a.decision, a.decided_at, a.decided_by, a.decided_by_user_id, a.rejection_reason, a.rejection_target,
             NULL::timestamptz AS answered_at, NULL::text AS answered_by, NULL::uuid AS answered_by_user_id,
             NULL::text AS answer_option, NULL::text AS answer_text,
             (a.decision IS NULL) AS pending
        FROM approvals a
      UNION ALL
      SELECT c.id, 'clarification', c.organization_id, c.project_id, c.workflow_id, c.question, NULL::risk_level,
             c.requested_by_agent, c.requested_at, NULL::timestamptz, c.has_recommended_answer,
             NULL::text, c.why_it_matters, c.options, c.links,
             NULL::approval_decision, NULL::timestamptz, NULL::text, NULL::uuid, NULL::text, NULL::workflow_state,
             c.answered_at, c.answered_by, c.answered_by_user_id, c.answer_option, c.answer_text,
             (c.answered_at IS NULL) AS pending
        FROM clarifications c
    ) x
    JOIN workflows w ON w.id = x.workflow_id
    JOIN projects p ON p.id = x.project_id`;

export function toItem(r: ItemRow): ApprovalCenterItem {
  return {
    id: r.id,
    kind: r.kind,
    workflowId: r.workflow_id,
    workflowExternalId: r.workflow_external_id,
    workflowTitle: r.workflow_title,
    project: { id: r.project_id, key: r.project_key, name: r.project_name },
    ask: r.ask,
    riskLevel: r.risk_level,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at.toISOString(),
    expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
    hasRecommendedAnswer: r.has_recommended_answer,
    href: `/approvals/${r.id}`,
  };
}

/** Pending items on WAITING_FOR_HUMAN workflows of the visible (optionally one selected) project(s). */
export async function approvalCenterSnapshot(
  client: pg.PoolClient | pg.Pool,
  scope: CenterScope,
  project: 'all' | string,
  now: Date,
): Promise<ApprovalCenterSnapshot> {
  const projectIds = project === 'all' ? scope.projectIds : [project];
  const rows =
    projectIds.length === 0
      ? []
      : (
          await client.query<ItemRow>(
            `${ITEM_SELECT}
             WHERE x.organization_id = $1 AND x.project_id = ANY($2::uuid[]) AND x.pending AND w.state = 'WAITING_FOR_HUMAN'
             ORDER BY CASE x.risk_level WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END,
                      x.requested_at, x.id
             LIMIT ${APPROVAL_CENTER_LIMIT}`,
            [scope.organizationId, projectIds],
          )
        ).rows;
  const items = rows
    .map((r) => ({
      row: r,
      key: { id: r.id, riskLevel: r.risk_level, requestedAt: r.requested_at },
    }))
    .sort((a, b) => orderApprovalCenter(a.key, b.key))
    .map((x) => toItem(x.row));
  return {
    generatedAt: now.toISOString(),
    project,
    items,
    counts: {
      approvals: items.filter((i) => i.kind === 'approval').length,
      clarifications: items.filter((i) => i.kind === 'clarification').length,
    },
  };
}

/**
 * One item by id (either kind) within the visible projects. With `forUpdate` the workflow row is locked first and
 * the concrete item row second — the same order ingestion and workflow actions use — and the item is re-read under
 * those locks so the caller validates the current workflow state (FR-015).
 */
export async function loadDecisionRow(
  client: pg.PoolClient,
  scope: Pick<CenterScope, 'organizationId' | 'projectIds'>,
  id: string,
  forUpdate = false,
): Promise<DecisionRow | undefined> {
  if (scope.projectIds.length === 0) return undefined;
  const read = async () =>
    (
      await client.query<DecisionRow>(
        `${ITEM_SELECT} WHERE x.organization_id = $1 AND x.id = $2 AND x.project_id = ANY($3::uuid[])`,
        [scope.organizationId, id, scope.projectIds],
      )
    ).rows[0];
  const first = await read();
  if (!first || !forUpdate) return first;
  await client.query(`SELECT id FROM workflows WHERE id = $1 FOR UPDATE`, [first.workflow_id]);
  await client.query(
    `SELECT id FROM ${first.kind === 'approval' ? 'approvals' : 'clarifications'} WHERE id = $1 FOR UPDATE`,
    [first.id],
  );
  return read();
}

/**
 * The recorded outcome of a resolved item. `workflowState` is the state the decision produced (decision-rules.md
 * `resultingState`), not the workflow's current state, so the resolution reads the same after the workflow moves on.
 * Only human decisions (a user id) transition the workflow; an outcome ingested from an agent changes the item alone,
 * so for those the live workflow state is the only record.
 */
export function resolutionOf(r: DecisionRow): Resolution | null {
  if (r.kind === 'approval') {
    if (!r.decision || !r.decided_at) return null;
    const byHuman = r.decided_by_user_id != null;
    return {
      outcome: r.decision,
      by: { id: r.decided_by_user_id, name: r.decided_by ?? 'Unknown' },
      at: r.decided_at.toISOString(),
      answer: null,
      reason: r.rejection_reason,
      target: r.rejection_target,
      workflowState: !byHuman
        ? r.workflow_state
        : r.decision === 'approved'
          ? 'RUNNING'
          : (r.rejection_target ?? r.workflow_state),
    };
  }
  if (!r.answered_at) return null;
  return {
    outcome: 'answered',
    by: { id: r.answered_by_user_id, name: r.answered_by ?? 'Unknown' },
    at: r.answered_at.toISOString(),
    answer: r.answer_text != null ? { option: r.answer_option, text: r.answer_text } : null,
    reason: null,
    target: null,
    workflowState: r.answered_by_user_id != null ? 'RUNNING' : r.workflow_state,
  };
}

export const isPending = (r: DecisionRow): boolean =>
  r.kind === 'approval' ? r.decision == null : r.answered_at == null;

interface AuditDbRow {
  id: string;
  occurred_at: Date;
  actor_type: 'user' | 'agent' | 'system';
  actor_id: string | null;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string;
  risk_level: RiskLevel | null;
  result: string;
  details: Record<string, unknown>;
}

export async function loadAudit(
  client: pg.PoolClient | pg.Pool,
  organizationId: string,
  targetId: string,
): Promise<AuditEventView[]> {
  const r = await client.query<AuditDbRow>(
    `SELECT id, occurred_at, actor_type, actor_id, actor_name, action, target_type, target_id, risk_level, result, details
       FROM audit_events WHERE organization_id = $1 AND target_id = $2
      ORDER BY occurred_at DESC, id DESC LIMIT ${AUDIT_LIMIT}`,
    [organizationId, targetId],
  );
  return r.rows.map((e) => ({
    id: e.id,
    occurredAt: e.occurred_at.toISOString(),
    actor: { type: e.actor_type, id: e.actor_id, name: e.actor_name },
    action: e.action,
    target: { type: e.target_type, id: e.target_id },
    riskLevel: e.risk_level,
    result: e.result,
    details: e.details,
  }));
}

export async function approvalCenterDetail(
  client: pg.PoolClient,
  scope: CenterScope,
  id: string,
): Promise<ApprovalCenterDetail | null> {
  const r = await loadDecisionRow(client, scope, id);
  if (!r) return null;
  return {
    item: toItem(r),
    workflowState: r.workflow_state,
    canDecide: canDecide(scope.role) && decisionAllowed(r.workflow_state, isPending(r)),
    approval:
      r.kind === 'approval'
        ? {
            context: r.context,
            links: r.links,
            requiresConfirmation: requiresConfirmation(r.risk_level),
          }
        : null,
    clarification:
      r.kind === 'clarification'
        ? { whyItMatters: r.why_it_matters, options: r.options, links: r.links }
        : null,
    resolution: resolutionOf(r),
    audit: await loadAudit(client, scope.organizationId, r.id),
  };
}
