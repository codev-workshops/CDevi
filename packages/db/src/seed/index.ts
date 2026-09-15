import { resolve } from 'node:path';
import pg from 'pg';
import { hashPassword } from '../password';
import { generateToken, hashToken } from '../token';
import { buildDashboardShowcase, DASHBOARD_PROJECT, EXPECTED_DASHBOARD } from './dashboard';
import { buildRequirements, EXPECTED_REQUIREMENTS, type RequirementsSeed } from './requirements';
import { buildReviewSeed, type ReviewSeed } from './reviews';
import { buildS500, PROJECTS, type SeedShowcase, type SeedWorkflow } from './s500';

export {
  DECISION_SHOWCASE,
  EXPECTED_AGENT_DECISIONS,
  SHOWCASE_FAILED,
  SHOWCASE_WAITING,
} from './s500';
export { DASHBOARD_FIGURES, DASHBOARD_PROJECT, EXPECTED_DASHBOARD } from './dashboard';
export { EXPECTED_REQUIREMENTS, JIRA_MAPPING, REQUIREMENT_SHOWCASE } from './requirements';
export { EXPECTED_REVIEW_SEED } from './reviews';

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

/** Evidence `href`s authored as `/workflows/<externalId>[#anchor]` resolve to the workflow row id the same way. */
function evidenceLinks<T extends { href?: string | null | undefined }>(
  evidence: readonly T[],
  externalId: string,
  workflowId: string,
): T[] {
  const prefix = `/workflows/${externalId}`;
  return evidence.map((e) =>
    e.href && (e.href === prefix || e.href.startsWith(`${prefix}#`))
      ? { ...e, href: `/workflows/${workflowId}${e.href.slice(prefix.length)}` }
      : e,
  );
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
    /** specs/001 US5 (data-model.md §37); compare with EXPECTED_AGENT_DECISIONS.decisions. */
    agentDecisions: number;
    dashboard: Record<keyof typeof EXPECTED_DASHBOARD, number>;
    /** specs/001 US4 requirements seed (research R44); compare with EXPECTED_REQUIREMENTS. */
    requirements: RequirementCounts;
    /** specs/001 US6 review seed; compare with EXPECTED_REVIEW_SEED. */
    reviews: ReviewCounts;
  };
}

interface ReviewCounts {
  pullRequests: number;
  reviews: number;
  findings: number;
  byState: Record<string, number>;
  cycles: number;
}

type RequirementCounts = Omit<
  { -readonly [K in keyof typeof EXPECTED_REQUIREMENTS]: number },
  'byState'
> & { byState: Record<string, number> };

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

interface ShowcaseCounts {
  stages: number;
  runs: number;
  artifacts: number;
  testRuns: number;
  agentDecisions: number;
}

/**
 * Stages, stage transitions, runs (with steps and decisions), artifacts and test runs for workflows already
 * inserted (`refs`). Returns the inserted run ids by external id so `links.agentRun` can be resolved.
 */
