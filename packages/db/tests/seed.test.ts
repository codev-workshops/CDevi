import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ARTIFACT_TYPES } from '@cdevi/contracts';
import {
  buildS500,
  DECISION_SHOWCASE,
  EXPECTED_AGENT_DECISIONS,
  EXPECTED_BUCKETS,
  EXPECTED_SHOWCASE,
  SHOWCASE_FAILED,
  SHOWCASE_WAITING,
  STAGES,
} from '../src/seed/s500';
import {
  buildDashboardShowcase,
  DASHBOARD_FIGURES,
  DASHBOARD_PROJECT,
  EXPECTED_DASHBOARD,
} from '../src/seed/dashboard';
import {
  buildRequirements,
  EXPECTED_REQUIREMENTS,
  JIRA_MAPPING,
  REQUIREMENT_SHOWCASE,
} from '../src/seed/requirements';
import { buildReviewSeed, EXPECTED_REVIEW_SEED } from '../src/seed/reviews';
import { seed, SeedRefusedError } from '../src/seed/index';
import {
  blockingOpenCount,
  LaneResult,
  laneStatusFromFindings,
  readyForMerge,
  REVIEW_LANES,
  ReviewIngest,
} from '@cdevi/contracts';

const BASE = new Date('2026-09-14T09:00:00Z');
const DAY = 86_400_000;

describe('S-500 seed dataset (data-model.md §7)', () => {
  it('is deterministic and has the specified bucket counts', () => {
    const a = buildS500(BASE);
    const b = buildS500(BASE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const w = a.workflows;
    expect(w).toHaveLength(EXPECTED_BUCKETS.total);
    expect(a.users).toHaveLength(EXPECTED_BUCKETS.users);
    expect(w.filter((x) => x.approval)).toHaveLength(EXPECTED_BUCKETS.approvals);
    expect(w.filter((x) => x.clarification)).toHaveLength(EXPECTED_BUCKETS.clarifications);
    expect(w.filter((x) => x.state === 'BLOCKED')).toHaveLength(EXPECTED_BUCKETS.blocked);
    expect(w.filter((x) => x.state === 'FAILED')).toHaveLength(EXPECTED_BUCKETS.failed);
    for (const [s, c] of Object.entries({ ...EXPECTED_BUCKETS.running, ...EXPECTED_BUCKETS.done }))
      expect(
        w.filter((x) => x.state === s),
        s,
      ).toHaveLength(c);
    const approvals = w.map((x) => x.approval).filter(Boolean);
    for (const r of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
      expect(approvals.filter((x) => x!.riskLevel === r)).toHaveLength(6);
    expect(approvals.filter((x) => x!.expiresAt)).toHaveLength(4);
    expect(approvals.filter((x) => x!.expiresAt && x!.expiresAt < BASE)).toHaveLength(1);
    expect(
      approvals.filter((x) => BASE.getTime() - x!.requestedAt.getTime() > 24 * 3_600_000),
    ).toHaveLength(3);
    expect(w.filter((x) => x.clarification?.hasRecommendedAnswer)).toHaveLength(6);
    const outside = w.filter(
      (x) => x.finishedAt && BASE.getTime() - x.finishedAt.getTime() > 7 * 86_400_000,
    );
    expect(outside.length).toBeGreaterThanOrEqual(40);
    expect(outside.length).toBeLessThanOrEqual(50);
    expect(w.filter((x) => x.state === 'COMPLETED' && !x.pullRequestRef)).toHaveLength(0);
    expect(a.users.filter((u) => u.role === 'administrator')).toHaveLength(1);
    expect(
      a.users.filter((u) => u.role !== 'administrator' && u.projects.length === 0),
    ).toHaveLength(0);
  });

  it('SC-001 showcase is deterministic and matches EXPECTED_SHOWCASE counts', () => {
    const a = buildS500(BASE);
    const b = buildS500(BASE);
    expect(JSON.stringify(a.showcase)).toBe(JSON.stringify(b.showcase));
    expect(a.showcase).toHaveLength(EXPECTED_SHOWCASE.workflows);
    const sum = (k: 'stages' | 'runs' | 'artifacts' | 'testRuns') =>
      a.showcase.reduce((n, s) => n + s[k].length, 0);
    expect(sum('stages')).toBe(EXPECTED_SHOWCASE.stages);
    expect(sum('runs')).toBe(EXPECTED_SHOWCASE.runs);
    expect(sum('artifacts')).toBe(EXPECTED_SHOWCASE.artifacts);
    expect(sum('testRuns')).toBe(EXPECTED_SHOWCASE.testRuns);
    // Bucket counts of 003 are untouched by the showcase.
    expect(a.workflows).toHaveLength(EXPECTED_BUCKETS.total);
    for (const s of a.showcase) {
      const positions = s.stages.map((x) => x.position);
      expect(positions).toEqual([1, 2, 3, 4, 5, 6, 7]);
      for (const r of [...s.runs, ...s.artifacts, ...s.testRuns])
        expect(positions).toContain(r.stagePosition);
    }
  });

  it(`SC-001 ${SHOWCASE_WAITING} has a full journey: 1–5 COMPLETED with a FAILED→RETRYING history, 6 WAITING_FOR_HUMAN linked to its approval, 7 QUEUED, every artifact type, a failed then passed unit run`, () => {
    const { workflows, showcase } = buildS500(BASE);
    const w = workflows.find((x) => x.externalId === SHOWCASE_WAITING)!;
    const s = showcase.find((x) => x.externalId === SHOWCASE_WAITING)!;
    expect(w.state).toBe('WAITING_FOR_HUMAN');
    expect(w.approval?.riskLevel).toBe('CRITICAL');
    expect(w.stageIndex).toBe(6);
    expect(s.stages.map((x) => x.state)).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'WAITING_FOR_HUMAN',
      'QUEUED',
    ]);
    const testing = s.stages[4]!;
    expect(testing.history.map((h) => h.toState)).toEqual([
      'RUNNING',
      'FAILED',
      'RETRYING',
      'RUNNING',
      'COMPLETED',
    ]);
    const review = s.stages[5]!;
    expect(review.linkApproval).toBe(true);
    expect(review.requiresApproval).toBe(true);
    expect(review.stateReason).toBeTruthy();
    expect(review.stateObservedAt.getTime()).toBe(w.approval!.requestedAt.getTime());
    expect(new Set(s.artifacts.map((a) => a.type))).toEqual(new Set(ARTIFACT_TYPES));
    expect(s.testRuns.length).toBeGreaterThanOrEqual(4);
    const unit = s.testRuns.filter((t) => t.category === 'unit');
    expect(unit[0]!.status).toBe('FAILED');
    expect(unit[1]!.status).toBe('PASSED');
    expect(unit[1]!.startedAt.getTime()).toBeGreaterThan(unit[0]!.startedAt.getTime());
    // Every timestamp precedes the base time and stages progress in order.
    for (let i = 1; i < 6; i++)
      expect(s.stages[i]!.startedAt!.getTime()).toBeGreaterThanOrEqual(
        s.stages[i - 1]!.finishedAt!.getTime(),
      );
    for (const r of s.runs) expect(r.startedAt.getTime()).toBeLessThanOrEqual(BASE.getTime());
    expect(w.startedAt!.getTime()).toBeLessThanOrEqual(s.stages[0]!.startedAt!.getTime());
  });

  it(`FR-006 ${SHOWCASE_FAILED} has stage 5 FAILED with error_summary, stages 1–4 COMPLETED, 6–7 QUEUED and one FAILED test run`, () => {
    const { workflows, showcase } = buildS500(BASE);
    const w = workflows.find((x) => x.externalId === SHOWCASE_FAILED)!;
    const s = showcase.find((x) => x.externalId === SHOWCASE_FAILED)!;
    expect(w.state).toBe('FAILED');
    expect(w.stageIndex).toBe(5);
    expect(s.stages.map((x) => x.state)).toEqual([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'FAILED',
      'QUEUED',
      'QUEUED',
    ]);
    const failed = s.stages[4]!;
    expect(failed.errorSummary).toContain(w.stateReason);
    expect(failed.stateObservedAt.getTime()).toBe(w.stateObservedAt.getTime());
    expect(s.testRuns).toEqual([expect.objectContaining({ status: 'FAILED', stagePosition: 5 })]);
    expect(s.runs.filter((r) => r.state === 'FAILED')).toHaveLength(1);
  });

  it('refuses to run against production (FR-022)', async () => {
    await expect(seed({ env: { CDEVI_ENV: 'production' } })).rejects.toBeInstanceOf(
      SeedRefusedError,
    );
    await expect(seed({ env: { NODE_ENV: 'production' } })).rejects.toBeInstanceOf(
      SeedRefusedError,
    );
  });
});

