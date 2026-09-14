import type { WorkflowDetail } from '@cdevi/contracts';
import { SHOWCASE_FAILED, SHOWCASE_WAITING } from '@cdevi/db/seed';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asIngest,
  asUser,
  FIXED_NOW,
  iso,
  MIN,
  plus,
  signIn,
  skipDb,
  testApp,
  uniq,
} from './helpers';

describe.skipIf(skipDb)('GET /api/workflows/:id (US1 read model)', () => {
  let app: FastifyInstance;
  let admin: string;
  let engineer: string;
  let viewer: string;
  let waitingId: string;
  let failedId: string;

  const idOf = async (ext: string) =>
    (await app.pool.query<{ id: string }>(`SELECT id FROM workflows WHERE external_id = $1`, [ext]))
      .rows[0]!.id;
  const detail = async (cookie: string, id: string): Promise<WorkflowDetail> => {
    const r = await app.inject(asUser(cookie, { method: 'GET', url: `/api/workflows/${id}` }));
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };

  beforeAll(async () => {
    app = await testApp();
    admin = await signIn(app, 'admin@cdevi.demo');
    engineer = await signIn(app, 'engineer1@cdevi.demo');
    viewer = await signIn(app, 'viewer1@cdevi.demo');
    waitingId = await idOf(SHOWCASE_WAITING);
    failedId = await idOf(SHOWCASE_FAILED);
  });
  afterAll(() => app.close());

  it('requires a session and hides unknown / invisible workflows as 404 Problems', async () => {
    expect(
      (await app.inject({ method: 'GET', url: `/api/workflows/${waitingId}` })).statusCode,
    ).toBe(401);
    const missing = await app.inject(
      asUser(admin, { method: 'GET', url: '/api/workflows/00000000-0000-4000-8000-000000000000' }),
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toMatch(/application\/problem\+json/);
    const me = (await app.inject(asUser(viewer, { method: 'GET', url: '/api/auth/me' }))).json();
    const visible = new Set(me.projects.map((p: { key: string }) => p.key));
    const hidden = (
      await app.pool.query<{ id: string }>(
        `SELECT w.id FROM workflows w JOIN projects p ON p.id = w.project_id WHERE NOT (p.key = ANY($1::text[])) LIMIT 1`,
        [[...visible]],
      )
    ).rows[0]!.id;
    const r = await app.inject(asUser(viewer, { method: 'GET', url: `/api/workflows/${hidden}` }));
    expect(r.statusCode).toBe(404);
    expect(r.json().detail).not.toMatch(/project|organization/i);
  });

  it('FR-001 FR-003 returns the ordered stage pipeline, highlighted current stage, agent, elapsed and progress', async () => {
    const d = await detail(engineer, waitingId);
    expect(d.generatedAt).toBe(FIXED_NOW.toISOString());
    expect(d.stages.map((s) => s.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(d.stages.filter((s) => s.current)).toHaveLength(1);
    expect(d.stages.find((s) => s.current)?.position).toBe(6);
    expect(d.currentStage?.stage.position).toBe(6);
    expect(d.currentStage?.state).toBe('WAITING_FOR_HUMAN');
    expect(d.currentStage?.summary).toMatch(/waiting/i);
    expect(d.currentStage?.elapsedMs).toBeGreaterThan(0);
    expect(d.progress).toEqual({ completed: 5, total: 7 });
    expect(d.nextStage?.position).toBe(7);
    expect(d.workflow.riskLevel).not.toBeNull();
    for (const s of d.stages.slice(0, 5)) {
      expect(s.state).toBe('COMPLETED');
      expect(s.agent).toBeTruthy();
      expect(s.elapsedMs).toBeGreaterThan(0);
      expect(s.finishedAt).not.toBeNull();
    }
  });

  it('FR-004 activity is chronological with stage, agent and retry events; artifacts carry their producing stage', async () => {
    const d = await detail(engineer, waitingId);
    const ts = d.activity.map((e) => new Date(e.at).getTime());
    for (let k = 1; k < ts.length; k++) expect(ts[k]!).toBeGreaterThanOrEqual(ts[k - 1]!);
    expect(new Set(d.activity.map((e) => e.source))).toEqual(
      new Set(['workflow', 'stage', 'agent']),
    );
    expect(d.activity.some((e) => e.state === 'RETRYING')).toBe(true);
    for (const e of d.activity) expect(e.message.length).toBeGreaterThan(0);
    expect(d.artifacts.map((a) => a.type).sort()).toEqual(
      [
        'code_diff',
        'impact_analysis',
        'implementation_plan',
        'pull_request',
        'requirement_spec',
        'test_results',
      ].sort(),
    );
    for (const a of d.artifacts) expect(a.stage.position).toBeGreaterThan(0);
    expect(d.testRuns.length).toBeGreaterThanOrEqual(4);
    expect(d.testRuns.some((t) => t.status === 'FAILED')).toBe(true);
  });

  it('FR-005 exposes the waiting stage with reason, linked approval and a direct action href', async () => {
    const d = await detail(engineer, waitingId);
    expect(d.attention).not.toBeNull();
    expect(d.attention?.state).toBe('WAITING_FOR_HUMAN');
    expect(d.attention?.reason.length).toBeGreaterThan(0);
    expect(d.attention?.action.href).toMatch(/^\/approvals\//);
    expect(d.failure).toBeNull();
  });

  it('FR-006 failed workflow reports failing stage, last successful stage, reason and role-gated actions', async () => {
    const d = await detail(engineer, failedId);
    expect(d.workflow.state).toBe('FAILED');
    expect(d.failure?.failingStage.position).toBe(5);
    expect(d.failure?.lastSuccessfulStage?.position).toBe(4);
    expect(d.failure?.reason.length).toBeGreaterThan(0);
    expect(d.actions).toEqual({ retry: true, escalate: true, cancel: true });
    const v = await detail(viewer, failedId).catch(() => null);
    if (v) expect(v.actions).toEqual({ retry: false, escalate: false, cancel: false });
    const a = await detail(admin, waitingId);
    expect(a.actions).toEqual({ retry: false, escalate: true, cancel: true });
  });
});

describe.skipIf(skipDb)('POST /api/workflows/:id/actions (FR-006)', () => {
  let app: FastifyInstance;
  let engineer: string;
  let viewer: string;
  let approver: string;

  const ingestFailed = async () => {
    const ext = uniq('act');
    const put = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/workflows/${ext}`,
        payload: {
          projectKey: 'payments-api',
          title: 'Action test',
          state: 'RUNNING',
          observedAt: iso(plus(-10 * MIN)),
        },
      }),
    );
    expect(put.statusCode, put.body).toBe(200);
    const stage = async (position: number, state: string, at: number, name = `Stage ${position}`) =>
      app.inject(
        asIngest({
          method: 'PUT',
          url: `/api/ingest/workflows/${ext}/stages/${position}`,
          payload: { name, state, observedAt: iso(plus(at)), agent: 'planner', count: 3 },
        }),
      );
    expect((await stage(1, 'RUNNING', -9 * MIN)).statusCode).toBe(200);
    expect((await stage(1, 'COMPLETED', -8 * MIN)).statusCode).toBe(200);
    expect((await stage(2, 'RUNNING', -7 * MIN)).statusCode).toBe(200);
    expect((await stage(2, 'FAILED', -6 * MIN)).statusCode).toBe(200);
    expect((await stage(3, 'QUEUED', -6 * MIN)).statusCode).toBe(200);
    const fail = await app.inject(
      asIngest({
        method: 'POST',
        url: `/api/ingest/workflows/${ext}/transitions`,
        payload: { toState: 'FAILED', observedAt: iso(plus(-5 * MIN)), reason: 'Tests failed' },
      }),
    );
    expect(fail.statusCode, fail.body).toBe(200);
    return put.json().id as string;
  };
  const act = (cookie: string, id: string, action: string, note?: string) =>
    app.inject(
      asUser(cookie, {
        method: 'POST',
        url: `/api/workflows/${id}/actions`,
        payload: { action, note },
      }),
    );

  beforeAll(async () => {
    app = await testApp();
    engineer = await signIn(app, 'engineer1@cdevi.demo');
    viewer = await signIn(app, 'viewer1@cdevi.demo');
    approver = await signIn(app, 'approver1@cdevi.demo');
  });
  afterAll(() => app.close());

  it('FR-006 engineer retry moves the failing stage and workflow to RETRYING and records human transitions', async () => {
    const id = await ingestFailed();
    const r = await act(engineer, id, 'retry');
    expect(r.statusCode, r.body).toBe(200);
    const d: WorkflowDetail = r.json();
    expect(d.workflow.state).toBe('RETRYING');
    expect(d.stages[1]?.state).toBe('RETRYING');
    expect(d.failure).toBeNull();
    expect(d.actions.retry).toBe(false);
    const human = d.activity.filter((e) => e.source === 'human');
    expect(human).toHaveLength(2);
    expect(human[0]?.message).toMatch(/Retry requested by/);
    expect((await act(engineer, id, 'retry')).statusCode).toBe(409);
  });

  it('FR-006 viewer is forbidden; approver may escalate but not retry or cancel', async () => {
    const id = await ingestFailed();
    expect((await act(viewer, id, 'retry')).statusCode).toBe(403);
    expect((await act(viewer, id, 'escalate')).statusCode).toBe(403);
    expect((await act(approver, id, 'retry')).statusCode).toBe(403);
    expect((await act(approver, id, 'cancel')).statusCode).toBe(403);
    const esc = await act(approver, id, 'escalate', 'Needs a human look');
    expect(esc.statusCode, esc.body).toBe(200);
    const d: WorkflowDetail = esc.json();
    expect(d.workflow.state).toBe('FAILED');
    const last = d.activity.at(-1);
    expect(last?.source).toBe('human');
    expect(last?.message).toMatch(/Escalated by .*Needs a human look/);
  });

  it('FR-006 engineer cancel terminates the workflow and every non-terminal stage', async () => {
    const id = await ingestFailed();
    const r = await act(engineer, id, 'cancel', 'Superseded');
    expect(r.statusCode, r.body).toBe(200);
    const d: WorkflowDetail = r.json();
    expect(d.workflow.state).toBe('CANCELLED');
    expect(d.workflow.finishedAt).toBe(FIXED_NOW.toISOString());
    expect(d.stages.map((s) => s.state)).toEqual(['COMPLETED', 'CANCELLED', 'CANCELLED']);
    expect(d.actions).toEqual({ retry: false, escalate: false, cancel: false });
    expect(d.workflow.stage).toEqual({
      index: d.currentStage!.stage.position,
      count: 3,
      name: d.currentStage!.stage.name,
    });
    expect((await act(engineer, id, 'cancel')).statusCode).toBe(409);
  });

  it('rejects unknown actions and cross-site requests', async () => {
    const id = await ingestFailed();
    expect((await act(engineer, id, 'approve')).statusCode).toBe(400);
    const noOrigin = await app.inject({
      method: 'POST',
      url: `/api/workflows/${id}/actions`,
      payload: { action: 'retry' },
      headers: { cookie: engineer, origin: 'https://evil.example' },
    });
    expect(noOrigin.statusCode).toBe(403);
  });
});
