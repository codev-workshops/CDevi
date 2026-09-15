import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ARTIFACT_TYPES } from '@cdevi/contracts';
import {
  buildS500,
  DECISION_SHOWCASE,
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
import { seed, SeedRefusedError } from '../src/seed/index';

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
  it('SC-006 decision showcase is deterministic: s500-apr-req (LOW), s500-apr-pr (MEDIUM, links.pullRequest), s500-clr-01 (why_it_matters, 3 options, 4 links) on three distinct WAITING_FOR_HUMAN workflows', () => {
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
      expect(Object.keys(clr.links)).toHaveLength(4);
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
