import { resolve } from 'node:path';
import pg from 'pg';
import { hashPassword } from '../password';
import { generateToken, hashToken } from '../token';
import { buildDashboardShowcase, DASHBOARD_PROJECT, EXPECTED_DASHBOARD } from './dashboard';
import { buildS500, PROJECTS, type SeedShowcase, type SeedWorkflow } from './s500';

export { DECISION_SHOWCASE, SHOWCASE_FAILED, SHOWCASE_WAITING } from './s500';
export { DASHBOARD_FIGURES, DASHBOARD_PROJECT, EXPECTED_DASHBOARD } from './dashboard';

export class SeedRefusedError extends Error {}

/** S-500 authors `links.workflow` by external id; the web route is keyed by the workflow row id assigned at insert. */
function workflowLinks<T extends { workflow?: string | undefined }>(
  links: T,
  externalId: string,
  workflowId: string,
): T {
  return links.workflow === `/workflows/${externalId}`
    ? { ...links, workflow: `/workflows/${workflowId}` }
    : links;
}

export interface SeedOptions {
  connectionString?: string | undefined;
  base?: Date | undefined;
  password?: string | undefined;
  ingestToken?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  log?: ((msg: string) => void) | undefined;
}

export interface SeedResult {
  organizationId: string;
  password: string;
  ingestToken: string;
  /** Totals over S-500 and dashboard-demo together; `dashboard` is the dashboard-demo share. */
  counts: {
    users: number;
    workflows: number;
    approvals: number;
    clarifications: number;
    stages: number;
    runs: number;
    artifacts: number;
    testRuns: number;
    dashboard: Record<keyof typeof EXPECTED_DASHBOARD, number>;
  };
}

/** Any SeedWorkflow-shaped row whose `project` is a key present in the seeded project map. */
type WorkflowRow = Omit<SeedWorkflow, 'project'> & { project: string };
type WorkflowRef = { id: string; projectId: string; approvalId: string | null };

interface InsertContext {
  client: pg.Client;
  org: string;
  principal: string;
  projectIds: Map<string, string>;
}

