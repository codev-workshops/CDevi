import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ARTIFACT_TYPES } from '@cdevi/contracts';
import {
  buildS500,
  EXPECTED_BUCKETS,
  EXPECTED_SHOWCASE,
  SHOWCASE_FAILED,
  SHOWCASE_WAITING,
} from '../src/seed/s500';
import { seed, SeedRefusedError } from '../src/seed/index';

const BASE = new Date('2026-09-14T09:00:00Z');

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

    it('loads 500 workflows, 20 users, a demo organization and an ingestion principal', async () => {
      const r = await seed({
        base: BASE,
        password: 'cdevi-demo-test-pass',
        ingestToken: 'cdvi_test_token',
        log: () => {},
      });
      expect(r.counts.workflows).toBe(500);
      const n = async (sql: string) => Number((await pool.query(sql)).rows[0].c);
      expect(await n('select count(*) c from workflows')).toBe(500);
      expect(await n('select count(*) c from users')).toBe(20);
      expect(await n(`select count(*) c from approvals where decision is null`)).toBe(24);
      expect(await n(`select count(*) c from clarifications where answered_at is null`)).toBe(12);
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
      const { workflows: _w, ...expected } = EXPECTED_SHOWCASE;
      expect(r.counts).toMatchObject(expected);
      const n = async (sql: string) => Number((await pool.query(sql)).rows[0].c);
      expect(await n('select count(*) c from workflow_stages')).toBe(EXPECTED_SHOWCASE.stages);
      expect(await n('select count(*) c from agent_runs')).toBe(EXPECTED_SHOWCASE.runs);
      expect(await n('select count(*) c from artifacts')).toBe(EXPECTED_SHOWCASE.artifacts);
      expect(await n('select count(*) c from test_runs')).toBe(EXPECTED_SHOWCASE.testRuns);
      expect(
        await n(
          `select count(*) c from workflow_stages s join approvals a on a.id = s.approval_id where s.state = 'WAITING_FOR_HUMAN'`,
        ),
      ).toBe(1);
      expect(
        await n(`select count(*) c from workflow_transitions where stage_id is not null`),
      ).toBe(
        buildS500(BASE).showcase.reduce(
          (t, s) => t + s.stages.reduce((u, st) => u + st.history.length, 0),
          0,
        ),
      );
      expect(await n(`select count(*) c from inbox_change_log`)).toBe(0);
    });
  },
);