describe.skipIf(Boolean(process.env['CDEVI_SKIP_DB_TESTS']))(
  'seed writes S-500 to the database',
  () => {
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
    afterAll(() => pool.end());

    it('SC-005 seed inserts S-500 plus dashboard-demo: 524 workflows, 20 users, a demo organization and an ingestion principal', async () => {
      const r = await seed({
        base: BASE,
        password: 'cdevi-demo-test-pass',
        ingestToken: 'cdvi_test_token',
        log: () => {},
      });
      const workflows = EXPECTED_BUCKETS.total + EXPECTED_DASHBOARD.workflows;
      expect(r.counts.workflows).toBe(workflows);
      const n = async (sql: string) => Number((await pool.query(sql)).rows[0].c);
      expect(await n('select count(*) c from workflows')).toBe(workflows);
      expect(await n('select count(*) c from users')).toBe(20);
      expect(await n(`select count(*) c from approvals where decision is null`)).toBe(
        EXPECTED_BUCKETS.approvals + EXPECTED_DASHBOARD.approvals,
      );
      expect(await n(`select count(*) c from clarifications where answered_at is null`)).toBe(
        EXPECTED_BUCKETS.clarifications + EXPECTED_DASHBOARD.clarifications,
      );
      expect(await n(`select count(*) c from organizations where is_demo`)).toBe(1);
      expect(await n(`select count(*) c from ingestion_principals where name='e2e-tests'`)).toBe(1);
      expect(await n(`select count(*) c from inbox_change_log`)).toBe(0);
    });

    it('SC-001 seeding writes the showcase rows and links the waiting stage to its approval', async () => {
      const r = await seed({
        base: BASE,
        password: 'cdevi-demo-test-pass',
        ingestToken: 'cdvi_test_token',
        log: () => {},
      });
      const expected = {
        stages: EXPECTED_SHOWCASE.stages + EXPECTED_DASHBOARD.stages,
        runs: EXPECTED_SHOWCASE.runs + EXPECTED_DASHBOARD.runs,
        artifacts: EXPECTED_SHOWCASE.artifacts,
        testRuns: EXPECTED_SHOWCASE.testRuns + EXPECTED_DASHBOARD.testRuns,
      };
      expect(r.counts).toMatchObject(expected);
      const n = async (sql: string) => Number((await pool.query(sql)).rows[0].c);
      expect(await n('select count(*) c from workflow_stages')).toBe(expected.stages);
      expect(await n('select count(*) c from agent_runs')).toBe(expected.runs);
      expect(await n('select count(*) c from artifacts')).toBe(expected.artifacts);
      expect(await n('select count(*) c from test_runs')).toBe(expected.testRuns);
      expect(
        await n(
          `select count(*) c from workflow_stages s join approvals a on a.id = s.approval_id where s.state = 'WAITING_FOR_HUMAN'`,
        ),
      ).toBe(1);
      const stageTransitions = (showcase: { stages: { history: unknown[] }[] }[]) =>
        showcase.reduce((t, s) => t + s.stages.reduce((u, st) => u + st.history.length, 0), 0);
      expect(
        await n(`select count(*) c from workflow_transitions where stage_id is not null`),
      ).toBe(
        stageTransitions(buildS500(BASE).showcase) +
          stageTransitions(buildDashboardShowcase(BASE).showcase),
      );
      expect(await n(`select count(*) c from inbox_change_log`)).toBe(0);
    });
  },
);