async function insertWorkflows(
  { client, org, principal, projectIds }: InsertContext,
  workflows: readonly WorkflowRow[],
): Promise<{ approvals: number; clarifications: number; refs: Map<string, WorkflowRef> }> {
  let approvals = 0;
  let clarifications = 0;
  const refs = new Map<string, WorkflowRef>();
  for (const w of workflows) {
    const projectId = projectIds.get(w.project)!;
    const r = await client.query<{ id: string }>(
      `INSERT INTO workflows (organization_id, project_id, external_id, title, agent, state, state_observed_at, state_reason, stage_index, stage_count, stage_name, pull_request_ref, started_at, finished_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,7,$10,$11,$12,$13) RETURNING id`,
      [
        org,
        projectId,
        w.externalId,
        w.title,
        w.agent,
        w.state,
        w.stateObservedAt,
        w.stateReason,
        w.stageIndex,
        w.stageName,
        w.pullRequestRef,
        w.startedAt,
        w.finishedAt,
      ],
    );
    const id = r.rows[0]!.id;
    const ref: WorkflowRef = { id, projectId, approvalId: null };
    refs.set(w.externalId, ref);
    const created = w.startedAt ?? w.stateObservedAt;
    await client.query(
      `INSERT INTO workflow_transitions (organization_id, workflow_id, from_state, to_state, observed_at, principal_id) VALUES ($1,$2,NULL,'QUEUED',$3,$4)`,
      [org, id, new Date(created.getTime() - 60_000), principal],
    );
    if (w.state !== 'QUEUED') {
      await client.query(
        `INSERT INTO workflow_transitions (organization_id, workflow_id, from_state, to_state, observed_at, reason, principal_id) VALUES ($1,$2,'QUEUED',$3,$4,$5,$6)`,
        [org, id, w.state, w.stateObservedAt, w.stateReason, principal],
      );
    }
    if (w.approval) {
      approvals++;
      const ar = await client.query<{ id: string }>(
        `INSERT INTO approvals (organization_id, project_id, workflow_id, external_id, ask, risk_level, requested_by_agent, requested_at, expires_at, context, links) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [
          org,
          projectId,
          id,
          w.approval.externalId,
          w.approval.ask,
          w.approval.riskLevel,
          w.agent,
          w.approval.requestedAt,
          w.approval.expiresAt,
          w.approval.context,
          JSON.stringify(workflowLinks(w.approval.links, w.externalId, id)),
        ],
      );
      ref.approvalId = ar.rows[0]!.id;
    }
    if (w.decidedApproval) {
      const d = w.decidedApproval;
      await client.query(
        `INSERT INTO approvals (organization_id, project_id, workflow_id, external_id, ask, risk_level, requested_by_agent, requested_at, decision, decided_at, decided_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Approver 1')`,
        [
          org,
          projectId,
          id,
          d.externalId,
          d.ask,
          d.riskLevel,
          w.agent,
          d.requestedAt,
          d.outcome,
          d.decidedAt,
        ],
      );
    }
    if (w.clarification) {
      clarifications++;
      await client.query(
        `INSERT INTO clarifications (organization_id, project_id, workflow_id, external_id, question, requested_by_agent, requested_at, has_recommended_answer, why_it_matters, options, links) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          org,
          projectId,
          id,
          w.clarification.externalId,
          w.clarification.question,
          w.agent,
          w.clarification.requestedAt,
          w.clarification.hasRecommendedAnswer,
          w.clarification.whyItMatters,
          JSON.stringify(w.clarification.options),
          JSON.stringify(workflowLinks(w.clarification.links, w.externalId, id)),
        ],
      );
    }
  }
  return { approvals, clarifications, refs };
}

/** Stages, stage transitions, runs, artifacts and test runs for workflows already inserted (`refs`). */
async function insertShowcase(
  { client, org, principal }: InsertContext,
  showcase: readonly SeedShowcase[],
  refs: Map<string, WorkflowRef>,
): Promise<{ stages: number; runs: number; artifacts: number; testRuns: number }> {
  const counts = { stages: 0, runs: 0, artifacts: 0, testRuns: 0 };
  for (const sc of showcase) {
    const ref = refs.get(sc.externalId)!;
    const stageIds = new Map<number, string>();
    for (const s of sc.stages) {
      counts.stages++;
      const sr = await client.query<{ id: string }>(
        `INSERT INTO workflow_stages (organization_id, project_id, workflow_id, position, name, state, state_observed_at, state_reason, agent, started_at, finished_at, error_summary, requires_approval, approval_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          org,
          ref.projectId,
          ref.id,
          s.position,
          s.name,
          s.state,
          s.stateObservedAt,
          s.stateReason,
          s.agent,
          s.startedAt,
          s.finishedAt,
          s.errorSummary,
          s.requiresApproval,
          s.linkApproval ? ref.approvalId : null,
        ],
      );
      const stageId = sr.rows[0]!.id;
      stageIds.set(s.position, stageId);
      for (const h of s.history) {
        await client.query(
          `INSERT INTO workflow_transitions (organization_id, workflow_id, stage_id, from_state, to_state, observed_at, reason, principal_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [org, ref.id, stageId, h.fromState, h.toState, h.observedAt, h.reason, principal],
        );
      }
    }
    for (const run of sc.runs) {
      counts.runs++;
      await client.query(
        `INSERT INTO agent_runs (organization_id, project_id, workflow_id, stage_id, external_id, agent, model, state, started_at, finished_at, summary, timeline)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [
          org,
          ref.projectId,
          ref.id,
          stageIds.get(run.stagePosition),
          run.externalId,
          run.agent,
          run.model,
          run.state,
          run.startedAt,
          run.finishedAt,
          run.summary,
          JSON.stringify(run.timeline),
        ],
      );
    }
    for (const a of sc.artifacts) {
      counts.artifacts++;
      await client.query(
        `INSERT INTO artifacts (organization_id, project_id, workflow_id, stage_id, external_id, type, title, href, summary, produced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          org,
          ref.projectId,
          ref.id,
          stageIds.get(a.stagePosition),
          a.externalId,
          a.type,
          a.title,
          a.href,
          a.summary,
          a.producedAt,
        ],
      );
    }
    for (const tr of sc.testRuns) {
      counts.testRuns++;
      await client.query(
        `INSERT INTO test_runs (organization_id, project_id, workflow_id, stage_id, external_id, category, status, total, passed, failed, skipped, href, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          org,
          ref.projectId,
          ref.id,
          stageIds.get(tr.stagePosition),
          tr.externalId,
          tr.category,
          tr.status,
          tr.total,
          tr.passed,
          tr.failed,
          tr.skipped,
          tr.href,
          tr.startedAt,
          tr.finishedAt,
        ],
      );
    }
  }
  return counts;
}

/** Truncates every table and loads S-500 plus the dashboard-demo project. Refuses to run in production (FR-022). */
export async function seed(opts: SeedOptions = {}): Promise<SeedResult> {
  const env = opts.env ?? process.env;
  if (env['NODE_ENV'] === 'production' || env['CDEVI_ENV'] === 'production') {
    throw new SeedRefusedError('Refusing to seed: NODE_ENV or CDEVI_ENV is production');
  }
  const connectionString = opts.connectionString ?? env['DATABASE_MIGRATOR_URL'];
  if (!connectionString) throw new Error('DATABASE_MIGRATOR_URL is not set');
  const log = opts.log ?? ((m: string) => console.log(m));
  const base =
    opts.base ?? (env['CDEVI_SEED_BASE'] ? new Date(env['CDEVI_SEED_BASE']) : new Date());
  const password =
    opts.password ?? env['CDEVI_SEED_PASSWORD'] ?? generateToken('cdevi-demo-').slice(0, 24);
  const ingestToken = opts.ingestToken ?? env['CDEVI_SEED_INGEST_TOKEN'] ?? generateToken('cdvi_');

  const { users, workflows, showcase } = buildS500(base);
  const dashboard = buildDashboardShowcase(base);
  const passwordHash = await hashPassword(password);

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `TRUNCATE audit_events, inbox_change_log, ingestion_log, test_runs, artifacts, agent_runs, workflow_stages, workflow_transitions, approvals, clarifications, workflows, sessions, project_memberships, ingestion_principals, users, projects, organizations RESTART IDENTITY CASCADE`,
    );
    const org = (
      await client.query<{ id: string }>(
        `INSERT INTO organizations (name, timezone, is_demo) VALUES ('Acme Engineering', 'Asia/Colombo', true) RETURNING id`,
      )
    ).rows[0]!.id;

    const projectIds = new Map<string, string>();
    for (const p of PROJECTS) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO projects (organization_id, key, name) VALUES ($1,$2,$3) RETURNING id`,
        [org, p.key, p.name],
      );
      projectIds.set(p.key, r.rows[0]!.id);
    }
    // dashboard-demo has no memberships: administrators see it through the existing visibility rule (R30).
    projectIds.set(
      DASHBOARD_PROJECT.key,
      (
        await client.query<{ id: string }>(
          `INSERT INTO projects (organization_id, key, name) VALUES ($1,$2,$3) RETURNING id`,
          [org, DASHBOARD_PROJECT.key, DASHBOARD_PROJECT.name],
        )
      ).rows[0]!.id,
    );

    for (const u of users) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO users (organization_id, email, display_name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [org, u.email, u.displayName, passwordHash, u.role],
      );
      for (const key of u.projects) {
        await client.query(
          `INSERT INTO project_memberships (user_id, project_id, organization_id) VALUES ($1,$2,$3)`,
          [r.rows[0]!.id, projectIds.get(key), org],
        );
      }
    }

    const principal = (
      await client.query<{ id: string }>(
        `INSERT INTO ingestion_principals (organization_id, name, token_hash, project_ids) VALUES ($1,'e2e-tests',$2,$3) RETURNING id`,
        [org, hashToken(ingestToken), [...projectIds.values()]],
      )
    ).rows[0]!.id;

    const ctx: InsertContext = { client, org, principal, projectIds };
    const s500 = await insertWorkflows(ctx, workflows);
    // specs/001 US1 showcase journeys (research R8): stages, stage transitions, runs, artifacts, test runs.
    const s500Counts = await insertShowcase(ctx, showcase, s500.refs);
    // specs/001 US3 dashboard-demo (research R30): written after S-500 so S-500 row order is unchanged.
    const dash = await insertWorkflows(ctx, dashboard.workflows);
    const dashCounts = await insertShowcase(ctx, dashboard.showcase, dash.refs);
    const approvals = s500.approvals + dash.approvals;
    const clarifications = s500.clarifications + dash.clarifications;
    const counts = {
      stages: s500Counts.stages + dashCounts.stages,
      runs: s500Counts.runs + dashCounts.runs,
      artifacts: s500Counts.artifacts + dashCounts.artifacts,
      testRuns: s500Counts.testRuns + dashCounts.testRuns,
    };
    // The seed's own inserts should not count as "changes" for SSE replay.
    await client.query(`TRUNCATE inbox_change_log RESTART IDENTITY`);
    await client.query('COMMIT');

    log(`Seeded S-500 + dashboard-demo into organization ${org} (base ${base.toISOString()})`);
    log(
      `  users: ${users.length}  workflows: ${workflows.length + dashboard.workflows.length}  approvals: ${approvals}  clarifications: ${clarifications}`,
    );
    log(
      `  showcase (${showcase.map((s) => s.externalId).join(', ')}): stages ${s500Counts.stages}  runs ${s500Counts.runs}  artifacts ${s500Counts.artifacts}  test runs ${s500Counts.testRuns}`,
    );
    log(
      `  ${DASHBOARD_PROJECT.key}: workflows ${dashboard.workflows.length}  approvals ${dash.approvals}  clarifications ${dash.clarifications}  stages ${dashCounts.stages}  runs ${dashCounts.runs}  test runs ${dashCounts.testRuns}`,
    );
    log(
      '  Demo credentials (shown once): admin@cdevi.demo, approver1@cdevi.demo, engineer1@cdevi.demo, viewer1@cdevi.demo',
    );
    log(`  Password (all demo users): ${password}`);
    log(`  Ingestion token (principal e2e-tests): ${ingestToken}`);
    return {
      organizationId: org,
      password,
      ingestToken,
      counts: {
        users: users.length,
        workflows: workflows.length + dashboard.workflows.length,
        approvals,
        clarifications,
        ...counts,
        dashboard: {
          workflows: dashboard.workflows.length,
          active: dashboard.workflows.filter(
            (w) => w.state !== 'COMPLETED' && w.state !== 'CANCELLED',
          ).length,
          approvals: dash.approvals,
          clarifications: dash.clarifications,
          stages: dashCounts.stages,
          runs: dashCounts.runs,
          testRuns: dashCounts.testRuns,
        },
      },
    };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  seed().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
