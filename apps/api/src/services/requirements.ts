/**
 * Requirements (specs/001 US4, FR-007/FR-009/FR-010/FR-032, research R31–R38). Session-scoped list/detail plus the
 * human mutations: create, submit, approve, reject. Every mutation runs inside the caller's transaction, locks the
 * requirement row (`SELECT … FOR UPDATE`), validates the move with the zod-free state machine, appends a
 * `requirement_transitions` row and an `audit_events` row (risk_level NULL: requirement actions never count as risk).
 * Approving creates the linked workflow with its seven QUEUED stages in the same transaction (R37) — a concurrent
 * approver finds the row no longer READY and receives 409 `invalid-transition`.
 */
import { randomBytes } from 'node:crypto';
import {
  canCreateRequirement,
  canDecide,
  type AuditAction,
  type CreateRequirementRequest,
  type ExternalRef,
  type LinkedWorkflow,
  type RejectRequirementRequest,
  type Requirement,
  type RequirementDetail,
  type RequirementListPage,
  type RequirementListQuery,
  type RequirementState,
  type UserRef,
  type WorkflowState,
} from '@cdevi/contracts';
import { SDLC_STAGES } from '@cdevi/contracts/dashboard-model';
import {
  REQUIREMENTS_PAGE_SIZE,
  canTransitionRequirement,
  decodeRequirementCursor,
  encodeRequirementCursor,
  requirementActions,
  requirementHrefs,
} from '@cdevi/contracts/requirement-rules';
import type pg from 'pg';
import { problems } from '../lib/problem';
import type { SessionUser } from './auth';

export interface RequirementScope {
  organizationId: string;
  /** Visible project ids — administrators see all, others their memberships (research R3). */
  projectIds: string[];
}

const TRANSITIONS_LIMIT = 50;
const AUDIT_LIMIT = 20;

interface ListRow {
  id: string;
  external_id: string;
  project_id: string;
  project_key: string;
  project_name: string;
  title: string;
  state: RequirementState;
  source: 'manual' | 'jira';
  external_ref: ExternalRef | null;
  external_flag: 'deleted' | 'closed' | null;
  external_flagged_at: Date | null;
  assignee_id: string | null;
  assignee_name: string | null;
  created_by_id: string | null;
  created_by_name: string | null;
  created_at: Date;
  updated_at: Date;
  open_question_count: number;
  workflow_id: string | null;
  workflow_external_id: string | null;
  workflow_state: WorkflowState | null;
  workflow_stage_index: number | null;
  workflow_stage_count: number | null;
  workflow_stage_name: string | null;
}

interface DetailRow extends ListRow {
  business_objective: string;
  submitted_by_id: string | null;
  submitted_by_name: string | null;
  submitted_at: Date | null;
  approved_by_id: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
  rejected_by_id: string | null;
  rejected_by_name: string | null;
  rejected_at: Date | null;
  rejection_reason: string | null;
  analysis_observed_at: Date | null;
  analysis_summary: string | null;
}

/** Row locked by every mutation. */
interface LockedRequirement {
  id: string;
  project_id: string;
  external_id: string;
  title: string;
  state: RequirementState;
}

const ROW_COLUMNS = `
  r.id, r.external_id, r.project_id, p.key AS project_key, p.name AS project_name, r.title, r.state, r.source,
  r.external_ref, r.external_flag, r.external_flagged_at,
  a.id AS assignee_id, a.display_name AS assignee_name,
  c.id AS created_by_id, c.display_name AS created_by_name,
  r.created_at, r.updated_at,
  (SELECT count(*)::int FROM requirement_analysis_items i
     WHERE i.requirement_id = r.id AND i.kind = 'open_question') AS open_question_count,
  w.id AS workflow_id, w.external_id AS workflow_external_id, w.state AS workflow_state,
  w.stage_index AS workflow_stage_index, w.stage_count AS workflow_stage_count, w.stage_name AS workflow_stage_name`;

