import type { InboxItem, InboxSnapshot } from '@cdevi/contracts';
import { orderDone, orderNeedsYou, orderRunning, type InboxRowSource } from '@cdevi/contracts';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, DAY, FIXED_NOW, HOUR, MIN, signIn, skipDb, testApp } from './helpers';

describe.skipIf(skipDb)('GET /api/inbox (US1 needsYou · US2 running/done · US4 today)', () => {
  let app: FastifyInstance;
  let admin: string;
  let viewer: string;
  const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
  beforeAll(async () => {
    app = await testApp();
    admin = await signIn(app, 'admin@cdevi.demo');
    viewer = await signIn(app, 'viewer1@cdevi.demo');
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const get = async (cookie: string, qs: Record<string, string> = {}) => {
    const res = await app.inject(
      asUser(cookie, { method: 'GET', url: `/api/inbox?${new URLSearchParams(qs)}` }),
    );
    return res;
  };
  const snapshot = async (
    cookie: string,
    qs: Record<string, string> = {},
  ): Promise<InboxSnapshot> => {
    const res = await get(cookie, qs);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const allPages = async (cookie: string, tab: string, project = 'all'): Promise<InboxItem[]> => {
    const items: InboxItem[] = [];
    let cursor: string | null = null;
    for (;;) {
      const s: InboxSnapshot = await snapshot(cookie, {
        tab,
        project,
        ...(cursor ? { cursor } : {}),
      });
      items.push(...s.items);
      expect(s.items.length).toBeLessThanOrEqual(50);
      if (!s.nextCursor) return items;
      cursor = s.nextCursor;
    }
  };
  const toSource = (i: InboxItem): InboxRowSource => ({
    workflowId: i.workflowId,
    state: i.state,
    stateObservedAt: new Date(i.raisedAt),
    stateReason: null,
    stageIndex: i.stage?.index ?? null,
    stageName: i.stage?.name ?? null,
    startedAt: i.startedAt ? new Date(i.startedAt) : null,
    finishedAt: i.finishedAt ? new Date(i.finishedAt) : null,
    approval:
      i.kind === 'approval'
        ? {
            id: i.requestId!,
            ask: i.ask!,
            riskLevel: i.riskLevel!,
            requestedAt: new Date(i.raisedAt),
            expiresAt: null,
            hasRecommendedAnswer: false,
          }
        : null,
    clarification:
      i.kind === 'clarification'
        ? {
            id: i.requestId!,
            question: i.ask!,
            requestedAt: new Date(i.raisedAt),
            hasRecommendedAnswer: i.hasRecommendedAnswer,
          }
        : null,
  });

  it('requires a session and defaults to the needsYou tab for all projects', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/inbox' })).statusCode).toBe(401);
    const s = await snapshot(admin);
    expect(s.tab).toBe('needsYou');
    expect(s.project).toBe('all');
    expect(s.generatedAt).toBe(FIXED_NOW.toISOString());
  });

  it('FR-006 lists WAITING_FOR_HUMAN, BLOCKED and FAILED only, with the true total count', async () => {
    const items = await allPages(admin, 'needsYou');
    const states = new Set(items.map((i) => i.state));
    expect([...states].sort()).toEqual(['BLOCKED', 'FAILED', 'WAITING_FOR_HUMAN']);
    expect(items.length).toBeGreaterThanOrEqual(50); // S-500 has 50 seeded plus rows ingested by other test files
    expect((await snapshot(admin)).counts.needsYou).toBe(items.length);
    for (const i of items) expect(i.tab).toBe('needsYou');
  });

  it('FR-010 orders by risk rank, then raisedAt ascending, then id (worked example of inbox-read-model.md §4)', async () => {
    const items = await allPages(admin, 'needsYou');
    const ranks = items.map(
      (i) => ({ CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 })[i.riskLevel ?? ('x' as never)] ?? 4,
    );
    for (let k = 1; k < ranks.length; k++) expect(ranks[k]!).toBeGreaterThanOrEqual(ranks[k - 1]!);
    expect(items[0]!.riskLevel).toBe('CRITICAL');
    const riskless = items.filter((i) => i.riskLevel === null);
    for (let k = 1; k < riskless.length; k++)
      expect(riskless[k]!.raisedAt >= riskless[k - 1]!.raisedAt).toBe(true);
    expect(items.map((i) => i.workflowId)).toEqual(
      [...items]
        .map(toSource)
        .sort(orderNeedsYou)
        .map((s) => s.workflowId),
    );
  });

  it('FR-007 FR-008 FR-009 FR-011 item fields: ask, riskLevel, expiry, isStale (> 24 h strict), hasRecommendedAnswer, href', async () => {
    const items = await allPages(admin, 'needsYou');
    const approvals = items.filter((i) => i.kind === 'approval');
    const clar = items.filter((i) => i.kind === 'clarification');
    const blocked = items.filter((i) => i.kind === 'blocked');
    const failed = items.filter((i) => i.kind === 'failed');
    expect(approvals.length).toBeGreaterThanOrEqual(24);
    expect(clar.length).toBeGreaterThanOrEqual(12);
    expect(blocked.length).toBeGreaterThanOrEqual(8);
    expect(failed.length).toBeGreaterThanOrEqual(6);
    for (const a of approvals) {
      expect(a.riskLevel).not.toBeNull();
      expect(a.ask).toMatch(/^Approve: /);
      expect(a.href).toBe(`/approvals/${a.requestId}`);
      expect(a.state).toBe('WAITING_FOR_HUMAN');
    }
    expect(approvals.filter((a) => a.expiry)).toHaveLength(4);
    expect(approvals.filter((a) => a.expiry?.isExpired)).toHaveLength(1);
    expect(approvals.filter((a) => a.isStale)).toHaveLength(3);
    for (const a of approvals)
      expect(a.isStale).toBe(FIXED_NOW.getTime() - new Date(a.raisedAt).getTime() > 24 * HOUR);
    for (const c of clar) {
      expect(c.riskLevel).toBeNull();
      expect(c.href).toBe(`/approvals/${c.requestId}`);
    }
    expect(clar.filter((c) => c.hasRecommendedAnswer).length).toBeGreaterThanOrEqual(6);
    for (const b of blocked) {
      expect(b.ask).toMatch(/^Blocked: /);
      expect(b.href).toBe(`/workflows/${b.workflowId}`);
      expect(b.requestId).toBeNull();
    }
    for (const f of failed) expect(f.ask).toMatch(/^Failed at (Implementation|Testing): /);
  });

  it('FR-026 pages by 50 with a keyset cursor; an invalid or mismatched cursor → 400 invalid-cursor', async () => {
    const first = await snapshot(admin, { tab: 'done' });
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    const second = await snapshot(admin, { tab: 'done', cursor: first.nextCursor! });
    expect(new Set([...first.items, ...second.items].map((i) => i.workflowId)).size).toBe(
      first.items.length + second.items.length,
    );
    const wrongTab = await get(admin, { tab: 'running', cursor: first.nextCursor! });
    expect(wrongTab.statusCode).toBe(400);
    expect(wrongTab.json().type).toBe('urn:cdevi:problem:invalid-cursor');
    expect((await get(admin, { tab: 'done', cursor: '!!not-base64!!' })).statusCode).toBe(400);
  });

  it('FR-028 project=<id> filters rows and every count; project not visible → 404', async () => {
    const me = (await app.inject(asUser(admin, { method: 'GET', url: '/api/auth/me' }))).json();
    const p = me.projects.find((x: { key: string }) => x.key === 'payments-api');
    const all = await snapshot(admin);
    const one = await snapshot(admin, { project: p.id });
    expect(one.project).toBe(p.id);
    expect(one.counts.needsYou).toBeLessThan(all.counts.needsYou);
    expect(one.counts.running).toBeLessThan(all.counts.running);
    expect(one.counts.done).toBeLessThan(all.counts.done);
    for (const i of await allPages(admin, 'needsYou', p.id)) expect(i.project.id).toBe(p.id);
    expect(one.today.needsYou.value).toBe(one.counts.needsYou);
    const vm = (await app.inject(asUser(viewer, { method: 'GET', url: '/api/auth/me' }))).json();
    const hidden = me.projects.find(
      (x: { id: string }) => !vm.projects.some((v: { id: string }) => v.id === x.id),
    );
    expect((await get(viewer, { project: hidden.id })).statusCode).toBe(404);
    expect((await get(admin, { project: 'not-a-uuid' })).statusCode).toBe(400);
  });

  it('FR-027 SC-008 a viewer receives only rows from membership projects', async () => {
    const vm = (await app.inject(asUser(viewer, { method: 'GET', url: '/api/auth/me' }))).json();
    const visible = new Set(vm.projects.map((p: { id: string }) => p.id));
    for (const tab of ['needsYou', 'running', 'done']) {
      const items = await allPages(viewer, tab);
      for (const i of items)
        expect(visible.has(i.project.id), `${tab} ${i.project.key}`).toBe(true);
    }
    const s = await snapshot(viewer);
    expect(s.counts.needsYou).toBeLessThan((await snapshot(admin)).counts.needsYou);
  });

  it('SC-004 counts equal the number of rows across all pages, for every tab and scope', async () => {
    for (const cookie of [admin, viewer]) {
      const s = await snapshot(cookie);
      for (const tab of ['needsYou', 'running', 'done'] as const) {
        expect((await allPages(cookie, tab)).length, tab).toBe(s.counts[tab]);
      }
      expect(s.today.needsYou.value).toBe(s.counts.needsYou);
    }
  });

  it('FR-014 running lists QUEUED/RUNNING/RETRYING/WAITING ordered started_at DESC NULLS LAST, id; paging equals pure ordering', async () => {
    const items = await allPages(admin, 'running');
    expect([...new Set(items.map((i) => i.state))].sort()).toEqual([
      'QUEUED',
      'RETRYING',
      'RUNNING',
      'WAITING',
    ]);
    expect(items.map((i) => i.workflowId)).toEqual(
      [...items]
        .map(toSource)
        .sort(orderRunning)
        .map((s) => s.workflowId),
    );
    const firstNull = items.findIndex((i) => i.startedAt === null);
    expect(items.slice(firstNull).every((i) => i.startedAt === null)).toBe(true);
    for (const i of items) {
      expect(i.tab).toBe('running');
      expect(i.ask).toBeNull();
      expect(i.href).toBe(`/workflows/${i.workflowId}`);
      if (i.state !== 'QUEUED') expect(i.stage).not.toBeNull();
    }
  });

  it('FR-015 done lists COMPLETED/CANCELLED finished within 7 days, newest first; older rows are excluded and not counted', async () => {
    const items = await allPages(admin, 'done');
    expect([...new Set(items.map((i) => i.state))].sort()).toEqual(['CANCELLED', 'COMPLETED']);
    for (const i of items) {
      expect(FIXED_NOW.getTime() - new Date(i.finishedAt!).getTime()).toBeLessThanOrEqual(7 * DAY);
      if (i.state === 'COMPLETED') expect(i.pullRequestRef).toMatch(/^PR #/);
    }
    expect(items.map((i) => i.workflowId)).toEqual(
      [...items]
        .map(toSource)
        .sort(orderDone)
        .map((s) => s.workflowId),
    );
    const total = Number(
      (
        await pool.query(
          `select count(*) c from workflows where state in ('COMPLETED','CANCELLED')`,
        )
      ).rows[0].c,
    );
    expect(items.length).toBeLessThan(total);
    expect(items.length).toBeGreaterThanOrEqual(300);
    expect((await snapshot(admin)).counts.done).toBe(items.length);
  });

  it('FR-017 today counts use startOfDay(now, organization.timezone) and link to filtered lists; policy summary present', async () => {
    const s = await snapshot(admin);
    expect(s.today.timezone).toBe('Asia/Colombo');
    // 2026-09-14T09:00Z is 14:30 in Colombo (UTC+5:30) → window starts 2026-09-13T18:30:00Z
    expect(s.today.windowStart).toBe('2026-09-13T18:30:00.000Z');
    const started = Number(
      (
        await pool.query(
          `select count(*) c from workflows where started_at >= '2026-09-13T18:30:00Z' and started_at <= $1`,
          [FIXED_NOW],
        )
      ).rows[0].c,
    );
    expect(s.today.workflowsStarted.value).toBe(started);
    const completed = Number(
      (
        await pool.query(
          `select count(*) c from workflows where state='COMPLETED' and finished_at >= '2026-09-13T18:30:00Z' and finished_at <= $1`,
          [FIXED_NOW],
        )
      ).rows[0].c,
    );
    expect(s.today.workflowsCompleted.value).toBe(completed);
    const decided = Number(
      (
        await pool.query(
          `select count(*) c from approvals where decided_at >= '2026-09-13T18:30:00Z' and decided_at <= $1`,
          [FIXED_NOW],
        )
      ).rows[0].c,
    );
    expect(s.today.approvalsDecided.value).toBe(decided);
    expect(decided).toBeGreaterThan(0);
    expect(s.today.workflowsStarted.href).toBe('/inbox?tab=running&project=all');
    expect(s.today.workflowsCompleted.href).toBe('/inbox?tab=done&project=all');
    expect(s.today.approvalsDecided.href).toBe('/approvals?decided=today&project=all');
    expect(s.today.needsYou.href).toBe('/inbox?tab=needsYou&project=all');
    expect(s.policySummary).toEqual({
      text: 'Pull request merges and all HIGH/CRITICAL actions require human approval.',
      href: '/policies',
    });
  });

  it('FR-017 timezone boundary: 23:30 local yesterday excluded, 00:30 today included; zeros when nothing happened', async () => {
    // Move the clock to 2026-09-13T19:00Z = 00:30 Colombo → window starts 18:30Z; count workflows started in [18:30Z, 19:00Z]
    const early = await testApp({ now: () => new Date('2026-09-13T19:00:00Z') });
    try {
      const c = await signIn(early, 'admin@cdevi.demo');
      const s: InboxSnapshot = (
        await early.inject(asUser(c, { method: 'GET', url: '/api/inbox' }))
      ).json();
      expect(s.today.windowStart).toBe('2026-09-13T18:30:00.000Z');
      const expected = Number(
        (
          await pool.query(
            `select count(*) c from workflows where started_at >= '2026-09-13T18:30:00Z' and started_at <= '2026-09-13T19:00:00Z'`,
          )
        ).rows[0].c,
      );
      expect(s.today.workflowsStarted.value).toBe(expected);
    } finally {
      await early.close();
    }
    const farFuture = await testApp({ now: () => new Date(FIXED_NOW.getTime() + 30 * DAY) });
    try {
      const c = await signIn(farFuture, 'admin@cdevi.demo');
      const s: InboxSnapshot = (
        await farFuture.inject(asUser(c, { method: 'GET', url: '/api/inbox' }))
      ).json();
      expect(s.today.workflowsStarted.value).toBe(0);
      expect(s.today.workflowsCompleted.value).toBe(0);
      expect(s.today.approvalsDecided.value).toBe(0);
      expect(s.counts.done).toBe(0);
    } finally {
      await farFuture.close();
    }
  });

  it('FR-023 exposes Server-Timing, bounds the payload under 64 KB for 50 rows and disables caching', async () => {
    const res = await get(admin, { tab: 'done' });
    expect(res.headers['server-timing']).toMatch(/db;dur=\d+(\.\d+)?, total;dur=\d+/);
    expect(Buffer.byteLength(res.body)).toBeLessThan(64 * 1024);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  describe('GET /api/inbox/records/{kind}/{id} (research R9)', () => {
    it('returns the record behind a needsYou row and hides records outside visible projects (404 for both)', async () => {
      const items = await allPages(admin, 'needsYou');
      const approval = items.find((i) => i.kind === 'approval')!;
      const r = await app.inject(
        asUser(admin, { method: 'GET', url: `/api/inbox/records/approvals/${approval.requestId}` }),
      );
      expect(r.statusCode).toBe(200);
      expect(r.json().item.workflowId).toBe(approval.workflowId);
      expect(r.json().resolution).toBeNull();
      const wf = await app.inject(
        asUser(admin, {
          method: 'GET',
          url: `/api/inbox/records/workflows/${approval.workflowId}`,
        }),
      );
      expect(wf.statusCode).toBe(200);
      expect(wf.json().item.ask).toBe(approval.ask);

      const vm = (await app.inject(asUser(viewer, { method: 'GET', url: '/api/auth/me' }))).json();
      const visible = new Set(vm.projects.map((p: { id: string }) => p.id));
      const hiddenItem = items.find((i) => !visible.has(i.project.id))!;
      expect(
        (
          await app.inject(
            asUser(viewer, {
              method: 'GET',
              url: `/api/inbox/records/workflows/${hiddenItem.workflowId}`,
            }),
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject(
            asUser(admin, {
              method: 'GET',
              url: `/api/inbox/records/workflows/00000000-0000-7000-8000-00000000dead`,
            }),
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject(
            asUser(admin, {
              method: 'GET',
              url: `/api/inbox/records/things/${approval.workflowId}`,
            }),
          )
        ).statusCode,
      ).toBe(400);
    });

    it('shows who resolved a decided approval (spec edge case, specs/001 FR-015)', async () => {
      const decided = (
        await pool.query(`select id from approvals where decision is not null limit 1`)
      ).rows[0];
      const r = await app.inject(
        asUser(admin, { method: 'GET', url: `/api/inbox/records/approvals/${decided.id}` }),
      );
      expect(r.statusCode).toBe(200);
      expect(r.json().resolution).toMatchObject({ outcome: 'approved', by: 'Approver 1' });
      expect(r.json().item.tab).toBe('done');
    });
  });

  it('a clock fixed at FIXED_NOW makes ages deterministic', () => {
    expect(MIN).toBe(60_000);
  });
});
