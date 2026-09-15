/**
 * Workflow Detail read service (specs/001 data-model.md §6–§7). Six bounded queries inside one transaction,
 * composed with the pure derivations from @cdevi/contracts; nothing is re-derived in the browser.
 */
import {
  allowedActions,
  deriveAttention,
  deriveCurrentStage,
  deriveFailure,
  deriveProgress,
  describeStage,
  groupArtifactsByStage,
  latestRunFor,
  nextStage,
  orderActivity,
  orderStages,
  orderTestRuns,
  stageElapsed,
  stageRef,
  toStageView,
  workflowElapsed,
  type AgentRunEvent,
  type ArtifactRow,
  type ArtifactType,
  type RiskLevel,
  type Role,
  type RunRow,
  type StageRow,
  type TestRunRow,
  type TestRunStatus,
  type TransitionRow,
  type WorkflowDetail,
  type WorkflowState,
} from '@cdevi/contracts';
import type pg from 'pg';

export interface DetailScope {
  organizationId: string;
  projectIds: string[];
  role: Role;
}

export interface WorkflowHead {
  id: string;
  external_id: string;
  title: string;
  project_id: string;
  project_key: string;
  project_name: string;
  agent: string | null;
  state: WorkflowState;
  state_observed_at: Date;
  state_reason: string | null;
  stage_index: number | null;
  stage_count: number | null;
  stage_name: string | null;
  pull_request_ref: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

/** Locks nothing; returns undefined when the workflow is missing OR outside the visible projects (403 ≡ 404). */
export async function loadWorkflowHead(
  client: pg.PoolClient,
  scope: Pick<DetailScope, 'organizationId' | 'projectIds'>,
  id: string,
  forUpdate = false,
): Promise<WorkflowHead | undefined> {
  if (scope.projectIds.length === 0) return undefined;
  const r = await client.query<WorkflowHead>(
    `SELECT w.id, w.external_id, w.title, w.project_id, p.key AS project_key, p.name AS project_name, w.agent, w.state,
            w.state_observed_at, w.state_reason, w.stage_index, w.stage_count, w.stage_name, w.pull_request_ref,
            w.started_at, w.finished_at
       FROM workflows w JOIN projects p ON p.id = w.project_id
      WHERE w.organization_id = $1 AND w.id = $2 AND w.project_id = ANY($3::uuid[])
      ${forUpdate ? 'FOR UPDATE OF w' : ''}`,
    [scope.organizationId, id, scope.projectIds],
  );
  return r.rows[0];
}

interface StageDbRow {
  id: string;
  position: number;
  name: string;
  state: WorkflowState;
  state_observed_at: Date;
  state_reason: string | null;
  agent: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  error_summary: string | null;
  requires_approval: boolean;
  approval_id: string | null;
  clarification_id: string | null;
}

export async function loadStages(client: pg.PoolClient, workflowId: string): Promise<StageRow[]> {
  const r = await client.query<StageDbRow>(
    `SELECT id, position, name, state, state_observed_at, state_reason, agent, started_at, finished_at,
            error_summary, requires_approval, approval_id, clarification_id
       FROM workflow_stages WHERE workflow_id = $1 ORDER BY position`,
    [workflowId],
  );
  return r.rows.map((s) => ({
    id: s.id,
    position: s.position,
    name: s.name,
    state: s.state,
    stateObservedAt: s.state_observed_at,
    stateReason: s.state_reason,
    agent: s.agent,
    startedAt: s.started_at,
    finishedAt: s.finished_at,
    errorSummary: s.error_summary,
    requiresApproval: s.requires_approval,
    approvalId: s.approval_id,
    clarificationId: s.clarification_id,
  }));
}

/** Keeps the denormalised workflows.stage_index/stage_name (and optionally stage_count) in step with the current stage (data-model §5). */
export async function syncWorkflowStagePointer(
  client: pg.PoolClient,
  workflowId: string,
  count?: number,
): Promise<void> {
  const current = deriveCurrentStage(await loadStages(client, workflowId));
  await client.query(
    `UPDATE workflows SET stage_index = COALESCE($2, stage_index), stage_name = COALESCE($3, stage_name), stage_count = COALESCE($4, stage_count) WHERE id = $1`,
    [workflowId, current?.position ?? null, current?.name ?? null, count ?? null],
  );
}

export async function workflowDetail(
  client: pg.PoolClient,
  scope: DetailScope,
  id: string,
  now: Date,
): Promise<WorkflowDetail | null> {
  const w = await loadWorkflowHead(client, scope, id);
  if (!w) return null;
  const stages = await loadStages(client, w.id);

  const transitions = (
    await client.query<{
      stage_id: string | null;
      from_state: WorkflowState | null;
      to_state: WorkflowState;
      observed_at: Date;
      reason: string | null;
      by_user: string | null;
    }>(
      `SELECT t.stage_id, t.from_state, t.to_state, t.observed_at, t.reason, u.display_name AS by_user
         FROM workflow_transitions t LEFT JOIN users u ON u.id = t.user_id
        WHERE t.workflow_id = $1 ORDER BY t.observed_at DESC, t.id DESC LIMIT 200`,
      [w.id],
    )
  ).rows.map<TransitionRow>((t) => ({
    stageId: t.stage_id,
    fromState: t.from_state,
    toState: t.to_state,
    observedAt: t.observed_at,
    reason: t.reason,
    byUser: t.by_user,
  }));

  const runs = (
    await client.query<{
      id: string;
      stage_id: string;
      agent: string;
      model: string | null;
      state: WorkflowState;
      started_at: Date;
      finished_at: Date | null;
      summary: string | null;
      timeline: AgentRunEvent[];
    }>(
      `SELECT id, stage_id, agent, model, state, started_at, finished_at, summary, timeline
         FROM agent_runs WHERE workflow_id = $1 ORDER BY started_at DESC, id DESC LIMIT 100`,
      [w.id],
    )
  ).rows.map<RunRow>((r) => ({
    id: r.id,
    stageId: r.stage_id,
    agent: r.agent,
    model: r.model,
    state: r.state,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    summary: r.summary,
    timeline: r.timeline,
  }));

  // Per-stage drill-down refs (US5): newest 20 runs of every stage, independent of the workflow-wide
  // 100-run window that feeds the activity feed.
  const stageRuns = (
    await client.query<{ id: string; stage_id: string; agent: string; state: WorkflowState }>(
      `SELECT id, stage_id, agent, state FROM (
         SELECT id, stage_id, agent, state,
                row_number() OVER (PARTITION BY stage_id ORDER BY started_at DESC, id DESC) AS rn
           FROM agent_runs WHERE workflow_id = $1) r
       WHERE rn <= 20 ORDER BY stage_id, rn`,
      [w.id],
    )
  ).rows.map((r) => ({ id: r.id, stageId: r.stage_id, agent: r.agent, state: r.state }));

  const artifacts = (
    await client.query<{
      id: string;
      stage_id: string;
      type: ArtifactType;
      title: string;
      href: string | null;
      summary: string | null;
      produced_at: Date;
    }>(
      `SELECT id, stage_id, type, title, href, summary, produced_at FROM artifacts
        WHERE workflow_id = $1 ORDER BY produced_at, id LIMIT 100`,
      [w.id],
    )
  ).rows.map<ArtifactRow>((a) => ({
    id: a.id,
    stageId: a.stage_id,
    type: a.type,
    title: a.title,
    href: a.href,
    summary: a.summary,
    producedAt: a.produced_at,
  }));

  const testRuns = (
    await client.query<{
      id: string;
      stage_id: string;
      category: string;
      status: TestRunStatus;
      total: number;
      passed: number;
      failed: number;
      skipped: number;
      href: string | null;
      started_at: Date;
      finished_at: Date | null;
    }>(
      `SELECT id, stage_id, category, status, total, passed, failed, skipped, href, started_at, finished_at
         FROM test_runs WHERE workflow_id = $1 ORDER BY started_at, id LIMIT 50`,
      [w.id],
    )
  ).rows.map<TestRunRow>((t) => ({
    id: t.id,
    stageId: t.stage_id,
    category: t.category,
    status: t.status,
    total: t.total,
    passed: t.passed,
    failed: t.failed,
    skipped: t.skipped,
    href: t.href,
    startedAt: t.started_at,
    finishedAt: t.finished_at,
  }));

  const pending = (
    await client.query<{
      a_id: string | null;
      a_ask: string | null;
      a_risk: RiskLevel | null;
      a_requested_at: Date | null;
      c_id: string | null;
      c_question: string | null;
      c_requested_at: Date | null;
    }>(
      `SELECT a.id AS a_id, a.ask AS a_ask, a.risk_level AS a_risk, a.requested_at AS a_requested_at,
              c.id AS c_id, c.question AS c_question, c.requested_at AS c_requested_at
         FROM (SELECT 1) x
         LEFT JOIN LATERAL (SELECT id, ask, risk_level, requested_at FROM approvals
                             WHERE workflow_id = $1 AND decision IS NULL ORDER BY requested_at, id LIMIT 1) a ON true
         LEFT JOIN LATERAL (SELECT id, question, requested_at FROM clarifications
                             WHERE workflow_id = $1 AND answered_at IS NULL ORDER BY requested_at, id LIMIT 1) c ON true`,
      [w.id],
    )
  ).rows[0]!;

  const ordered = orderStages(stages);
  const current = deriveCurrentStage(ordered);
  const run = latestRunFor(current, runs);
  const approval = pending.a_id
    ? {
        id: pending.a_id,
        ask: pending.a_ask!,
        riskLevel: pending.a_risk!,
        requestedAt: pending.a_requested_at!,
      }
    : null;
  const clarification = pending.c_id
    ? { id: pending.c_id, question: pending.c_question!, requestedAt: pending.c_requested_at! }
    : null;

  return {
    generatedAt: now.toISOString(),
    workflow: {
      id: w.id,
      externalId: w.external_id,
      title: w.title,
      project: { id: w.project_id, key: w.project_key, name: w.project_name },
      state: w.state,
      stateReason: w.state_reason,
      stateObservedAt: w.state_observed_at.toISOString(),
      agent: w.agent,
      pullRequestRef: w.pull_request_ref,
      startedAt: w.started_at?.toISOString() ?? null,
      finishedAt: w.finished_at?.toISOString() ?? null,
      elapsedMs: workflowElapsed({ startedAt: w.started_at, finishedAt: w.finished_at }, now),
      stage:
        w.stage_index !== null && w.stage_count !== null
          ? { index: w.stage_index, count: w.stage_count, name: w.stage_name }
          : null,
      riskLevel: w.state === 'WAITING_FOR_HUMAN' ? (approval?.riskLevel ?? null) : null,
    },
    stages: ordered.map((s) => toStageView(s, current, now, stageRuns)),
    currentStage: current
      ? {
          stage: stageRef(current),
          state: current.state,
          agent: run?.agent ?? current.agent,
          model: run?.model ?? null,
          startedAt: current.startedAt?.toISOString() ?? null,
          elapsedMs: stageElapsed(current, now),
          summary: describeStage(current, run),
        }
      : null,
    nextStage: nextStage(ordered, current),
    progress: deriveProgress(ordered),
    activity: orderActivity(ordered, transitions, runs),
    artifacts: groupArtifactsByStage(artifacts, ordered),
    testRuns: orderTestRuns(testRuns, ordered),
    attention: deriveAttention(ordered, { approval, clarification }),
    failure: deriveFailure(
      { state: w.state, stateReason: w.state_reason, stateObservedAt: w.state_observed_at },
      ordered,
    ),
    actions: allowedActions(scope.role, w.state),
  };
}