const ROW_JOINS = `
  FROM requirements r
  JOIN projects p ON p.id = r.project_id
  LEFT JOIN users a ON a.id = r.assignee_user_id
  LEFT JOIN users c ON c.id = r.created_by_user_id
  LEFT JOIN workflows w ON w.requirement_id = r.id`;

const userRef = (id: string | null, name: string | null): UserRef | null =>
  id && name ? { id, name } : null;

function linkedWorkflow(r: ListRow): LinkedWorkflow | null {
  if (!r.workflow_id || !r.workflow_external_id || !r.workflow_state) return null;
  return {
    id: r.workflow_id,
    externalId: r.workflow_external_id,
    state: r.workflow_state,
    stage:
      r.workflow_stage_index && r.workflow_stage_count
        ? {
            index: r.workflow_stage_index,
            count: r.workflow_stage_count,
            name: r.workflow_stage_name,
          }
        : null,
    href: requirementHrefs.workflow(r.workflow_id),
  };
}

function toRequirement(r: ListRow): Requirement {
  return {
    id: r.id,
    externalId: r.external_id,
    project: { id: r.project_id, key: r.project_key, name: r.project_name },
    title: r.title,
    state: r.state,
    source: r.source,
    externalRef: r.external_ref,
    externalFlag: r.external_flag,
    externalFlaggedAt: r.external_flagged_at?.toISOString() ?? null,
    assignee: userRef(r.assignee_id, r.assignee_name),
    createdBy: userRef(r.created_by_id, r.created_by_name),
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    openQuestionCount: r.open_question_count,
    workflow: linkedWorkflow(r),
    href: requirementHrefs.requirement(r.id),
  };
}

// ---- list

