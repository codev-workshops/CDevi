import type { Problem, WorkflowListPage } from '@cdevi/contracts';
import { encodeCursor } from '@cdevi/contracts/read-model';
import { REQUIREMENT_SHOWCASE, SHOWCASE_WAITING } from '@cdevi/db/seed';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, iso, seedSc007Org, signIn, skipDb, testApp } from './helpers';

describe.skipIf(skipDb)('GET /api/workflows (specs/001 US4, FR-003, SC-007)', () => {
  let app: FastifyInstance;
  let admin: string;
  let engineer: string;
  let payments: string;
  let platform: string;

  beforeAll(async () => {
    app = await testApp();
    admin = await signIn(app, 'admin@cdevi.demo');
    engineer = await signIn(app, 'engineer1@cdevi.demo');
    const projects = await app.pool.query<{ id: string; key: string }>(
      `SELECT id, key FROM projects WHERE key IN ('payments-api', 'platform')`,
    );
    payments = projects.rows.find((p) => p.key === 'payments-api')!.id;
    platform = projects.rows.find((p) => p.key === 'platform')!.id;
  });
  afterAll(() => app.close());

  const list = async (cookie: string, q = ''): Promise<WorkflowListPage> => {
    const r = await app.inject(asUser(cookie, { method: 'GET', url: `/api/workflows${q}` }));
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };

  it('FR-003 GET /workflows returns ≤ 50 WorkflowListItems ordered stateObservedAt desc, id desc with nextCursor and total, each with href /workflows/{id} and requirement {id,title,href} when linked', async () => {
    const page = await list(admin);
    expect(page.project).toBe('all');
    expect(page.filters).toEqual({ requirement: null, state: [], stage: null });
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(524);
    expect(page.nextCursor).not.toBeNull();
    for (let i = 1; i < page.items.length; i++) {
      const a = page.items[i - 1]!;
      const b = page.items[i]!;
      const cmp = b.stateObservedAt.localeCompare(a.stateObservedAt);
      expect(cmp <= 0, `${a.stateObservedAt} before ${b.stateObservedAt}`).toBe(true);
      if (cmp === 0) expect(b.id < a.id).toBe(true);
    }
    for (const i of page.items) {
      expect(i.href).toBe(`/workflows/${i.id}`);
      expect(i.project).toMatchObject({
        id: expect.any(String),
        key: expect.any(String),
        name: expect.any(String),
      });
    }
    const linked = await list(admin, `?project=${payments}&state=WAITING_FOR_HUMAN`);
    const waiting = linked.items.find((i) => i.externalId === SHOWCASE_WAITING);
    expect(waiting).toBeDefined();
    const reqId = (
      await app.pool.query<{ id: string; title: string }>(
        `SELECT id, title FROM requirements WHERE external_id = $1`,
        [REQUIREMENT_SHOWCASE.inImplementation],
      )
    ).rows[0]!;
    expect(waiting!.requirement).toEqual({
      id: reqId.id,
      title: reqId.title,
      href: `/requirements/${reqId.id}`,
    });
    expect(waiting!.stage).toMatchObject({ index: expect.any(Number), count: 7 });
    expect(waiting!.pullRequest === null || typeof waiting!.pullRequest.url === 'string').toBe(
      true,
    );
    expect(linked.items.filter((i) => i.requirement === null).length).toBeGreaterThan(0);
  });

  it('FR-003 requirement=<req-seed-006 id> returns exactly the SHOWCASE_WAITING workflow; state=FAILED,BLOCKED and stage=3 filter correctly; project=<invisible> returns an empty page with total 0', async () => {
    const reqId = (
      await app.pool.query<{ id: string }>(`SELECT id FROM requirements WHERE external_id = $1`, [
        REQUIREMENT_SHOWCASE.inImplementation,
      ])
    ).rows[0]!.id;
    const byReq = await list(admin, `?requirement=${reqId}`);
    expect(byReq.filters.requirement).toBe(reqId);
    expect(byReq.total).toBe(1);
    expect(byReq.items.map((i) => i.externalId)).toEqual([SHOWCASE_WAITING]);
    expect(byReq.nextCursor).toBeNull();

    const states = await list(admin, '?state=FAILED,BLOCKED');
    expect(states.filters.state).toEqual(['FAILED', 'BLOCKED']);
    expect(states.total).toBe(16);
    expect(states.items).toHaveLength(16);
    expect(states.items.every((i) => i.state === 'FAILED' || i.state === 'BLOCKED')).toBe(true);

    const stage3 = await list(admin, '?stage=3');
    expect(stage3.filters.stage).toBe(3);
    expect(stage3.total).toBe(18);
    expect(stage3.items.every((i) => i.stage?.index === 3)).toBe(true);

    const combined = await list(admin, `?project=${payments}&state=COMPLETED&stage=7`);
    expect(combined.project).toBe(payments);
    expect(
      combined.items.every(
        (i) => i.project.id === payments && i.state === 'COMPLETED' && i.stage?.index === 7,
      ),
    ).toBe(true);
    expect(combined.total).toBe(combined.items.length);

    // engineer1 is a member of payments-api only
    const invisible = await list(engineer, `?project=${platform}`);
    expect(invisible).toMatchObject({ items: [], total: 0, nextCursor: null });
    const invisibleReq = await list(engineer, `?requirement=00000000-0000-0000-0000-000000000000`);
    expect(invisibleReq).toMatchObject({ items: [], total: 0, nextCursor: null });
    const mine = await list(engineer);
    expect(mine.total).toBe(125);
    expect(mine.items.every((i) => i.project.key === 'payments-api')).toBe(true);
  });

  it('FR-003 the cursor walks all S-500 + dashboard-demo workflows of the administrator without duplicates or gaps (524 rows in 11 pages)', async () => {
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: WorkflowListPage = await list(
        admin,
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : '',
      );
      pages++;
      expect(page.total).toBe(524);
      for (const i of page.items) {
        expect(seen.has(i.id), `duplicate ${i.externalId}`).toBe(false);
        seen.add(i.id);
      }
      cursor = page.nextCursor;
      expect(pages).toBeLessThanOrEqual(11);
    } while (cursor);
    expect(pages).toBe(11);
    expect(seen.size).toBe(524);
  });

  it('FR-003 an inbox cursor returns 400 invalid-cursor; unauthenticated 401', async () => {
    const foreign = encodeCursor('running', [iso(app.now()), payments]);
    const r = await app.inject(
      asUser(admin, { method: 'GET', url: `/api/workflows?cursor=${encodeURIComponent(foreign)}` }),
    );
    expect(r.statusCode).toBe(400);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect((r.json() as Problem).type).toBe('urn:cdevi:problem:invalid-cursor');
    expect(
      (await app.inject(asUser(admin, { method: 'GET', url: '/api/workflows?stage=9' })))
        .statusCode,
    ).toBe(400);
    expect(
      (await app.inject(asUser(admin, { method: 'GET', url: '/api/workflows?state=NOPE' })))
        .statusCode,
    ).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/workflows' })).statusCode).toBe(401);
  });

  it('SC-007 GET /workflows p95 ≤ 200 ms over 20 calls at 500 workflows and payload ≤ 40 KB', async () => {
    const org = await seedSc007Org(app);
    const cookie = await signIn(app, org.email, org.password);
    const first = await list(cookie);
    expect(first.total).toBe(500);
    expect(first.items).toHaveLength(50);
    const durations: number[] = [];
    for (let i = 0; i < 20; i++) {
      const q = i % 2 ? `?project=${org.projectIds[i % 4]}&state=RUNNING,COMPLETED` : '';
      const r = await app.inject(asUser(cookie, { method: 'GET', url: `/api/workflows${q}` }));
      expect(r.statusCode).toBe(200);
      const m = /workflows;dur=(\d+(?:\.\d+)?)/.exec(String(r.headers['server-timing']));
      expect(m, String(r.headers['server-timing'])).not.toBeNull();
      durations.push(Number(m![1]));
      expect(Buffer.byteLength(r.body)).toBeLessThanOrEqual(40 * 1024);
    }
    durations.sort((a, b) => a - b);
    expect(
      durations[Math.ceil(durations.length * 0.95) - 1]!,
      durations.join(','),
    ).toBeLessThanOrEqual(200);
  });
});
