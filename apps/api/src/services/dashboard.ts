import type { DashboardQuery, DashboardSnapshot, WorkflowState } from '@cdevi/contracts';
import {
  ACTIVE_CARD_LIMIT,
  ACTIVE_STATES,
  buildDashboardSnapshot,
  RUNNING_AGENT_STATES,
  windowFor,
  type ActiveCardRow,
  type DashboardRows,
} from '@cdevi/contracts/dashboard-model';
import type pg from 'pg';
import type { CenterScope } from './approval-center';

const n = (v: string | number | null | undefined) => Number(v ?? 0);

interface WorkflowAgg {
  active: string;
  running: string;
  failed: string;
  blocked: string;
  unstaged: string;
  prs: string;
  s1: string;
  s2: string;
  s3: string;
  s4: string;
  s5: string;
  s6: string;
  s7: string;
}

interface CardRow {
  id: string;
  external_id: string;
  title: string;
  agent: string | null;
  state: WorkflowState;
  stage_index: number | null;
  stage_count: number | null;
  stage_name: string | null;
  started_at: Date | null;
  state_observed_at: Date;
}

/**
 * Resolves `project=all|<uuid>` against the caller's visible projects. An unknown or invisible uuid yields an
 * empty selection so the snapshot is all zeros (never a 404 that would confirm the project exists).
 */
export function selectedProjectIds(
  scope: CenterScope,
  project: DashboardQuery['project'],
): string[] {
  if (project === 'all') return [...scope.projectIds];
  return scope.projectIds.includes(project) ? [project] : [];
}

/**
 * One aggregate read (research R22 Q1–Q8) over the organization's visible projects, shaped into DashboardRows
 * and composed by the pure contracts rules. Run inside `app.tx({ isolation: 'REPEATABLE READ' })` so every
 * figure is read from the same snapshot.
 */