/** Bounded keyset page over (created_at DESC, id DESC) — requirements_list_idx / _state_idx / _assignee_idx (R38). */
export async function listRequirements(
  client: pg.PoolClient,
  scope: RequirementScope,
  user: SessionUser,
  query: RequirementListQuery,
  now: Date,
): Promise<RequirementListPage> {
  const states = query.state ?? [];
  const assignee = query.assignee ?? null;
  const projectIds =
    query.project === 'all'
      ? scope.projectIds
      : scope.projectIds.includes(query.project)
        ? [query.project]
        : [];
  const empty: RequirementListPage = {
    generatedAt: now.toISOString(),
    project: query.project,
    filters: { state: states, assignee },
    items: [],
    nextCursor: null,
    total: 0,
  };
  if (projectIds.length === 0) return empty;

  const params: unknown[] = [scope.organizationId, projectIds];
  const where = [`r.organization_id = $1`, `r.project_id = ANY($2::uuid[])`];
  if (states.length > 0) {
    params.push(states);
    where.push(`r.state = ANY($${params.length}::requirement_state[])`);
  }
  if (assignee === 'unassigned') where.push(`r.assignee_user_id IS NULL`);
  else if (assignee) {
    params.push(assignee === 'me' ? user.id : assignee);
    where.push(`r.assignee_user_id = $${params.length}`);
  }
  const total = Number(
    (
      await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM requirements r WHERE ${where.join(' AND ')}`,
        params,
      )
    ).rows[0]!.n,
  );
  if (query.cursor) {
    const k = decodeRequirementCursor(query.cursor);
    params.push(k.createdAt, k.id);
    where.push(
      `(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  const rows = await client.query<ListRow>(
    `SELECT ${ROW_COLUMNS} ${ROW_JOINS} WHERE ${where.join(' AND ')}
      ORDER BY r.created_at DESC, r.id DESC LIMIT ${REQUIREMENTS_PAGE_SIZE + 1}`,
    params,
  );
  const page = rows.rows.slice(0, REQUIREMENTS_PAGE_SIZE);
  const last = page.at(-1);
  return {
    ...empty,
    items: page.map(toRequirement),
    nextCursor:
      rows.rows.length > REQUIREMENTS_PAGE_SIZE && last
        ? encodeRequirementCursor({ createdAt: last.created_at.toISOString(), id: last.id })
        : null,
    total,
  };
}

// ---- detail

interface ItemRow {
  id: string;
  kind: 'acceptance_criterion' | 'rule' | 'open_question';
  position: number;
  text: string;
  ai_generated: boolean;
  source: string;
}

interface TransitionRow {
  from_state: RequirementState | null;
  to_state: RequirementState;
  actor_type: 'user' | 'agent' | 'system';
  actor_name: string | null;
  reason: string | null;
  occurred_at: Date;
}

interface AuditRow {
  id: string;
  action: string;
  actor_name: string | null;
  details: Record<string, unknown>;
  risk_level: string | null;
  occurred_at: Date;
}

/** Full detail for one visible requirement, or null when it is not visible (never confirms existence). */
export async function requirementDetail(
  client: pg.PoolClient,
  scope: RequirementScope,
  id: string,
  user: SessionUser,
  now: Date,
): Promise<RequirementDetail | null> {
  if (scope.projectIds.length === 0) return null;
  const head = await client.query<DetailRow>(
    `SELECT ${ROW_COLUMNS}, r.business_objective,
            sb.id AS submitted_by_id, sb.display_name AS submitted_by_name, r.submitted_at,
            ab.id AS approved_by_id, ab.display_name AS approved_by_name, r.approved_at,
            rb.id AS rejected_by_id, rb.display_name AS rejected_by_name, r.rejected_at, r.rejection_reason,
            r.analysis_observed_at, r.analysis_summary
       ${ROW_JOINS}
       LEFT JOIN users sb ON sb.id = r.submitted_by_user_id
       LEFT JOIN users ab ON ab.id = r.approved_by_user_id
       LEFT JOIN users rb ON rb.id = r.rejected_by_user_id
      WHERE r.organization_id = $1 AND r.id = $2 AND r.project_id = ANY($3::uuid[])`,
    [scope.organizationId, id, scope.projectIds],
  );
  const r = head.rows[0];
  if (!r) return null;

  const [items, transitions, audit] = await Promise.all([
    client.query<ItemRow>(
      `SELECT id, kind, position, text, ai_generated, source FROM requirement_analysis_items
        WHERE requirement_id = $1 ORDER BY kind, ai_generated, position`,
      [id],
    ),
    client.query<TransitionRow>(
      `SELECT from_state, to_state, actor_type, actor_name, reason, occurred_at FROM requirement_transitions
        WHERE requirement_id = $1 ORDER BY occurred_at, id LIMIT ${TRANSITIONS_LIMIT}`,
      [id],
    ),
    client.query<AuditRow>(
      `SELECT id, action, actor_name, details, risk_level, occurred_at FROM audit_events
        WHERE organization_id = $1 AND action LIKE 'requirement.%'
          AND (target_id = $2 OR details->>'requirementId' = $2::text)
        ORDER BY occurred_at DESC, id DESC LIMIT ${AUDIT_LIMIT}`,
      [scope.organizationId, id],
    ),
  ]);

  const byKind = (kind: ItemRow['kind']) =>
    items.rows
      .filter((i) => i.kind === kind)
      .map((i) => ({
        id: i.id,
        kind: i.kind,
        position: i.position,
        text: i.text,
        aiGenerated: i.ai_generated,
        source: i.source,
      }));
  const analysis =
    items.rows.length > 0 || r.analysis_observed_at
      ? {
          observedAt: (r.analysis_observed_at ?? r.created_at).toISOString(),
          summary: r.analysis_summary,
          acceptanceCriteria: byKind('acceptance_criterion'),
          rules: byKind('rule'),
          openQuestions: byKind('open_question'),
        }
      : null;
  const rejected = r.state === 'REJECTED' && r.rejected_by_id;
  const decidedBy = rejected
    ? userRef(r.rejected_by_id, r.rejected_by_name)
    : userRef(r.approved_by_id, r.approved_by_name);
  const decidedAt = rejected ? r.rejected_at : r.approved_at;

  return {
    requirement: toRequirement(r),
    businessObjective: r.business_objective,
    analysis,
    submittedBy: userRef(r.submitted_by_id, r.submitted_by_name),
    submittedAt: r.submitted_at?.toISOString() ?? null,
    decidedBy,
    decidedAt: decidedAt?.toISOString() ?? null,
    decisionReason: r.rejection_reason,
    actions: requirementActions(r.state, user.role),
    transitions: transitions.rows.map((t) => ({
      fromState: t.from_state,
      toState: t.to_state,
      actorType: t.actor_type,
      actorName: t.actor_name,
      reason: t.reason,
      occurredAt: t.occurred_at.toISOString(),
    })),
    audit: audit.rows.map((a) => ({
      id: a.id,
      action: a.action,
      actorName: a.actor_name,
      reason: typeof a.details['reason'] === 'string' ? a.details['reason'] : null,
      riskLevel: a.risk_level,
      occurredAt: a.occurred_at.toISOString(),
    })),
    generatedAt: now.toISOString(),
  };
}

// ---- shared write helpers

export async function recordRequirementTransition(
  client: pg.PoolClient,
  organizationId: string,
  requirementId: string,
  from: RequirementState | null,
  to: RequirementState,
  actor: { type: 'user' | 'agent' | 'system'; id: string | null; name: string },
  reason: string | null,
  occurredAt: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO requirement_transitions (organization_id, requirement_id, from_state, to_state, actor_type, actor_id, actor_name, reason, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [organizationId, requirementId, from, to, actor.type, actor.id, actor.name, reason, occurredAt],
  );
}

export interface RequirementAuditInput {
  organizationId: string;
  projectId: string;
  workflowId: string | null;
  actor: { type: 'user' | 'agent' | 'system'; id: string | null; name: string };
  action: AuditAction;
  targetType: 'requirement' | 'workflow';
  targetId: string;
  result: string;
  details: Record<string, unknown>;
  occurredAt: Date;
}

/** Requirement audit rows never carry a risk level (FR-009): the Dashboard risk figure counts approvals only. */
export async function recordRequirementAudit(
  client: pg.PoolClient,
  a: RequirementAuditInput,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (organization_id, project_id, workflow_id, actor_type, actor_id, actor_name, action, target_type, target_id, risk_level, policy, result, details, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,NULL,$10,$11,$12)`,
    [
      a.organizationId,
      a.projectId,
      a.workflowId,
      a.actor.type,
      a.actor.id,
      a.actor.name,
      a.action,
      a.targetType,
      a.targetId,
      a.result,
      JSON.stringify(a.details),
      a.occurredAt,
    ],
  );
}

async function lockRequirement(
  client: pg.PoolClient,
  scope: RequirementScope,
  id: string,
): Promise<LockedRequirement> {
  const r = await client.query<LockedRequirement>(
    `SELECT id, project_id, external_id, title, state FROM requirements
      WHERE organization_id = $1 AND id = $2 AND project_id = ANY($3::uuid[]) FOR UPDATE`,
    [scope.organizationId, id, scope.projectIds],
  );
  const row = r.rows[0];
  if (!row) throw problems.notFound("This requirement isn't available to you.");
  return row;
}

const userActor = (user: SessionUser) => ({
  type: 'user' as const,
  id: user.id,
  name: user.displayName,
});

const newExternalId = () => `req-${randomBytes(6).toString('hex')}`;

// ---- create

/** FR-007: a DRAFT requirement in a visible project; optional human acceptance criteria are labelled `user:<name>`. */
export async function createRequirement(
  client: pg.PoolClient,
  scope: RequirementScope,
  user: SessionUser,
  body: CreateRequirementRequest,
  now: Date,
): Promise<string> {
  if (!canCreateRequirement(user.role))
    throw problems.forbidden(`Your role (${user.role}) may not create requirements.`);
  if (!scope.projectIds.includes(body.projectId))
    throw problems.notFound("That project isn't available to you.");
  if (body.assigneeUserId) {
    const a = await client.query(
      `SELECT 1 FROM users WHERE id = $1 AND organization_id = $2 AND disabled_at IS NULL`,
      [body.assigneeUserId, scope.organizationId],
    );
    if (a.rowCount === 0)
      throw problems.validation([{ path: 'assigneeUserId', message: 'unknown user' }]);
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO requirements (organization_id, project_id, external_id, title, business_objective, state, source, created_by_user_id, assignee_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'DRAFT','manual',$6,$7,$8,$8) RETURNING id`,
    [
      scope.organizationId,
      body.projectId,
      newExternalId(),
      body.title,
      body.businessObjective,
      user.id,
      body.assigneeUserId ?? null,
      now,
    ],
  );
  const id = inserted.rows[0]!.id;
  const criteria = body.acceptanceCriteria.map((t) => t.trim()).filter((t) => t.length > 0);
  if (criteria.length > 0)
    await client.query(
      `INSERT INTO requirement_analysis_items (organization_id, project_id, requirement_id, kind, position, text, ai_generated, source, created_at)
       SELECT $1, $2, $3, 'acceptance_criterion', p.n, p.text, false, $5, $6
         FROM unnest($4::text[]) WITH ORDINALITY AS p(text, n)`,
      [scope.organizationId, body.projectId, id, criteria, `user:${user.displayName}`, now],
    );
  await recordRequirementTransition(
    client,
    scope.organizationId,
    id,
    null,
    'DRAFT',
    userActor(user),
    null,
    now,
  );
  return id;
}

// ---- submit

/** FR-009: DRAFT | NEEDS_CLARIFICATION → ANALYZING; the runtime delivers the analysis through the ingest route. */
export async function submitRequirement(
  client: pg.PoolClient,
  scope: RequirementScope,
  user: SessionUser,
  id: string,
  now: Date,
): Promise<string> {
  if (!canCreateRequirement(user.role))
    throw problems.forbidden(`Your role (${user.role}) may not submit requirements.`);
  const row = await lockRequirement(client, scope, id);
  const to: RequirementState = 'ANALYZING';
  if (!canTransitionRequirement(row.state, to))
    throw problems.invalidTransition(`Cannot submit a ${row.state} requirement for analysis.`);
  await client.query(
    `UPDATE requirements SET state = $2, submitted_by_user_id = $3, submitted_at = $4 WHERE id = $1`,
    [row.id, to, user.id, now],
  );
  const reason = `Submitted for analysis by ${user.displayName}`;
  await recordRequirementTransition(
    client,
    scope.organizationId,
    row.id,
    row.state,
    to,
    userActor(user),
    reason,
    now,
  );
  await recordRequirementAudit(client, {
    organizationId: scope.organizationId,
    projectId: row.project_id,
    workflowId: null,
    actor: userActor(user),
    action: 'requirement.submitted',
    targetType: 'requirement',
    targetId: row.id,
    result: to,
    details: { externalId: row.external_id, from: row.state },
    occurredAt: now,
  });
  return row.id;
}

// ---- approve

/**
 * FR-010 (research R37): READY → APPROVED and the linked workflow — one row, seven QUEUED stages, eight
 * workflow_transitions — in the caller's transaction. Only the requirement is locked: the workflow is new.
 */
export async function approveRequirement(
  client: pg.PoolClient,
  scope: RequirementScope,
  user: SessionUser,
  id: string,
  now: Date,
): Promise<string> {
  if (!canDecide(user.role))
    throw problems.forbidden(`Your role (${user.role}) may not approve requirements.`);
  const row = await lockRequirement(client, scope, id);
  const to: RequirementState = 'APPROVED';
  if (!canTransitionRequirement(row.state, to))
    throw problems.invalidTransition(
      row.state === 'APPROVED'
        ? 'This requirement has already been approved.'
        : `Cannot approve a ${row.state} requirement.`,
    );

  const wf = await client.query<{ id: string }>(
    `INSERT INTO workflows (organization_id, project_id, external_id, title, state, state_observed_at, stage_index, stage_count, stage_name, requirement_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'QUEUED',$5,1,$6,$7,$8,$5,$5) RETURNING id`,
    [
      scope.organizationId,
      row.project_id,
      `wf-${row.external_id}`,
      row.title,
      now,
      SDLC_STAGES.length,
      SDLC_STAGES[0],
      row.id,
    ],
  );
  const workflowId = wf.rows[0]!.id;
  const stages = await client.query<{ id: string }>(
    `INSERT INTO workflow_stages (organization_id, project_id, workflow_id, position, name, state, state_observed_at, created_at, updated_at)
     SELECT $1, $2, $3, s.n, s.name, 'QUEUED', $5, $5, $5 FROM unnest($4::text[]) WITH ORDINALITY AS s(name, n)
     RETURNING id`,
    [scope.organizationId, row.project_id, workflowId, [...SDLC_STAGES], now],
  );
  const reason = `Requirement ${row.external_id} approved by ${user.displayName}`;
  await client.query(
    `INSERT INTO workflow_transitions (organization_id, workflow_id, stage_id, from_state, to_state, observed_at, reason, user_id)
     SELECT $1::uuid, $2::uuid, s.id, NULL::workflow_state, 'QUEUED'::workflow_state, $4::timestamptz, $5::text, $6::uuid
     FROM unnest($3::uuid[]) AS s(id)
     UNION ALL
     SELECT $1::uuid, $2::uuid, NULL::uuid, NULL::workflow_state, 'QUEUED'::workflow_state, $4::timestamptz, $5::text, $6::uuid`,
    [scope.organizationId, workflowId, stages.rows.map((s) => s.id), now, reason, user.id],
  );

  await client.query(
    `UPDATE requirements SET state = $2, approved_by_user_id = $3, approved_at = $4 WHERE id = $1`,
    [row.id, to, user.id, now],
  );
  await recordRequirementTransition(
    client,
    scope.organizationId,
    row.id,
    row.state,
    to,
    userActor(user),
    `Approved by ${user.displayName}`,
    now,
  );
  const base = {
    organizationId: scope.organizationId,
    projectId: row.project_id,
    workflowId,
    actor: userActor(user),
    occurredAt: now,
  };
  await recordRequirementAudit(client, {
    ...base,
    action: 'requirement.approved',
    targetType: 'requirement',
    targetId: row.id,
    result: to,
    details: { externalId: row.external_id, workflowExternalId: `wf-${row.external_id}` },
  });
  await recordRequirementAudit(client, {
    ...base,
    action: 'requirement.workflow_created',
    targetType: 'workflow',
    targetId: workflowId,
    result: 'QUEUED',
    details: {
      requirementId: row.id,
      externalId: `wf-${row.external_id}`,
      stages: SDLC_STAGES.length,
    },
  });
  return row.id;
}

// ---- reject

/** FR-032: DRAFT | NEEDS_CLARIFICATION | READY → REJECTED with a mandatory reason. */
export async function rejectRequirement(
  client: pg.PoolClient,
  scope: RequirementScope,
  user: SessionUser,
  id: string,
  body: RejectRequirementRequest,
  now: Date,
): Promise<string> {
  if (!canDecide(user.role))
    throw problems.forbidden(`Your role (${user.role}) may not reject requirements.`);
  const row = await lockRequirement(client, scope, id);
  const to: RequirementState = 'REJECTED';
  if (!canTransitionRequirement(row.state, to))
    throw problems.invalidTransition(`Cannot reject a ${row.state} requirement.`);
  await client.query(
    `UPDATE requirements SET state = $2, rejected_by_user_id = $3, rejected_at = $4, rejection_reason = $5 WHERE id = $1`,
    [row.id, to, user.id, now, body.reason],
  );
  await recordRequirementTransition(
    client,
    scope.organizationId,
    row.id,
    row.state,
    to,
    userActor(user),
    `Rejected by ${user.displayName}: ${body.reason}`,
    now,
  );
  await recordRequirementAudit(client, {
    organizationId: scope.organizationId,
    projectId: row.project_id,
    workflowId: null,
    actor: userActor(user),
    action: 'requirement.rejected',
    targetType: 'requirement',
    targetId: row.id,
    result: to,
    details: { externalId: row.external_id, from: row.state, reason: body.reason },
    occurredAt: now,
  });
  return row.id;
}