async function insertShowcase(
  { client, org, principal }: InsertContext,
  showcase: readonly SeedShowcase[],
  refs: Map<string, WorkflowRef>,
): Promise<ShowcaseCounts & { runIds: Map<string, string> }> {
  const counts: ShowcaseCounts = {
    stages: 0,
    runs: 0,
    artifacts: 0,
    testRuns: 0,
    agentDecisions: 0,
  };
  const runIds = new Map<string, string>();
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
      const stageId = stageIds.get(run.stagePosition);
      const rr = await client.query<{ id: string }>(
        `INSERT INTO agent_runs (organization_id, project_id, workflow_id, stage_id, external_id, agent, model, state, started_at, finished_at, summary, timeline, steps, decisions_observed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14) RETURNING id`,
        [
          org,
          ref.projectId,
          ref.id,
          stageId,
          run.externalId,
          run.agent,
          run.model,
          run.state,
          run.startedAt,
          run.finishedAt,
          run.summary,
          JSON.stringify(run.timeline),
          JSON.stringify(run.steps),
          run.decisions.length
            ? new Date(Math.max(...run.decisions.map((d) => d.decidedAt.getTime())))
            : null,
        ],
      );
      const runId = rr.rows[0]!.id;
      runIds.set(run.externalId, runId);
      for (const d of run.decisions) {
        counts.agentDecisions++;
        await client.query(
          `INSERT INTO agent_decisions (organization_id, project_id, workflow_id, stage_id, agent_run_id, position, decided_at, action, reason, confidence, policy_outcome, policy_ref, risk_level, evidence)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
          [
            org,
            ref.projectId,
            ref.id,
            stageId,
            runId,
            d.position,
            d.decidedAt,
            d.action,
            d.reason,
            d.confidence,
            d.policyOutcome,
            d.policyRef,
            d.riskLevel,
            JSON.stringify(evidenceLinks(d.evidence, sc.externalId, ref.id)),
          ],
        );
      }
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
  return { ...counts, runIds };
}

/**
 * S-500 authors `links.agentRun` by run external id (`/agents/runs/<externalId>`); the web route is keyed by the
 * agent_runs row id assigned at insert, so the link is rewritten once the showcase runs exist.
 */
async function resolveAgentRunLinks(
  { client, org }: InsertContext,
  runIds: Map<string, string>,
): Promise<void> {
  for (const [externalId, runId] of runIds) {
    await client.query(
      `UPDATE clarifications SET links = links || jsonb_build_object('agentRun', $3::text)
       WHERE organization_id = $1 AND links->>'agentRun' = $2`,
      [org, `/agents/runs/${externalId}`, `/agents/runs/${runId}`],
    );
  }
}

/**
 * Requirements, analysis items, transitions, workflow links and the Jira mapping (specs/001 US4, R44).
 * Workflow links are plain UPDATEs of `requirement_id` (the follow-workflow trigger fires on state changes only),
 * so the state history is written explicitly, including the system rows the trigger would have produced.
 */
async function insertRequirements(
  { client, org, projectIds }: InsertContext,
  { requirements, mapping }: RequirementsSeed,
  userIds: Map<string, string>,
  workflowRefs: Map<string, WorkflowRef>,
): Promise<RequirementCounts> {
  const counts: RequirementCounts = {
    total: 0,
    byState: {},
    analysisItems: 0,
    aiGenerated: 0,
    openQuestions: 0,
    jiraLinked: 0,
    linkedWorkflows: 0,
    mappings: 0,
    transitions: 0,
  };
  const userId = (email: string | null) => {
    if (email === null) return null;
    const id = userIds.get(email);
    if (!id) throw new Error(`requirements seed references unknown user ${email}`);
    return id;
  };
  await client.query(
    `INSERT INTO integration_project_mappings (organization_id, project_id, provider, external_project_key, external_base_url) VALUES ($1,$2,$3,$4,$5)`,
    [
      org,
      projectIds.get(mapping.projectKey),
      mapping.provider,
      mapping.externalProjectKey,
      mapping.baseUrl,
    ],
  );
  counts.mappings++;
  for (const r of requirements) {
    const projectId = projectIds.get(r.project)!;
    const id = (
      await client.query<{ id: string }>(
        `INSERT INTO requirements (organization_id, project_id, external_id, title, business_objective, state, source, external_ref,
           created_by_user_id, assignee_user_id, submitted_by_user_id, submitted_at, analysis_observed_at, analysis_agent, analysis_summary,
           approved_by_user_id, approved_at, rejected_by_user_id, rejected_at, rejection_reason, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING id`,
        [
          org,
          projectId,
          r.externalId,
          r.title,
          r.businessObjective,
          r.state,
          r.source,
          r.externalRef ? JSON.stringify(r.externalRef) : null,
          userId(r.createdBy),
          userId(r.assignee),
          userId(r.submittedBy),
          r.submittedAt,
          r.analysisObservedAt,
          r.analysisAgent,
          r.analysisSummary,
          userId(r.approvedBy),
          r.approvedAt,
          userId(r.rejectedBy),
          r.rejectedAt,
          r.rejectionReason,
          r.createdAt,
          r.transitions.at(-1)!.occurredAt,
        ],
      )
    ).rows[0]!.id;
    counts.total++;
    counts.byState[r.state] = (counts.byState[r.state] ?? 0) + 1;
    if (r.source === 'jira') counts.jiraLinked++;
    for (const item of r.items) {
      await client.query(
        `INSERT INTO requirement_analysis_items (organization_id, project_id, requirement_id, kind, position, text, ai_generated, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          org,
          projectId,
          id,
          item.kind,
          item.position,
          item.text,
          item.aiGenerated,
          item.source,
          item.aiGenerated ? r.analysisObservedAt : r.createdAt,
        ],
      );
      counts.analysisItems++;
      if (item.aiGenerated) counts.aiGenerated++;
      if (item.kind === 'open_question') counts.openQuestions++;
    }
    for (const t of r.transitions) {
      await client.query(
        `INSERT INTO requirement_transitions (organization_id, requirement_id, from_state, to_state, actor_type, actor_id, actor_name, reason, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          org,
          id,
          t.fromState,
          t.toState,
          t.actorType,
          userId(t.actorEmail),
          t.actorName,
          t.reason,
          t.occurredAt,
        ],
      );
      counts.transitions++;
    }
    if (r.linkedWorkflow) {
      const ref = workflowRefs.get(r.linkedWorkflow);
      if (!ref) throw new Error(`requirements seed links unknown workflow ${r.linkedWorkflow}`);
      await client.query(`UPDATE workflows SET requirement_id = $1 WHERE id = $2`, [id, ref.id]);
      counts.linkedWorkflows++;
    }
  }
  return counts;
}

/**
 * specs/001 US6: PR #1821 on `s500-001`, its cycle-3 review with seven lane results and seven findings, and the
 * three fix-loop cycles. Cycles go first so a FIXED finding can reference its `fix_cycle_id`; the PR inherits the
 * workflow's requirement link when one exists.
 */
async function insertReviews(
  { client, org }: InsertContext,
  { pullRequest, review, cycles }: ReviewSeed,
  userIds: Map<string, string>,
  workflowRefs: Map<string, WorkflowRef>,
  runIds: Map<string, string>,
): Promise<ReviewCounts> {
  const counts: ReviewCounts = { pullRequests: 0, reviews: 0, findings: 0, byState: {}, cycles: 0 };
  const ref = workflowRefs.get(pullRequest.workflow);
  if (!ref) throw new Error(`review seed references unknown workflow ${pullRequest.workflow}`);
  const runId = (externalId: string | null) => {
    if (externalId === null) return null;
    const id = runIds.get(externalId);
    if (!id) throw new Error(`review seed references unknown agent run ${externalId}`);
    return id;
  };
  const requirementId =
    (
      await client.query<{ requirement_id: string | null }>(
        `SELECT requirement_id FROM workflows WHERE id = $1`,
        [ref.id],
      )
    ).rows[0]?.requirement_id ?? null;
  const prId = (
    await client.query<{ id: string }>(
      `INSERT INTO pull_requests (organization_id, project_id, workflow_id, requirement_id, external_id, number, title, href, status, observed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$10) RETURNING id`,
      [
        org,
        ref.projectId,
        ref.id,
        requirementId,
        pullRequest.externalId,
        pullRequest.number,
        pullRequest.title,
        pullRequest.href,
        pullRequest.status,
        pullRequest.observedAt,
      ],
    )
  ).rows[0]!.id;
  counts.pullRequests++;
  const cycleIds = new Map<number, string>();
  for (const c of cycles) {
    const id = (
      await client.query<{ id: string }>(
        `INSERT INTO review_cycles (organization_id, project_id, workflow_id, pull_request_id, cycle_number, findings_count, fixed_count, remaining_count, iteration, max_iterations, state, requested_by_agent, started_at, finished_at, agent_run_id, observed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$13,$16) RETURNING id`,
        [
          org,
          ref.projectId,
          ref.id,
          prId,
          c.cycleNumber,
          c.findingsCount,
          c.fixedCount,
          c.remainingCount,
          c.iteration,
          c.maxIterations,
          c.state,
          c.requestedByAgent,
          c.startedAt,
          c.finishedAt,
          runId(c.agentRun),
          c.observedAt,
        ],
      )
    ).rows[0]!.id;
    cycleIds.set(c.cycleNumber, id);
    counts.cycles++;
  }
  const reviewId = (
    await client.query<{ id: string }>(
      `INSERT INTO reviews (organization_id, project_id, workflow_id, pull_request_id, external_id, cycle_number, status, lanes, observed_at, started_at, finished_at, agent_run_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$10,$9) RETURNING id`,
      [
        org,
        ref.projectId,
        ref.id,
        prId,
        review.externalId,
        review.cycleNumber,
        review.status,
        JSON.stringify(review.lanes),
        review.observedAt,
        review.startedAt,
        review.finishedAt,
        runId(review.agentRun),
      ],
    )
  ).rows[0]!.id;
  counts.reviews++;
  for (const f of review.findings) {
    const fixCycleId = f.fixCycle === null ? null : cycleIds.get(f.fixCycle);
    if (fixCycleId === undefined)
      throw new Error(`review seed references unknown cycle ${f.fixCycle}`);
    const dismissedBy = f.dismissedBy === null ? null : userIds.get(f.dismissedBy);
    if (dismissedBy === undefined)
      throw new Error(`review seed references unknown user ${f.dismissedBy}`);
    await client.query(
      `INSERT INTO review_findings (organization_id, project_id, workflow_id, pull_request_id, review_id, external_id, position, lane, severity, blocking, title, description, impact, evidence, recommended_fix, state, dismissed_reason, dismissed_by_user_id, dismissed_at, fix_cycle_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        org,
        ref.projectId,
        ref.id,
        prId,
        reviewId,
        f.externalId,
        f.position,
        f.lane,
        f.severity,
        f.blocking,
        f.title,
        f.description,
        f.impact,
        JSON.stringify(f.evidence),
        f.recommendedFix,
        f.state,
        f.dismissedReason,
        dismissedBy,
        f.dismissedAt,
        fixCycleId,
        review.observedAt,
        f.dismissedAt ?? review.observedAt,
      ],
    );
    counts.findings++;
    counts.byState[f.state] = (counts.byState[f.state] ?? 0) + 1;
  }
  return counts;
}

/** Truncates every table and loads S-500, the dashboard-demo project and the US4 requirements. Refuses to run in production (FR-022). */
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
  const requirementsSeed = buildRequirements(base);
  const reviewSeed = buildReviewSeed(base);
  const passwordHash = await hashPassword(password);

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `TRUNCATE review_findings, reviews, review_cycles, pull_requests, requirement_transitions, requirement_analysis_items, requirements, integration_project_mappings, audit_events, inbox_change_log, ingestion_log, test_runs, artifacts, agent_runs, workflow_stages, workflow_transitions, approvals, clarifications, workflows, sessions, project_memberships, ingestion_principals, users, projects, organizations RESTART IDENTITY CASCADE`,
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

    const userIds = new Map<string, string>();
    for (const u of users) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO users (organization_id, email, display_name, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [org, u.email, u.displayName, passwordHash, u.role],
      );
      userIds.set(u.email, r.rows[0]!.id);
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
    // specs/001 US5: `s500-clr-01` drills into a showcase run, so its link resolves after the runs exist.
    await resolveAgentRunLinks(ctx, s500Counts.runIds);
    // specs/001 US3 dashboard-demo (research R30): written after S-500 so S-500 row order is unchanged.
    const dash = await insertWorkflows(ctx, dashboard.workflows);
    const dashCounts = await insertShowcase(ctx, dashboard.showcase, dash.refs);
    // specs/001 US4 requirements (research R44): links point at S-500 rows, so they come last.
    const requirementCounts = await insertRequirements(ctx, requirementsSeed, userIds, s500.refs);
    // specs/001 US6 review seed: after requirements so PR #1821 inherits s500-001's requirement link.
    const reviewCounts = await insertReviews(
      ctx,
      reviewSeed,
      userIds,
      s500.refs,
      s500Counts.runIds,
    );
    const approvals = s500.approvals + dash.approvals;
    const clarifications = s500.clarifications + dash.clarifications;
    const counts = {
      stages: s500Counts.stages + dashCounts.stages,
      runs: s500Counts.runs + dashCounts.runs,
      artifacts: s500Counts.artifacts + dashCounts.artifacts,
      testRuns: s500Counts.testRuns + dashCounts.testRuns,
      agentDecisions: s500Counts.agentDecisions + dashCounts.agentDecisions,
    };
    // The seed's own inserts should not count as "changes" for SSE replay.
    await client.query(`TRUNCATE inbox_change_log RESTART IDENTITY`);
    await client.query('COMMIT');

    log(`Seeded S-500 + dashboard-demo into organization ${org} (base ${base.toISOString()})`);
    log(
      `  users: ${users.length}  workflows: ${workflows.length + dashboard.workflows.length}  approvals: ${approvals}  clarifications: ${clarifications}`,
    );
    log(
      `  showcase (${showcase.map((s) => s.externalId).join(', ')}): stages ${s500Counts.stages}  runs ${s500Counts.runs}  artifacts ${s500Counts.artifacts}  test runs ${s500Counts.testRuns}  agent decisions ${s500Counts.agentDecisions}`,
    );
    log(
      `  ${DASHBOARD_PROJECT.key}: workflows ${dashboard.workflows.length}  approvals ${dash.approvals}  clarifications ${dash.clarifications}  stages ${dashCounts.stages}  runs ${dashCounts.runs}  test runs ${dashCounts.testRuns}`,
    );
    log(
      `  requirements: ${requirementCounts.total} (${Object.entries(requirementCounts.byState)
        .map(([s, c]) => `${s} ${c}`)
        .join(
          ', ',
        )})  analysis items ${requirementCounts.analysisItems} (${requirementCounts.aiGenerated} AI-generated)  transitions ${requirementCounts.transitions}  linked workflows ${requirementCounts.linkedWorkflows}  Jira mappings ${requirementCounts.mappings}`,
    );
    log(
      `  reviews: PR #${reviewSeed.pullRequest.number} (${reviewSeed.pullRequest.externalId}) reviews ${reviewCounts.reviews}  findings ${reviewCounts.findings} (${Object.entries(
        reviewCounts.byState,
      )
        .map(([s, c]) => `${s} ${c}`)
        .join(', ')})  cycles ${reviewCounts.cycles}`,
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
        requirements: requirementCounts,
        reviews: reviewCounts,
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