export async function dashboardSnapshot(
  client: pg.Pool | pg.PoolClient,
  scope: CenterScope,
  query: DashboardQuery,
  now: Date,
): Promise<DashboardSnapshot> {
  const projectIds = selectedProjectIds(scope, query.project);
  const window = windowFor(query.window, now);
  const org = scope.organizationId;
  const active = [...ACTIVE_STATES];
  const running = [...RUNNING_AGENT_STATES];

  const wf = await client.query<WorkflowAgg>(
    `SELECT count(*) FILTER (WHERE state = ANY($3::workflow_state[])) AS active,
            count(*) FILTER (WHERE state = ANY($4::workflow_state[])) AS running,
            count(*) FILTER (WHERE state = 'FAILED') AS failed,
            count(*) FILTER (WHERE state = 'BLOCKED') AS blocked,
            count(*) FILTER (WHERE state = ANY($3::workflow_state[]) AND (stage_index IS NULL OR stage_index < 1 OR stage_index > 7)) AS unstaged,
            count(*) FILTER (WHERE pull_request_ref IS NOT NULL AND coalesce(finished_at, state_observed_at) >= $5 AND coalesce(finished_at, state_observed_at) <= $6) AS prs,
            count(*) FILTER (WHERE state = ANY($3::workflow_state[]) AND stage_index = 1) AS s1,
            count(*) FILTER (WHERE state = ANY($3::workflow_state[]) AND stage_index = 2) AS s2,
            count(*) FILTER (WHERE state = ANY($3::workflow_state[]) AND stage_index = 3) AS s3,
            count(*) FILTER (WHERE state = ANY($3::workflow_state[]) AND stage_index = 4) AS s4,
            count(*) FILTER (WHERE state = ANY($3::workflow_state[]) AND stage_index = 5) AS s5,
            count(*) FILTER (WHERE state = ANY($3::workflow_state[]) AND stage_index = 6) AS s6,
            count(*) FILTER (WHERE state = ANY($3::workflow_state[]) AND stage_index = 7) AS s7
       FROM workflows
      WHERE organization_id = $1 AND project_id = ANY($2::uuid[])`,
    [org, projectIds, active, running, window.from, window.to],
  );
  const ap = await client.query<{ pending: string; high_critical: string }>(
    `SELECT count(*) AS pending,
            count(*) FILTER (WHERE a.risk_level IN ('HIGH', 'CRITICAL')) AS high_critical
       FROM approvals a JOIN workflows w ON w.id = a.workflow_id
      WHERE a.organization_id = $1 AND w.project_id = ANY($2::uuid[])
        AND a.decision IS NULL AND w.state = 'WAITING_FOR_HUMAN'`,
    [org, projectIds],
  );
  const cl = await client.query<{ pending: string }>(
    `SELECT count(*) AS pending
       FROM clarifications c JOIN workflows w ON w.id = c.workflow_id
      WHERE c.organization_id = $1 AND w.project_id = ANY($2::uuid[])
        AND c.answered_at IS NULL AND w.state = 'WAITING_FOR_HUMAN'`,
    [org, projectIds],
  );
  const tr = await client.query<{ passed: string; total: string }>(
    `SELECT coalesce(sum(passed), 0) AS passed, coalesce(sum(passed + failed), 0) AS total
       FROM test_runs
      WHERE organization_id = $1 AND project_id = ANY($2::uuid[])
        AND finished_at IS NOT NULL AND finished_at >= $3 AND finished_at <= $4`,
    [org, projectIds, window.from, window.to],
  );
  const ar = await client.query<{ completed: string; finished: string }>(
    `SELECT count(*) FILTER (WHERE state = 'COMPLETED') AS completed,
            count(*) FILTER (WHERE state IN ('COMPLETED', 'FAILED')) AS finished
       FROM agent_runs
      WHERE organization_id = $1 AND project_id = ANY($2::uuid[])
        AND finished_at IS NOT NULL AND finished_at >= $3 AND finished_at <= $4`,
    [org, projectIds, window.from, window.to],
  );
  const hi = await client.query<{ numerator: string; denominator: string }>(
    `WITH scoped AS (
       SELECT id FROM workflows
        WHERE organization_id = $1 AND project_id = ANY($2::uuid[])
          AND (state = ANY($3::workflow_state[])
               OR coalesce(finished_at, state_observed_at) BETWEEN $4 AND $5)
     )
     SELECT count(*) AS denominator,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM approvals a WHERE a.workflow_id = scoped.id)
                                OR EXISTS (SELECT 1 FROM clarifications c WHERE c.workflow_id = scoped.id)
                                OR EXISTS (SELECT 1 FROM workflow_transitions t WHERE t.workflow_id = scoped.id AND t.user_id IS NOT NULL)) AS numerator
       FROM scoped`,
    [org, projectIds, active, window.from, window.to],
  );
  const au = await client.query<{ high_critical: string }>(
    `SELECT count(*) AS high_critical
       FROM audit_events
      WHERE organization_id = $1 AND (project_id = ANY($2::uuid[]) OR ($5 AND project_id IS NULL))
        AND risk_level IN ('HIGH', 'CRITICAL') AND occurred_at >= $3 AND occurred_at <= $4`,
    [org, projectIds, window.from, window.to, query.project === 'all'],
  );
  const cards = await client.query<CardRow>(
    `SELECT id, external_id, title, agent, state, stage_index, stage_count, stage_name, started_at, state_observed_at
       FROM workflows
      WHERE organization_id = $1 AND project_id = ANY($2::uuid[]) AND state = ANY($3::workflow_state[])
      ORDER BY state_observed_at DESC, id ASC
      LIMIT $4`,
    [org, projectIds, active, ACTIVE_CARD_LIMIT],
  );

  const w = wf.rows[0]!;
  const failed = n(w.failed);
  const blocked = n(w.blocked);
  const rows: DashboardRows = {
    workflows: {
      active: n(w.active),
      running: n(w.running),
      failures: failed + blocked,
      failed,
      blocked,
      stages: [w.s1, w.s2, w.s3, w.s4, w.s5, w.s6, w.s7].map(n),
      unstaged: n(w.unstaged),
      prsGenerated: n(w.prs),
    },
    approvals: { pending: n(ap.rows[0]?.pending), highCritical: n(ap.rows[0]?.high_critical) },
    clarifications: { pending: n(cl.rows[0]?.pending) },
    testRuns: { passed: n(tr.rows[0]?.passed), total: n(tr.rows[0]?.total) },
    agentRuns: { completed: n(ar.rows[0]?.completed), finished: n(ar.rows[0]?.finished) },
    intervention: { numerator: n(hi.rows[0]?.numerator), denominator: n(hi.rows[0]?.denominator) },
    auditHighCritical: n(au.rows[0]?.high_critical),
    cards: cards.rows.map((r): ActiveCardRow => ({
      workflowId: r.id,
      externalId: r.external_id,
      title: r.title,
      agent: r.agent,
      state: r.state,
      stageIndex: r.stage_index,
      stageCount: r.stage_count,
      stageName: r.stage_name,
      startedAt: r.started_at,
      stateObservedAt: r.state_observed_at,
    })),
  };
  return buildDashboardSnapshot(rows, now, query.window, query.project);
}