describe('S-500 decision showcase (specs/001 US2, data-model.md §13)', () => {
  it('SC-006 decision showcase is deterministic: s500-apr-req (LOW), s500-apr-pr (MEDIUM, links.pullRequest), s500-clr-01 (why_it_matters, 3 options, 5 links) on three distinct WAITING_FOR_HUMAN workflows', () => {
    const a = buildS500(BASE);
    const req = a.workflows.find((w) => w.approval?.externalId === DECISION_SHOWCASE.requirement)!;
    const pr = a.workflows.find((w) => w.approval?.externalId === DECISION_SHOWCASE.pullRequest)!;
    const clr = a.workflows.find(
      (w) => w.clarification?.externalId === DECISION_SHOWCASE.clarification,
    )!;
    expect(new Set([req.externalId, pr.externalId, clr.externalId]).size).toBe(3);
    for (const w of [req, pr, clr]) expect(w.state).toBe('WAITING_FOR_HUMAN');
    expect(req.approval!.riskLevel).toBe('LOW');
    expect(req.approval!.ask).toMatch(/requirement/i);
    expect(req.approval!.context).toBeTruthy();
    expect(req.approval!.links.requirement).toMatch(/^\//);
    expect(pr.approval!.riskLevel).toBe('MEDIUM');
    expect(pr.approval!.ask).toMatch(/merge/i);
    expect(pr.approval!.links.pullRequest).toMatch(/^https:\/\//);
    expect(clr.clarification!.whyItMatters).toBeTruthy();
    expect(clr.clarification!.options).toHaveLength(3);
    expect(clr.clarification!.options.filter((o) => o.recommended)).toHaveLength(1);
    expect(clr.clarification!.hasRecommendedAnswer).toBe(true);
    expect(Object.keys(clr.clarification!.links).sort()).toEqual([
      'agentRun',
      'externalTicket',
      'pullRequest',
      'requirement',
      'workflow',
    ]);
    expect(a.workflows.filter((w) => w.approval)).toHaveLength(EXPECTED_BUCKETS.approvals);
    expect(a.workflows.filter((w) => w.clarification)).toHaveLength(
      EXPECTED_BUCKETS.clarifications,
    );
  });

  describe.skipIf(Boolean(process.env['CDEVI_SKIP_DB_TESTS']))('written to the database', () => {
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
    afterAll(() => pool.end());

    it('SC-006 seeding writes context/links/options and leaves audit_events empty', async () => {
      await seed({
        base: BASE,
        password: 'cdevi-demo-test-pass',
        ingestToken: 'cdvi_test_token',
        log: () => {},
      });
      const n = async (sql: string) => Number((await pool.query(sql)).rows[0].c);
      expect(await n('select count(*) c from audit_events')).toBe(0);
      expect(await n(`select count(*) c from approvals where decision is null`)).toBe(
        EXPECTED_BUCKETS.approvals + EXPECTED_DASHBOARD.approvals,
      );
      const pr = (
        await pool.query(
          `select a.risk_level, a.context, a.links, w.state from approvals a join workflows w on w.id = a.workflow_id where a.external_id = $1`,
          [DECISION_SHOWCASE.pullRequest],
        )
      ).rows[0];
      expect(pr.risk_level).toBe('MEDIUM');
      expect(pr.state).toBe('WAITING_FOR_HUMAN');
      expect(pr.links.pullRequest).toMatch(/^https:\/\//);
      const clr = (
        await pool.query(
          `select why_it_matters, options, links, has_recommended_answer from clarifications where external_id = $1`,
          [DECISION_SHOWCASE.clarification],
        )
      ).rows[0];
      expect(clr.why_it_matters).toBeTruthy();
      expect(clr.options).toHaveLength(3);
      expect(clr.has_recommended_answer).toBe(true);
      expect(Object.keys(clr.links)).toHaveLength(5);
    });

    it('SC-006 seeded links.workflow points at the workflow row id the web route resolves', async () => {
      await seed({
        base: BASE,
        password: 'cdevi-demo-test-pass',
        ingestToken: 'cdvi_test_token',
        log: () => {},
      });
      const rows = (
        await pool.query<{ link: string; workflow_id: string }>(
          `select links->>'workflow' link, workflow_id from approvals where links ? 'workflow'
           union all
           select links->>'workflow', workflow_id from clarifications where links ? 'workflow'`,
        )
      ).rows;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.link).toBe(`/workflows/${r.workflow_id}`);
    });
  });
});

describe('dashboard-demo seed (specs/001 US3, data-model.md §21)', () => {
  const ACTIVE = new Set([
    'QUEUED',
    'RUNNING',
    'RETRYING',
    'WAITING',
    'WAITING_FOR_HUMAN',
    'BLOCKED',
    'FAILED',
  ]);
  const build = () => buildDashboardShowcase(BASE);
  const inWindow = (d: Date | null) =>
    d !== null && BASE.getTime() - d.getTime() >= DAY && BASE.getTime() - d.getTime() <= 3 * DAY;

  it('FR-023 buildDashboardShowcase is deterministic and leaves buildS500 byte-for-byte unchanged', () => {
    const before = JSON.stringify(buildS500(BASE));
    const a = build();
    const b = build();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(buildS500(BASE))).toBe(before);
    expect(a.project).toEqual({ key: 'dashboard-demo', name: 'Dashboard Demo' });
    expect(DASHBOARD_PROJECT).toEqual(a.project);
  });

  it('FR-023 has 24 workflows s500-d01…s500-d24 on dashboard-demo, 18 active with stage counts 3/2/1/4/3/3/2', () => {
    const { workflows } = build();
    expect(workflows).toHaveLength(EXPECTED_DASHBOARD.workflows);
    expect(workflows.map((w) => w.externalId)).toEqual(
      Array.from({ length: 24 }, (_, i) => `s500-d${String(i + 1).padStart(2, '0')}`),
    );
    for (const w of workflows) expect(w.project).toBe(DASHBOARD_PROJECT.key);
    const active = workflows.filter((w) => ACTIVE.has(w.state));
    expect(active).toHaveLength(EXPECTED_DASHBOARD.active);
    const perStage = [1, 2, 3, 4, 5, 6, 7].map(
      (n) => active.filter((w) => w.stageIndex === n).length,
    );
    expect(perStage).toEqual([3, 2, 1, 4, 3, 3, 2]);
    expect(perStage).toEqual([...DASHBOARD_FIGURES.stages]);
    for (const w of active)
      expect(BASE.getTime() - w.stateObservedAt.getTime(), w.externalId).toBeLessThanOrEqual(
        12 * 3_600_000,
      );
    for (const w of workflows) expect(w.stageName).toBe(STAGES[w.stageIndex - 1]);
  });

  it('FR-023 needs-me: 4 pending approvals (CRITICAL, HIGH, MEDIUM, LOW), 2 pending clarifications, 1 FAILED and 1 BLOCKED', () => {
    const { workflows } = build();
    const approvals = workflows.filter((w) => w.approval);
    expect(approvals).toHaveLength(EXPECTED_DASHBOARD.approvals);
    expect(approvals.map((w) => w.approval!.riskLevel).sort()).toEqual(
      ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].sort(),
    );
    for (const w of approvals) expect(w.state).toBe('WAITING_FOR_HUMAN');
    const clarifications = workflows.filter((w) => w.clarification);
    expect(clarifications).toHaveLength(EXPECTED_DASHBOARD.clarifications);
    for (const w of clarifications) expect(w.state).toBe('WAITING_FOR_HUMAN');
    expect(workflows.filter((w) => w.approval && w.clarification)).toHaveLength(0);
    expect(workflows.filter((w) => w.state === 'WAITING_FOR_HUMAN')).toHaveLength(6);
    expect(workflows.filter((w) => w.state === 'FAILED')).toHaveLength(1);
    expect(workflows.filter((w) => w.state === 'BLOCKED')).toHaveLength(1);
    expect(workflows.find((w) => w.state === 'BLOCKED')!.stateReason).toBeTruthy();
    expect(workflows.find((w) => w.state === 'FAILED')!.stateReason).toBeTruthy();
    const ids = [
      ...approvals.map((w) => w.approval!.externalId),
      ...clarifications.map((w) => w.clarification!.externalId),
    ];
    expect(new Set(ids).size).toBe(6);
    for (const w of approvals)
      expect(w.approval!.links.workflow).toBe(`/workflows/${w.externalId}`);
    for (const w of clarifications)
      expect(w.clarification!.links.workflow).toBe(`/workflows/${w.externalId}`);
  });

  it('FR-023 counts: 7 RUNNING/RETRYING workflows, 6 pull_request_refs, 2 QUEUED without started_at, 5 COMPLETED and 1 CANCELLED', () => {
    const { workflows } = build();
    expect(workflows.filter((w) => w.state === 'RUNNING' || w.state === 'RETRYING')).toHaveLength(
      DASHBOARD_FIGURES.runningAgents,
    );
    expect(workflows.filter((w) => w.pullRequestRef)).toHaveLength(DASHBOARD_FIGURES.prsGenerated);
    const completed = workflows.filter((w) => w.state === 'COMPLETED');
    expect(completed).toHaveLength(5);
    for (const w of completed) {
      expect(w.pullRequestRef).toBeTruthy();
      expect(inWindow(w.finishedAt), w.externalId).toBe(true);
    }
    const pendingPr = workflows.filter((w) => w.pullRequestRef && w.state !== 'COMPLETED');
    expect(pendingPr).toHaveLength(1);
    expect(pendingPr[0]!.approval?.riskLevel).toBe('MEDIUM');
    expect(pendingPr[0]!.stageIndex).toBe(7);
    const cancelled = workflows.filter((w) => w.state === 'CANCELLED');
    expect(cancelled).toHaveLength(1);
    expect(BASE.getTime() - cancelled[0]!.finishedAt!.getTime()).toBeGreaterThan(3 * DAY);
    expect(BASE.getTime() - cancelled[0]!.finishedAt!.getTime()).toBeLessThan(7 * DAY);
    const queued = workflows.filter((w) => w.state === 'QUEUED');
    expect(queued).toHaveLength(2);
    for (const w of queued) expect(w.startedAt).toBeNull();
    for (const w of workflows.filter((w) => w.state !== 'QUEUED'))
      expect(w.startedAt).not.toBeNull();
    for (const w of workflows.filter((w) => ACTIVE.has(w.state))) expect(w.finishedAt).toBeNull();
    // Human intervention: 4 approvals + 2 clarifications + 2 decided approvals = 8 of 24.
    const decided = workflows.filter((w) => w.decidedApproval);
    expect(decided).toHaveLength(2);
    for (const w of decided) expect(w.state).toBe('COMPLETED');
    expect(
      workflows.filter((w) => w.approval || w.clarification || w.decidedApproval),
    ).toHaveLength(DASHBOARD_FIGURES.intervention.numerator);
    expect(DASHBOARD_FIGURES.intervention.denominator).toBe(EXPECTED_DASHBOARD.workflows);
  });

  it('FR-023 showcase rows: 43 stages, 44 agent runs, 6 test runs, no artifacts; every row belongs to a dashboard workflow and stage', () => {
    const { workflows, showcase } = build();
    const sum = (k: 'stages' | 'runs' | 'artifacts' | 'testRuns') =>
      showcase.reduce((n, s) => n + s[k].length, 0);
    expect(sum('stages')).toBe(EXPECTED_DASHBOARD.stages);
    expect(sum('runs')).toBe(EXPECTED_DASHBOARD.runs);
    expect(sum('testRuns')).toBe(EXPECTED_DASHBOARD.testRuns);
    expect(sum('artifacts')).toBe(0);
    const ids = new Set(workflows.map((w) => w.externalId));
    const externalIds = new Set<string>();
    for (const s of showcase) {
      expect(ids.has(s.externalId), s.externalId).toBe(true);
      const positions = s.stages.map((x) => x.position);
      expect(new Set(positions).size).toBe(positions.length);
      for (const r of [...s.runs, ...s.testRuns]) {
        expect(positions).toContain(r.stagePosition);
        expect(externalIds.has(r.externalId), r.externalId).toBe(false);
        externalIds.add(r.externalId);
      }
      for (const r of s.runs) expect(r.state).not.toBe('QUEUED');
    }
    expect(new Set(showcase.map((s) => s.externalId)).size).toBe(showcase.length);
    const completed = workflows.filter((w) => w.state === 'COMPLETED').map((w) => w.externalId);
    for (const id of completed) {
      const s = showcase.find((x) => x.externalId === id)!;
      expect(s.stages.map((x) => x.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(s.stages.every((x) => x.state === 'COMPLETED')).toBe(true);
    }
  });

  it('SC-005 health: test runs total 974 passed of 1 000, finished agent runs 35 completed of 37, 7 unfinished; every finished_at is 1–3 days before base', () => {
    const { workflows, showcase } = build();
    const testRuns = showcase.flatMap((s) => s.testRuns);
    const passed = testRuns.reduce((n, t) => n + t.passed, 0);
    const total = testRuns.reduce((n, t) => n + t.passed + t.failed, 0);
    expect(passed).toBe(974);
    expect(total).toBe(1000);
    expect(DASHBOARD_FIGURES.testPassRate).toEqual({ passed: 974, total: 1000 });
    for (const t of testRuns) {
      expect(t.passed + t.failed + t.skipped).toBeLessThanOrEqual(t.total);
      expect(inWindow(t.finishedAt), t.externalId).toBe(true);
      expect(t.startedAt.getTime()).toBeLessThan(t.finishedAt!.getTime());
    }
    expect(testRuns.filter((t) => t.status === 'FAILED')).toHaveLength(1);
    expect(testRuns.filter((t) => t.status === 'PASSED')).toHaveLength(5);
    const failedWorkflow = workflows.find((w) => w.state === 'FAILED')!;
    expect(showcase.find((s) => s.externalId === failedWorkflow.externalId)!.testRuns).toEqual([
      expect.objectContaining({ status: 'FAILED', total: 100, passed: 89, failed: 11 }),
    ]);

    const runs = showcase.flatMap((s) => s.runs);
    const finished = runs.filter((r) => r.finishedAt !== null);
    expect(finished).toHaveLength(37);
    expect(finished.filter((r) => r.state === 'COMPLETED')).toHaveLength(35);
    expect(finished.filter((r) => r.state === 'FAILED')).toHaveLength(2);
    expect(DASHBOARD_FIGURES.agentSuccess).toEqual({ completed: 35, finished: 37 });
    for (const r of finished) {
      expect(inWindow(r.finishedAt), r.externalId).toBe(true);
      expect(r.startedAt.getTime()).toBeLessThan(r.finishedAt!.getTime());
    }
    const unfinished = runs.filter((r) => r.finishedAt === null);
    expect(unfinished).toHaveLength(7);
    expect(unfinished.map((r) => r.state).sort()).toEqual(
      ['RETRYING', ...Array<string>(6).fill('RUNNING')].sort(),
    );
    for (const r of unfinished) expect(r.startedAt.getTime()).toBeLessThanOrEqual(BASE.getTime());
    // Risk area: two of the pending approvals are HIGH/CRITICAL; the seed writes no audit events.
    expect(
      workflows.filter(
        (w) =>
          w.approval && (w.approval.riskLevel === 'HIGH' || w.approval.riskLevel === 'CRITICAL'),
      ),
    ).toHaveLength(DASHBOARD_FIGURES.pendingHighCritical);
  });

  describe.skipIf(Boolean(process.env['CDEVI_SKIP_DB_TESTS']))('written to the database', () => {
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
    afterAll(() => pool.end());

    it('FR-023 seeding writes EXPECTED_DASHBOARD rows for dashboard-demo with no memberships and leaves audit_events empty', async () => {
      const r = await seed({
        base: BASE,
        password: 'cdevi-demo-test-pass',
        ingestToken: 'cdvi_test_token',
        log: () => {},
      });
      expect(r.counts.dashboard).toEqual(EXPECTED_DASHBOARD);
      const project = (
        await pool.query(`select id, name from projects where key = $1`, [DASHBOARD_PROJECT.key])
      ).rows[0];
      expect(project.name).toBe(DASHBOARD_PROJECT.name);
      const n = async (sql: string) => Number((await pool.query(sql, [project.id])).rows[0].c);
      expect(await n(`select count(*) c from project_memberships where project_id = $1`)).toBe(0);
      expect(await n(`select count(*) c from workflows where project_id = $1`)).toBe(
        EXPECTED_DASHBOARD.workflows,
      );
      expect(
        await n(
          `select count(*) c from workflows where project_id = $1 and state not in ('COMPLETED','CANCELLED')`,
        ),
      ).toBe(EXPECTED_DASHBOARD.active);
      expect(
        await n(`select count(*) c from approvals where project_id = $1 and decision is null`),
      ).toBe(EXPECTED_DASHBOARD.approvals);
      expect(
        await n(`select count(*) c from approvals where project_id = $1 and decision is not null`),
      ).toBe(2);
      expect(
        await n(
          `select count(*) c from clarifications where project_id = $1 and answered_at is null`,
        ),
      ).toBe(EXPECTED_DASHBOARD.clarifications);
      expect(await n(`select count(*) c from workflow_stages where project_id = $1`)).toBe(
        EXPECTED_DASHBOARD.stages,
      );
      expect(await n(`select count(*) c from agent_runs where project_id = $1`)).toBe(
        EXPECTED_DASHBOARD.runs,
      );
      expect(await n(`select count(*) c from test_runs where project_id = $1`)).toBe(
        EXPECTED_DASHBOARD.testRuns,
      );
      expect(await n(`select count(*) c from artifacts where project_id = $1`)).toBe(0);
      expect(
        await n(
          `select coalesce(sum(passed),0) c from test_runs where project_id = $1 and finished_at is not null`,
        ),
      ).toBe(974);
      expect(Number((await pool.query(`select count(*) c from audit_events`)).rows[0].c)).toBe(0);
      const principal = (
        await pool.query(`select project_ids from ingestion_principals where name='e2e-tests'`)
      ).rows[0];
      expect(principal.project_ids).toContain(project.id);
      const links = (
        await pool.query<{ link: string; workflow_id: string }>(
          `select links->>'workflow' link, workflow_id from approvals where project_id = $1 and links ? 'workflow'
           union all
           select links->>'workflow', workflow_id from clarifications where project_id = $1 and links ? 'workflow'`,
          [project.id],
        )
      ).rows;
      expect(links).toHaveLength(EXPECTED_DASHBOARD.approvals + EXPECTED_DASHBOARD.clarifications);
      for (const l of links) expect(l.link).toBe(`/workflows/${l.workflow_id}`);
    });
  });
});

describe('requirements seed (specs/001 US4, data-model.md §30, research R44)', () => {
  const LIFECYCLE = [
    'DRAFT',
    'ANALYZING',
    'NEEDS_CLARIFICATION',
    'READY',
    'APPROVED',
    'IN_IMPLEMENTATION',
    'COMPLETED',
    'REJECTED',
  ];

  it('FR-009 buildRequirements is deterministic: eight requirements req-seed-001…008, one per state in lifecycle order, req-seed-003 is source jira PAY-231 with 2 open questions, 28 analysis items of which 26 ai_generated, human items carry source user:Engineer 1', () => {
    const a = buildRequirements(BASE);
    const b = buildRequirements(BASE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(buildS500(BASE))).toBe(JSON.stringify(buildS500(BASE)));
    const { requirements, mapping } = a;
    expect(requirements).toHaveLength(EXPECTED_REQUIREMENTS.total);
    expect(requirements.map((r) => r.externalId)).toEqual(
      Array.from({ length: 8 }, (_, i) => `req-seed-${String(i + 1).padStart(3, '0')}`),
    );
    expect(requirements.map((r) => r.state)).toEqual(LIFECYCLE);
    expect(Object.values(REQUIREMENT_SHOWCASE).every((id) => id.startsWith('req-seed-'))).toBe(
      true,
    );
    expect(REQUIREMENT_SHOWCASE).toEqual({
      draft: 'req-seed-001',
      analyzing: 'req-seed-002',
      needsClarification: 'req-seed-003',
      ready: 'req-seed-004',
      approved: 'req-seed-005',
      inImplementation: 'req-seed-006',
      completed: 'req-seed-007',
      rejected: 'req-seed-008',
      jira: 'req-seed-003',
    });
    for (const r of requirements) expect(r.project).toBe('payments-api');
    requirements.forEach((r, i) => {
      expect(r.createdAt.getTime(), r.externalId).toBe(BASE.getTime() - (9 - (i + 1)) * DAY);
      expect(r.title.length).toBeGreaterThanOrEqual(3);
      expect(r.businessObjective.length).toBeGreaterThanOrEqual(10);
    });

    const jira = requirements.find((r) => r.externalId === REQUIREMENT_SHOWCASE.jira)!;
    expect(jira.state).toBe('NEEDS_CLARIFICATION');
    expect(jira.source).toBe('jira');
    expect(jira.externalRef).toMatchObject({
      provider: 'jira',
      key: 'PAY-231',
      url: 'https://jira.example.invalid/browse/PAY-231',
    });
    expect(jira.externalRef!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(jira.assignee).toBe('approver1@cdevi.demo');
    expect(jira.createdBy).toBeNull();
    expect(jira.items.filter((i) => i.kind === 'open_question')).toHaveLength(2);
    expect(requirements.filter((r) => r.source === 'jira')).toHaveLength(
      EXPECTED_REQUIREMENTS.jiraLinked,
    );
    for (const r of requirements.filter((r) => r.source === 'manual'))
      expect(r.externalRef, r.externalId).toBeNull();

    const items = requirements.flatMap((r) => r.items.map((i) => ({ ...i, req: r.externalId })));
    expect(items).toHaveLength(EXPECTED_REQUIREMENTS.analysisItems);
    expect(items.filter((i) => i.aiGenerated)).toHaveLength(EXPECTED_REQUIREMENTS.aiGenerated);
    expect(items.filter((i) => i.kind === 'open_question')).toHaveLength(
      EXPECTED_REQUIREMENTS.openQuestions,
    );
    const human = items.filter((i) => !i.aiGenerated);
    expect(human).toHaveLength(2);
    for (const h of human) {
      expect(h.source).toBe('user:Engineer 1');
      expect(h.kind).toBe('acceptance_criterion');
      expect(h.req).toBe(REQUIREMENT_SHOWCASE.draft);
    }
    for (const i of items.filter((i) => i.aiGenerated))
      expect(i.source).toBe('agent:Requirement Agent');
    // Positions are 1..n per (requirement, kind, ai_generated) — the 0005 unique key.
    for (const r of requirements) {
      const groups = new Map<string, number[]>();
      for (const i of r.items) {
        const k = `${i.kind}:${i.aiGenerated}`;
        groups.set(k, [...(groups.get(k) ?? []), i.position]);
      }
      for (const [k, positions] of groups)
        expect(positions, `${r.externalId} ${k}`).toEqual(positions.map((_, n) => n + 1));
    }
    // Items only where the state implies analysis happened (or a human authored criteria).
    expect(requirements.find((r) => r.state === 'ANALYZING')!.items).toEqual([]);
    expect(requirements.find((r) => r.state === 'REJECTED')!.items).toEqual([]);
    expect(
      requirements
        .find((r) => r.state === 'READY')!
        .items.filter((i) => i.kind === 'open_question'),
    ).toEqual([]);

    expect(mapping).toEqual(JIRA_MAPPING);
    expect(JIRA_MAPPING).toEqual({
      provider: 'jira',
      externalProjectKey: 'PAY',
      projectKey: 'payments-api',
      baseUrl: 'https://jira.example.invalid',
    });
  });

  it('FR-009 buildRequirements records 26 requirement_transitions in lifecycle order with system actors for the workflow-driven ones and three S-500 workflow links', () => {
    const { requirements } = buildRequirements(BASE);
    const per = Object.fromEntries(requirements.map((r) => [r.externalId, r.transitions.length]));
    expect(per).toEqual({
      'req-seed-001': 1,
      'req-seed-002': 2,
      'req-seed-003': 3,
      'req-seed-004': 3,
      'req-seed-005': 4,
      'req-seed-006': 5,
      'req-seed-007': 6,
      'req-seed-008': 2,
    });
    expect(requirements.reduce((n, r) => n + r.transitions.length, 0)).toBe(
      EXPECTED_REQUIREMENTS.transitions,
    );
    for (const r of requirements) {
      expect(r.transitions[0]!.fromState).toBeNull();
      expect(r.transitions[0]!.toState).toBe('DRAFT');
      expect(r.transitions.at(-1)!.toState).toBe(r.state);
      for (let i = 1; i < r.transitions.length; i++) {
        expect(r.transitions[i]!.fromState, r.externalId).toBe(r.transitions[i - 1]!.toState);
        expect(r.transitions[i]!.occurredAt.getTime(), r.externalId).toBeGreaterThan(
          r.transitions[i - 1]!.occurredAt.getTime(),
        );
      }
      expect(r.transitions[0]!.occurredAt.getTime()).toBe(r.createdAt.getTime());
      expect(r.transitions.at(-1)!.occurredAt.getTime()).toBeLessThanOrEqual(BASE.getTime());
    }
    const byId = (id: string) => requirements.find((r) => r.externalId === id)!;
    expect(byId('req-seed-003').transitions.map((t) => t.toState)).toEqual([
      'DRAFT',
      'ANALYZING',
      'NEEDS_CLARIFICATION',
    ]);
    expect(byId('req-seed-003').transitions[2]).toMatchObject({
      actorType: 'agent',
      actorName: 'Requirement Agent',
    });
    expect(byId('req-seed-006').transitions.at(-1)).toMatchObject({
      fromState: 'APPROVED',
      toState: 'IN_IMPLEMENTATION',
      actorType: 'system',
      actorName: 'workflow',
    });
    const completed = byId('req-seed-007').transitions;
    expect(completed.map((t) => t.toState)).toEqual([
      'DRAFT',
      'ANALYZING',
      'READY',
      'APPROVED',
      'IN_IMPLEMENTATION',
      'COMPLETED',
    ]);
    expect(completed.slice(-2).map((t) => t.actorType)).toEqual(['system', 'system']);
    expect(byId('req-seed-008').transitions.map((t) => t.toState)).toEqual(['DRAFT', 'REJECTED']);
    expect(byId('req-seed-008').rejectionReason).toBe('Duplicate of req-seed-004');
    expect(byId('req-seed-008').transitions[1]!.reason).toBe('Duplicate of req-seed-004');
    expect(byId('req-seed-008').rejectedBy).toBe('approver1@cdevi.demo');
    expect(byId('req-seed-005').approvedBy).toBe('approver1@cdevi.demo');
    expect(byId('req-seed-002').submittedBy).toBe('engineer1@cdevi.demo');
    expect(byId('req-seed-001').createdBy).toBe('engineer1@cdevi.demo');

    // Links stay inside payments-api (the requirements' project): first S-500 row of that state by external_id.
    const s500 = buildS500(BASE).workflows;
    const first = (state: string) =>
      [...s500]
        .filter((w) => w.state === state && w.project === 'payments-api')
        .sort((x, y) => x.externalId.localeCompare(y.externalId))[0]!.externalId;
    const linked = requirements.filter((r) => r.linkedWorkflow !== null);
    expect(linked.map((r) => r.externalId)).toEqual([
      'req-seed-005',
      'req-seed-006',
      'req-seed-007',
    ]);
    expect(linked).toHaveLength(EXPECTED_REQUIREMENTS.linkedWorkflows);
    expect(byId('req-seed-005').linkedWorkflow).toBe(first('QUEUED'));
    expect(byId('req-seed-006').linkedWorkflow).toBe(SHOWCASE_WAITING);
    expect(byId('req-seed-007').linkedWorkflow).toBe(first('COMPLETED'));
  });

  describe.skipIf(Boolean(process.env['CDEVI_SKIP_DB_TESTS']))('written to the database', () => {
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
    afterAll(() => pool.end());
    const run = () =>
      seed({
        base: BASE,
        password: 'cdevi-demo-test-pass',
        ingestToken: 'cdvi_test_token',
        log: () => {},
      });
    const n = async (sql: string, params: unknown[] = []) =>
      Number((await pool.query(sql, params)).rows[0].c);

    it('FR-009 seed has one requirement per state and EXPECTED_REQUIREMENTS (total 8, analysisItems 28, aiGenerated 26, jiraLinked 1, linkedWorkflows 3, mappings 1) in payments-api', async () => {
      const r = await run();
      expect(r.counts.requirements).toEqual(EXPECTED_REQUIREMENTS);
      const project = (await pool.query(`select id from projects where key='payments-api'`)).rows[0]
        .id as string;
      expect(await n(`select count(*) c from requirements`)).toBe(EXPECTED_REQUIREMENTS.total);
      expect(await n(`select count(*) c from requirements where project_id=$1`, [project])).toBe(
        EXPECTED_REQUIREMENTS.total,
      );
      const byState = (
        await pool.query(`select state, count(*)::int c from requirements group by state`)
      ).rows;
      expect(Object.fromEntries(byState.map((x) => [x.state, x.c]))).toEqual(
        EXPECTED_REQUIREMENTS.byState,
      );
      expect(await n(`select count(*) c from requirement_analysis_items`)).toBe(
        EXPECTED_REQUIREMENTS.analysisItems,
      );
      expect(await n(`select count(*) c from requirement_analysis_items where ai_generated`)).toBe(
        EXPECTED_REQUIREMENTS.aiGenerated,
      );
      expect(
        await n(`select count(*) c from requirement_analysis_items where kind='open_question'`),
      ).toBe(EXPECTED_REQUIREMENTS.openQuestions);
      expect(
        await n(
          `select count(*) c from requirement_analysis_items where not ai_generated and source <> 'user:Engineer 1'`,
        ),
      ).toBe(0);
      expect(await n(`select count(*) c from requirements where source='jira'`)).toBe(
        EXPECTED_REQUIREMENTS.jiraLinked,
      );
      expect(await n(`select count(*) c from workflows where requirement_id is not null`)).toBe(
        EXPECTED_REQUIREMENTS.linkedWorkflows,
      );
      expect(await n(`select count(*) c from integration_project_mappings`)).toBe(
        EXPECTED_REQUIREMENTS.mappings,
      );
      const rows = (
        await pool.query(
          `select r.external_id, r.state, r.source, r.external_ref, r.created_at, r.title,
                  a.email assignee, c.email created_by, s.email submitted_by, ap.email approved_by, rj.email rejected_by, r.rejection_reason,
                  (select count(*)::int from requirement_analysis_items i where i.requirement_id = r.id and i.kind='open_question') open_questions
             from requirements r
             left join users a on a.id = r.assignee_user_id
             left join users c on c.id = r.created_by_user_id
             left join users s on s.id = r.submitted_by_user_id
             left join users ap on ap.id = r.approved_by_user_id
             left join users rj on rj.id = r.rejected_by_user_id
            order by r.external_id`,
        )
      ).rows;
      expect(rows.map((x) => x.external_id)).toEqual(
        buildRequirements(BASE).requirements.map((x) => x.externalId),
      );
      rows.forEach((x, i) =>
        expect(new Date(x.created_at).getTime(), x.external_id).toBe(
          BASE.getTime() - (9 - (i + 1)) * DAY,
        ),
      );
      const jira = rows.find((x) => x.external_id === REQUIREMENT_SHOWCASE.jira)!;
      expect(jira).toMatchObject({
        state: 'NEEDS_CLARIFICATION',
        source: 'jira',
        assignee: 'approver1@cdevi.demo',
        created_by: null,
        open_questions: 2,
      });
      expect(jira.external_ref).toMatchObject({
        provider: 'jira',
        key: 'PAY-231',
        url: 'https://jira.example.invalid/browse/PAY-231',
      });
      expect(rows.find((x) => x.external_id === REQUIREMENT_SHOWCASE.draft)).toMatchObject({
        created_by: 'engineer1@cdevi.demo',
      });
      expect(rows.find((x) => x.external_id === REQUIREMENT_SHOWCASE.approved)).toMatchObject({
        approved_by: 'approver1@cdevi.demo',
      });
      expect(rows.find((x) => x.external_id === REQUIREMENT_SHOWCASE.rejected)).toMatchObject({
        rejected_by: 'approver1@cdevi.demo',
        rejection_reason: 'Duplicate of req-seed-004',
      });
    });

    it('FR-010 seed links req-seed-005 to a QUEUED S-500 workflow, req-seed-006 to SHOWCASE_WAITING and req-seed-007 to a COMPLETED S-500 workflow and inserts no new workflows', async () => {
      const r = await run();
      expect(r.counts.workflows).toBe(EXPECTED_BUCKETS.total + EXPECTED_DASHBOARD.workflows);
      expect(await n(`select count(*) c from workflows`)).toBe(
        EXPECTED_BUCKETS.total + EXPECTED_DASHBOARD.workflows,
      );
      const links = (
        await pool.query(
          `select r.external_id requirement, r.state requirement_state, w.external_id workflow, w.state, p.key project
             from requirements r join workflows w on w.requirement_id = r.id join projects p on p.id = w.project_id
            order by r.external_id`,
        )
      ).rows;
      const first = (state: string) =>
        [...buildS500(BASE).workflows]
          .filter((w) => w.state === state && w.project === 'payments-api')
          .sort((x, y) => x.externalId.localeCompare(y.externalId))[0]!.externalId;
      expect(links).toEqual([
        {
          requirement: 'req-seed-005',
          requirement_state: 'APPROVED',
          workflow: first('QUEUED'),
          state: 'QUEUED',
          project: 'payments-api',
        },
        {
          requirement: 'req-seed-006',
          requirement_state: 'IN_IMPLEMENTATION',
          workflow: SHOWCASE_WAITING,
          state: 'WAITING_FOR_HUMAN',
          project: 'payments-api',
        },
        {
          requirement: 'req-seed-007',
          requirement_state: 'COMPLETED',
          workflow: first('COMPLETED'),
          state: 'COMPLETED',
          project: 'payments-api',
        },
      ]);
      // The links do not disturb S-500: buckets, showcase rows and the Dashboard project are as before.
      expect(await n(`select count(*) c from workflows where state='QUEUED'`)).toBe(
        EXPECTED_BUCKETS.running.QUEUED + 2,
      );
      expect(await n(`select count(*) c from workflow_stages`)).toBe(
        EXPECTED_SHOWCASE.stages + EXPECTED_DASHBOARD.stages,
      );
    });

    it('FR-008 seed maps Jira project PAY to payments-api with base URL https://jira.example.invalid', async () => {
      await run();
      const rows = (
        await pool.query(
          `select m.provider, m.external_project_key, m.external_base_url, p.key project, m.organization_id = p.organization_id same_org
             from integration_project_mappings m join projects p on p.id = m.project_id`,
        )
      ).rows;
      expect(rows).toEqual([
        {
          provider: 'jira',
          external_project_key: 'PAY',
          external_base_url: 'https://jira.example.invalid',
          project: 'payments-api',
          same_org: true,
        },
      ]);
    });

    it('FR-009 seed writes 26 requirement_transitions rows (system actor for the workflow-driven ones) and no audit_events rows, and inbox_change_log is empty after seeding', async () => {
      await run();
      expect(await n(`select count(*) c from requirement_transitions`)).toBe(
        EXPECTED_REQUIREMENTS.transitions,
      );
      expect(await n(`select count(*) c from requirement_transitions`)).toBe(26);
      const system = (
        await pool.query(
          `select r.external_id, t.from_state, t.to_state, t.actor_name
             from requirement_transitions t join requirements r on r.id = t.requirement_id
            where t.actor_type = 'system' and t.actor_name = 'workflow' order by r.external_id, t.id`,
        )
      ).rows;
      expect(system).toEqual([
        {
          external_id: 'req-seed-006',
          from_state: 'APPROVED',
          to_state: 'IN_IMPLEMENTATION',
          actor_name: 'workflow',
        },
        {
          external_id: 'req-seed-007',
          from_state: 'APPROVED',
          to_state: 'IN_IMPLEMENTATION',
          actor_name: 'workflow',
        },
        {
          external_id: 'req-seed-007',
          from_state: 'IN_IMPLEMENTATION',
          to_state: 'COMPLETED',
          actor_name: 'workflow',
        },
      ]);
      const userActors = await n(
        `select count(*) c from requirement_transitions where actor_type='user' and actor_id is null`,
      );
      expect(userActors).toBe(0);
      expect(
        await n(
          `select count(*) c from requirement_transitions t where t.actor_type='user' and not exists (select 1 from users u where u.id::text = t.actor_id)`,
        ),
      ).toBe(0);
      const last = (
        await pool.query(
          `select r.external_id, r.state, (select to_state from requirement_transitions t where t.requirement_id = r.id order by t.occurred_at desc, t.id desc limit 1) last
             from requirements r`,
        )
      ).rows;
      for (const row of last) expect(row.last, row.external_id).toBe(row.state);
      expect(await n(`select count(*) c from audit_events`)).toBe(0);
      expect(await n(`select count(*) c from inbox_change_log`)).toBe(0);
    });
  });
});

describe('S-500 agent decisions showcase (specs/001 US5, data-model.md §37)', () => {
  it('FR-016 FR-017 builds steps and decisions deterministically: 3 on the active showcase run, 2 on a COMPLETED payments-api run, and no extra workflows or runs', () => {
    const a = buildS500(BASE);
    const b = buildS500(BASE);
    expect(JSON.stringify(a.showcase)).toBe(JSON.stringify(b.showcase));
    const runs = a.showcase.flatMap((s) => s.runs);
    expect(runs).toHaveLength(EXPECTED_SHOWCASE.runs);
    expect(a.showcase).toHaveLength(EXPECTED_SHOWCASE.workflows);
    const withDecisions = runs.filter((r) => r.decisions.length > 0);
    expect(withDecisions.map((r) => r.externalId).sort()).toEqual(
      [
        EXPECTED_AGENT_DECISIONS.active.externalId,
        EXPECTED_AGENT_DECISIONS.completed.externalId,
      ].sort(),
    );
    const active = runs.find((r) => r.externalId === EXPECTED_AGENT_DECISIONS.active.externalId)!;
    const completed = runs.find(
      (r) => r.externalId === EXPECTED_AGENT_DECISIONS.completed.externalId,
    )!;
    expect(active.finishedAt).toBeNull();
    expect(active.decisions).toHaveLength(3);
    expect(completed.state).toBe('COMPLETED');
    expect(completed.decisions).toHaveLength(2);
    expect(a.showcase.find((s) => s.runs.includes(completed))!.externalId).toBe(SHOWCASE_WAITING);
    expect(a.workflows.find((w) => w.externalId === SHOWCASE_WAITING)!.project).toBe(
      'payments-api',
    );
    const all = runs.flatMap((r) => r.decisions);
    expect(all).toHaveLength(EXPECTED_AGENT_DECISIONS.decisions);
    for (const r of withDecisions) {
      expect(r.decisions.map((d) => d.position)).toEqual(r.decisions.map((_, i) => i + 1));
      for (const d of r.decisions) {
        expect(d.action.length).toBeLessThanOrEqual(200);
        expect(d.reason.length).toBeLessThanOrEqual(600);
        expect(d.evidence.length).toBeLessThanOrEqual(20);
        expect(d.decidedAt.getTime()).toBeGreaterThanOrEqual(r.startedAt.getTime());
        if (r.finishedAt) expect(d.decidedAt.getTime()).toBeLessThanOrEqual(r.finishedAt.getTime());
      }
    }
    const approvalRequired = all.filter((d) => d.policyOutcome === 'APPROVAL_REQUIRED');
    expect(approvalRequired).toHaveLength(1);
    expect(approvalRequired[0]!.riskLevel).toBe('MEDIUM');
    expect(all.filter((d) => d.policyOutcome === 'DENIED')).toHaveLength(1);
    const evidence = all.flatMap((d) => d.evidence);
    expect(evidence.filter((e) => !e.accessible)).toHaveLength(1);
    expect([...new Set(evidence.map((e) => e.kind))].sort()).toEqual([
      'artifact',
      'file',
      'ticket',
      'url',
    ]);
    for (const e of evidence.filter((e) => e.accessible)) expect(e.href).toBeTruthy();
    // AS-3 structured progress: the active run shows one running step and at least one pending step.
    expect(active.steps.length).toBeGreaterThan(0);
    expect(active.steps.length).toBeLessThanOrEqual(20);
    expect(active.steps.filter((s) => s.status === 'running')).toHaveLength(1);
    expect(active.steps.some((s) => s.status === 'pending')).toBe(true);
    expect(completed.steps.every((s) => s.status === 'completed')).toBe(true);
    for (const r of runs) for (const s of r.steps) expect(s.label.length).toBeLessThanOrEqual(120);
    // The clarification showcase drills into the active run (authored by external id, resolved at insert).
    const clr = a.workflows.find(
      (w) => w.clarification?.externalId === DECISION_SHOWCASE.clarification,
    )!;
    expect(clr.clarification!.links.agentRun).toBe(
      `/agents/runs/${EXPECTED_AGENT_DECISIONS.active.externalId}`,
    );
  });

  describe.skipIf(Boolean(process.env['CDEVI_SKIP_DB_TESTS']))('written to the database', () => {
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
    afterAll(() => pool.end());

    it('FR-016 FR-017 seeding writes agent_runs.steps and 5 agent_decisions on 2 runs, and s500-clr-01 links.agentRun points at the inserted run id', async () => {
      const r = await seed({
        base: BASE,
        password: 'cdevi-demo-test-pass',
        ingestToken: 'cdvi_test_token',
        log: () => {},
      });
      expect(r.counts.agentDecisions).toBe(EXPECTED_AGENT_DECISIONS.decisions);
      expect(r.counts.runs).toBe(EXPECTED_SHOWCASE.runs + EXPECTED_DASHBOARD.runs);
      const n = async (sql: string) => Number((await pool.query(sql)).rows[0].c);
      expect(await n('select count(*) c from agent_decisions')).toBe(
        EXPECTED_AGENT_DECISIONS.decisions,
      );
      expect(await n('select count(distinct agent_run_id) c from agent_decisions')).toBe(
        EXPECTED_AGENT_DECISIONS.runs,
      );
      const active = (
        await pool.query<{ id: string; steps: unknown[]; workflow_id: string; decisions: number }>(
          `select r.id, r.steps, r.workflow_id, (select count(*)::int from agent_decisions d where d.agent_run_id = r.id) decisions
           from agent_runs r where r.external_id = $1`,
          [EXPECTED_AGENT_DECISIONS.active.externalId],
        )
      ).rows[0]!;
      expect(active.decisions).toBe(3);
      expect(active.steps.length).toBeGreaterThan(0);
      const decisions = (
        await pool.query(
          `select d.position, d.policy_outcome, d.risk_level, d.evidence, d.workflow_id, d.stage_id = r.stage_id same_stage
           from agent_decisions d join agent_runs r on r.id = d.agent_run_id where d.agent_run_id = $1 order by d.position`,
          [active.id],
        )
      ).rows;
      expect(decisions.map((d) => d.position)).toEqual([1, 2, 3]);
      for (const d of decisions) {
        expect(d.workflow_id).toBe(active.workflow_id);
        expect(d.same_stage).toBe(true);
      }
      expect(
        await n(
          `select count(*) c from agent_decisions where policy_outcome = 'APPROVAL_REQUIRED' and risk_level = 'MEDIUM'`,
        ),
      ).toBe(1);
      expect(
        await n(`select count(*) c from agent_decisions where policy_outcome = 'DENIED'`),
      ).toBe(1);
      expect(
        await n(
          `select count(*) c from agent_decisions d, jsonb_array_elements(d.evidence) e where (e->>'accessible')::boolean = false`,
        ),
      ).toBe(1);
      expect(await n(`select count(*) c from agent_runs where jsonb_array_length(steps) > 0`)).toBe(
        EXPECTED_AGENT_DECISIONS.runsWithSteps,
      );
      // FR-036 watermark: set to the latest decided_at on runs that carry decisions, NULL elsewhere
      expect(
        await n(
          `select count(*) c from agent_runs r where r.decisions_observed_at is not null
             and r.decisions_observed_at = (select max(d.decided_at) from agent_decisions d where d.agent_run_id = r.id)`,
        ),
      ).toBe(EXPECTED_AGENT_DECISIONS.runs);
      expect(
        await n(
          `select count(*) c from agent_runs r where r.decisions_observed_at is null
             and exists (select 1 from agent_decisions d where d.agent_run_id = r.id)`,
        ),
      ).toBe(0);
      const clr = (
        await pool.query(`select links from clarifications where external_id = $1`, [
          DECISION_SHOWCASE.clarification,
        ])
      ).rows[0]!;
      expect(clr.links.agentRun).toBe(`/agents/runs/${active.id}`);
      expect(Object.keys(clr.links)).toHaveLength(5);
      expect(await n(`select count(*) c from inbox_change_log`)).toBe(0);
    });
  });
});

describe('US6 review seed (specs/001 US6; plan "Data model — 0007_reviews.sql")', () => {
  it('FR-020 is deterministic: PR #1821 pr-1821 on s500-001 with one COMPLETE cycle-3 review, 7 lane results (security FAIL, correctness WARN, others PASS) and 7 findings find-1821-1…7, one per lane in lane order', () => {
    const a = buildReviewSeed(BASE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(buildReviewSeed(BASE)));
    expect(a.pullRequest).toMatchObject({
      externalId: 'pr-1821',
      workflow: SHOWCASE_WAITING,
      number: 1821,
      title: 'PAY-1391 Refund processing',
      status: 'OPEN',
    });
    expect(a.pullRequest.href).toMatch(/^https:\/\/.*\/pull\/1821$/);
    expect(a.review).toMatchObject({
      externalId: 'rev-1821-3',
      cycleNumber: 3,
      status: 'COMPLETE',
    });
    expect(a.review.agentRun).toBe('s500-001-r7');
    expect(a.review.lanes.map((l) => l.lane)).toEqual([...REVIEW_LANES]);
    expect(Object.fromEntries(a.review.lanes.map((l) => [l.lane, l.status]))).toEqual(
      EXPECTED_REVIEW_SEED.lanes,
    );
    for (const l of a.review.lanes) expect(LaneResult.safeParse(l).success, l.lane).toBe(true);
    const f = a.review.findings;
    expect(f.map((x) => x.externalId)).toEqual([...EXPECTED_REVIEW_SEED.findings]);
    expect(f.map((x) => x.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(f.map((x) => x.lane)).toEqual([...REVIEW_LANES]);
  });

  it('FR-021 the security finding find-1821-2 is CRITICAL / BLOCKING / OPEN with the UI spec §21 title, impact, RefundController.java:84 evidence and fix', () => {
    const f = buildReviewSeed(BASE).review.findings.find(
      (x) => x.externalId === EXPECTED_REVIEW_SEED.securityFinding,
    )!;
    expect(f).toMatchObject({
      lane: 'security',
      severity: 'CRITICAL',
      blocking: 'BLOCKING',
      state: 'OPEN',
      title: 'Refund endpoint does not verify authorization against the original payment owner',
      impact: "A user may potentially refund another user's payment.",
      recommendedFix: 'Validate payment ownership before processing.',
    });
    expect(f.evidence).toHaveLength(2);
    expect(f.evidence[1]).toMatchObject({ kind: 'url', accessible: false });
    expect(f.evidence[1]!.href).toBeUndefined();
    expect(f.evidence[0]).toMatchObject({
      kind: 'file',
      locator: 'RefundController.java:84',
      accessible: true,
    });
    expect(f.evidence[0]!.href).toMatch(/^https:\/\//);
  });

  it('FR-021 FR-022 findings exercise every row rendering: one HIGH/BLOCKING edge_cases finding (FIXED in cycle 3), a non-blocking correctness finding (lane WARN), one restricted-evidence finding, one DISMISSED with reason ≤ 240 by a demo engineer, the rest OPEN non-blocking / suggestion; readyForMerge is false with exactly 1 blocking finding open', () => {
    const { review } = buildReviewSeed(BASE);
    const f = review.findings;
    const by = (id: string) => f.find((x) => x.externalId === id)!;
    expect(by(EXPECTED_REVIEW_SEED.fixedFinding)).toMatchObject({
      lane: 'edge_cases',
      severity: 'HIGH',
      blocking: 'BLOCKING',
      state: 'FIXED',
      fixCycle: 3,
    });
    const restricted = by(EXPECTED_REVIEW_SEED.restrictedEvidenceFinding);
    expect(restricted.evidence.some((e) => e.accessible === false && !e.href)).toBe(true);
    const dismissed = by(EXPECTED_REVIEW_SEED.dismissedFinding);
    expect(dismissed.state).toBe('DISMISSED');
    expect(dismissed.dismissedBy).toBe('engineer1@cdevi.demo');
    expect(dismissed.dismissedAt).toBeInstanceOf(Date);
    expect(dismissed.dismissedReason!.length).toBeLessThanOrEqual(240);
    const byState: Record<string, number> = {};
    for (const x of f) byState[x.state] = (byState[x.state] ?? 0) + 1;
    expect(byState).toEqual(EXPECTED_REVIEW_SEED.byState);
    for (const x of f.filter(
      (x) => x.state === 'OPEN' && x.externalId !== EXPECTED_REVIEW_SEED.securityFinding,
    ))
      expect(x.blocking, x.externalId).not.toBe('BLOCKING');
    expect(f.map((x) => x.severity)).toEqual([
      'MEDIUM',
      'CRITICAL',
      'LOW',
      'HIGH',
      'MEDIUM',
      'LOW',
      'INFO',
    ]);
    expect(by('find-1821-1')).toMatchObject({
      lane: 'correctness',
      blocking: 'NON_BLOCKING',
      state: 'OPEN',
    });
    for (const l of review.lanes) expect(laneStatusFromFindings(l.lane, f), l.lane).toBe(l.status);
    expect(blockingOpenCount(f)).toBe(EXPECTED_REVIEW_SEED.blockingOpenCount);
    expect(readyForMerge(f)).toBe(EXPECTED_REVIEW_SEED.readyForMerge);
    for (const x of f) {
      expect(x.title.length).toBeLessThanOrEqual(200);
      expect(x.description.length).toBeLessThanOrEqual(2000);
      expect(x.impact.length).toBeLessThanOrEqual(1000);
      expect(x.recommendedFix.length).toBeLessThanOrEqual(1000);
      expect(x.evidence.length).toBeLessThanOrEqual(10);
    }
    for (const x of f) {
      if (x.state !== 'DISMISSED') {
        expect(x.dismissedBy).toBeNull();
        expect(x.dismissedReason).toBeNull();
        expect(x.dismissedAt).toBeNull();
      }
      if (x.state !== 'FIXED') expect(x.fixCycle).toBeNull();
    }
  });

  it('FR-036 the review is what the runtime would PUT: it round-trips through ReviewIngest (strict, 7 lanes, ≤ 50 findings, no reasoning field)', () => {
    const { review } = buildReviewSeed(BASE);
    const body = {
      externalId: review.externalId,
      status: review.status,
      lanes: review.lanes,
      findings: review.findings.map((f) => ({
        externalId: f.externalId,
        position: f.position,
        lane: f.lane,
        severity: f.severity,
        blocking: f.blocking,
        title: f.title,
        description: f.description,
        impact: f.impact,
        evidence: f.evidence,
        recommendedFix: f.recommendedFix,
        status: f.state === 'FIXED' ? 'fixed' : 'open',
      })),
      startedAt: review.startedAt.toISOString(),
      finishedAt: review.finishedAt!.toISOString(),
      agentRunExternalId: review.agentRun,
      observedAt: review.observedAt.toISOString(),
    };
    const parsed = ReviewIngest.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('AS-4 review cycles #1–#3 are COMPLETED history: #3 has 7 findings / 6 fixed / 1 remaining, iteration 3 of 5, and every cycle satisfies fixed + remaining ≤ findings and is timed inside the Review Agent run', () => {
    const { cycles, review } = buildReviewSeed(BASE);
    expect(cycles.map((c) => c.cycleNumber)).toEqual([1, 2, 3]);
    expect(cycles.every((c) => c.state === 'COMPLETED')).toBe(true);
    expect(cycles.at(-1)).toMatchObject(EXPECTED_REVIEW_SEED.latestCycle);
    expect(cycles.map((c) => [c.findingsCount, c.fixedCount, c.remainingCount])).toEqual([
      [12, 8, 4],
      [9, 6, 3],
      [7, 6, 1],
    ]);
    expect(cycles.at(-1)!.agentRun).toBe('s500-001-r7');
    for (const c of cycles) {
      expect(c.fixedCount + c.remainingCount, `cycle ${c.cycleNumber}`).toBeLessThanOrEqual(
        c.findingsCount,
      );
      expect(c.iteration).toBe(c.cycleNumber);
      expect(c.iteration).toBeLessThanOrEqual(c.maxIterations);
      expect(c.finishedAt!.getTime()).toBeGreaterThan(c.startedAt.getTime());
      expect(c.observedAt).toEqual(c.finishedAt);
    }
    for (let i = 1; i < cycles.length; i++)
      expect(cycles[i]!.startedAt.getTime()).toBeGreaterThanOrEqual(
        cycles[i - 1]!.finishedAt!.getTime(),
      );
    expect(review.startedAt).toEqual(cycles.at(-1)!.startedAt);
    expect(review.finishedAt).toEqual(cycles.at(-1)!.finishedAt);
    const run = buildS500(BASE)
      .showcase.find((s) => s.externalId === SHOWCASE_WAITING)!
      .runs.find((r) => r.externalId === 's500-001-r7')!;
    expect(cycles[0]!.startedAt).toEqual(run.startedAt);
    expect(review.finishedAt!.getTime()).toBeLessThanOrEqual(BASE.getTime());
  });

  describe.skipIf(Boolean(process.env['CDEVI_SKIP_DB_TESTS']))('written to the database', () => {
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
    afterAll(() => pool.end());

    it('FR-020 FR-021 AS-4 seeding writes 1 pull request, 1 review, 7 findings and 3 cycles on s500-001 in payments-api with the expected states, links and watermarks, without touching Dashboard figures', async () => {
      const r = await seed({
        base: BASE,
        password: 'cdevi-demo-test-pass',
        ingestToken: 'cdvi_test_token',
        log: () => {},
      });
      expect(r.counts.reviews).toEqual({
        pullRequests: 1,
        reviews: 1,
        findings: EXPECTED_REVIEW_SEED.findings.length,
        byState: EXPECTED_REVIEW_SEED.byState,
        cycles: EXPECTED_REVIEW_SEED.cycles,
      });
      const n = async (sql: string, params: unknown[] = []) =>
        Number((await pool.query(sql, params)).rows[0].c);
      const pr = (
        await pool.query(
          `select pr.id, pr.number, pr.title, pr.status, pr.requirement_id, pr.observed_at, w.external_id workflow, p.key project, w.requirement_id workflow_requirement
             from pull_requests pr join workflows w on w.id = pr.workflow_id join projects p on p.id = pr.project_id
            where pr.external_id = $1`,
          [EXPECTED_REVIEW_SEED.pullRequest.externalId],
        )
      ).rows[0]!;
      expect(pr).toMatchObject({
        number: 1821,
        title: 'PAY-1391 Refund processing',
        status: 'OPEN',
        workflow: SHOWCASE_WAITING,
        project: 'payments-api',
      });
      expect(pr.requirement_id).toBe(pr.workflow_requirement);
      expect(pr.requirement_id).not.toBeNull();
      expect(await n('select count(*) c from pull_requests')).toBe(1);
      expect(await n('select count(*) c from reviews')).toBe(1);
      const review = (
        await pool.query(
          `select r.id, r.cycle_number, r.status, r.lanes, r.finished_at, r.observed_at, a.external_id run
             from reviews r left join agent_runs a on a.id = r.agent_run_id where r.pull_request_id = $1`,
          [pr.id],
        )
      ).rows[0]!;
      expect(review).toMatchObject({ cycle_number: 3, status: 'COMPLETE', run: 's500-001-r7' });
      expect(review.lanes).toHaveLength(7);
      expect(review.observed_at).toEqual(review.finished_at);
      expect(pr.observed_at).toEqual(review.finished_at);
      const findings = (
        await pool.query(
          `select f.external_id, f.position, f.lane, f.state, f.blocking, f.evidence, f.dismissed_reason, f.dismissed_at, u.email dismissed_by, c.cycle_number fix_cycle, f.updated_at
             from review_findings f left join users u on u.id = f.dismissed_by_user_id left join review_cycles c on c.id = f.fix_cycle_id
            where f.review_id = $1 and f.pull_request_id = $2 order by f.position`,
          [review.id, pr.id],
        )
      ).rows;
      expect(findings.map((f) => f.external_id)).toEqual([...EXPECTED_REVIEW_SEED.findings]);
      expect(findings.map((f) => f.lane)).toEqual([...REVIEW_LANES]);
      const byState: Record<string, number> = {};
      for (const f of findings) byState[f.state] = (byState[f.state] ?? 0) + 1;
      expect(byState).toEqual(EXPECTED_REVIEW_SEED.byState);
      expect(
        findings.find((f) => f.external_id === EXPECTED_REVIEW_SEED.fixedFinding),
      ).toMatchObject({
        state: 'FIXED',
        fix_cycle: 3,
      });
      expect(
        findings.find((f) => f.external_id === EXPECTED_REVIEW_SEED.dismissedFinding),
      ).toMatchObject({
        state: 'DISMISSED',
        dismissed_by: 'engineer1@cdevi.demo',
      });
      expect(
        findings.find((f) => f.external_id === EXPECTED_REVIEW_SEED.dismissedFinding)!.dismissed_at,
      ).toBeInstanceOf(Date);
      // readyForMerge is derived: the partial index predicate counts exactly one blocking finding open
      expect(
        await n(
          `select count(*) c from review_findings where pull_request_id = $1 and blocking = 'BLOCKING' and state in ('OPEN','FIX_REQUESTED')`,
          [pr.id],
        ),
      ).toBe(EXPECTED_REVIEW_SEED.blockingOpenCount);
      expect(
        await n(
          `select count(*) c from review_findings f, jsonb_array_elements(f.evidence) e where (e->>'accessible')::boolean = false`,
        ),
      ).toBe(1);
      const cycles = (
        await pool.query(
          `select cycle_number, findings_count, fixed_count, remaining_count, iteration, max_iterations, state, requested_by_agent, requested_by_user_id
             from review_cycles where pull_request_id = $1 order by cycle_number`,
          [pr.id],
        )
      ).rows;
      expect(cycles.map((c) => c.cycle_number)).toEqual([1, 2, 3]);
      expect(cycles.every((c) => c.state === 'COMPLETED' && c.requested_by_user_id === null)).toBe(
        true,
      );
      expect(cycles.at(-1)).toMatchObject({
        findings_count: 7,
        fixed_count: 6,
        remaining_count: 1,
        iteration: 3,
        max_iterations: 5,
        requested_by_agent: 'Review Agent',
      });
      // Ingestion never audits and the seed's own writes are not live changes.
      expect(await n(`select count(*) c from audit_events where action like 'finding.%'`)).toBe(0);
      expect(await n(`select count(*) c from inbox_change_log`)).toBe(0);
      // Dashboard figures are unchanged by the review seed.
      expect(r.counts.dashboard.workflows).toBe(EXPECTED_DASHBOARD.workflows);
      expect(r.counts.agentDecisions).toBe(EXPECTED_AGENT_DECISIONS.decisions);
    });
  });
});
