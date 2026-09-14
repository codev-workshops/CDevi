import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { buildS500, EXPECTED_BUCKETS } from '../src/seed/s500';
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
  },
);
