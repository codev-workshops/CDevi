import type { AgentRunDetail, Problem } from '@cdevi/contracts';
import { runDuration } from '@cdevi/contracts/agent-run-model';
import { EXPECTED_AGENT_DECISIONS, SHOWCASE_WAITING } from '@cdevi/db/seed';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, FIXED_NOW, signIn, skipDb, testApp } from './helpers';

const ZERO = '00000000-0000-4000-8000-000000000000';
const FORBIDDEN_KEYS = ['reasoning', 'chainOfThought', 'thoughts', 'rationale'];

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  return out;
}

describe.skipIf(skipDb)(
  'GET /api/agent-runs/{id} (specs/001 US5, FR-016/FR-017/FR-018/FR-032, SC-007)',
  () => {
    let app: FastifyInstance;
    let admin: string;
    let viewer: string;
    let engineer: string;
    let activeId: string;
    let completedId: string;

    const runIdOf = async (ext: string) =>
      (
        await app.pool.query<{ id: string }>(`SELECT id FROM agent_runs WHERE external_id = $1`, [
          ext,
        ])
      ).rows[0]!.id;
    const get = (cookie: string, id: string) =>
      app.inject(asUser(cookie, { method: 'GET', url: `/api/agent-runs/${id}` }));
    const detail = async (cookie: string, id: string): Promise<AgentRunDetail> => {
      const r = await get(cookie, id);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.headers['server-timing']).toMatch(/dur=/);
      return r.json();
    };

    beforeAll(async () => {
      app = await testApp();
      admin = await signIn(app, 'admin@cdevi.demo');
      viewer = await signIn(app, 'viewer1@cdevi.demo');
      engineer = await signIn(app, 'engineer1@cdevi.demo');
      activeId = await runIdOf(EXPECTED_AGENT_DECISIONS.active.externalId);
      completedId = await runIdOf(EXPECTED_AGENT_DECISIONS.completed.externalId);
    });
    afterAll(() => app.close());

    it('FR-016 GET /api/agent-runs/{id} returns header, timeline, steps and decisions in position order', async () => {
      const d = await detail(engineer, completedId);
      expect(d.id).toBe(completedId);
      expect(d.externalId).toBe(EXPECTED_AGENT_DECISIONS.completed.externalId);
      expect(d.state).toBe('COMPLETED');
      expect(d.agent).toEqual(expect.any(String));
      expect(d.model).toEqual(expect.any(String));
      expect(d.summary).toEqual(expect.any(String));
      expect(d.finishedAt).not.toBeNull();
      expect(d.durationMs).toBe(
        new Date(d.finishedAt!).getTime() - new Date(d.startedAt).getTime(),
      );
      expect(d.workflow.externalId).toBe(SHOWCASE_WAITING);
      expect(d.workflow.title).toEqual(expect.any(String));
      expect(d.stage).toEqual({ position: 4, name: 'Implementation' });
      const ats = d.timeline.map((e) => new Date(e.at).getTime());
      expect(ats).toEqual([...ats].sort((a, b) => a - b));
      expect(d.steps).toHaveLength(4);
      expect(d.steps.every((s) => s.status === 'completed')).toBe(true);
      expect(d.decisions).toHaveLength(EXPECTED_AGENT_DECISIONS.completed.decisions);
      expect(d.decisions.map((x) => x.position)).toEqual([1, 2]);
      const denied = d.decisions[1]!;
      expect(denied.policyOutcome).toBe('DENIED');
      expect(denied.policyRef).toBe('POL-DEP-01');
      expect(denied.confidence).toBe('MEDIUM');
      expect(denied.riskLevel ?? null).toBeNull();
      expect(denied.evidence[0]).toMatchObject({ kind: 'url', accessible: true });
      expect(denied.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('FR-017 an active run carries 3 decisions with APPROVAL_REQUIRED + riskLevel and a restricted evidence ref without href; durationMs uses the request clock', async () => {
      const d = await detail(engineer, activeId);
      expect(d.state).toBe('WAITING_FOR_HUMAN');
      expect(d.finishedAt).toBeNull();
      expect(d.durationMs).toBe(runDuration(d.startedAt, null, FIXED_NOW));
      expect(d.stage).toEqual({ position: 6, name: 'Review' });
      expect(d.steps.map((s) => s.status)).toEqual([
        'completed',
        'completed',
        'running',
        'pending',
      ]);
      expect(d.decisions).toHaveLength(EXPECTED_AGENT_DECISIONS.active.decisions);
      expect(d.decisions.map((x) => x.position)).toEqual([1, 2, 3]);
      const restricted = d.decisions[1]!.evidence[0]!;
      expect(restricted.accessible).toBe(false);
      expect(restricted.href ?? null).toBeNull();
      expect(restricted.locator).toBe('platform-perf/perf/auth-load.k6.js');
      expect(d.decisions[2]).toMatchObject({
        policyOutcome: 'APPROVAL_REQUIRED',
        policyRef: 'POL-AUTH-03',
        riskLevel: 'MEDIUM',
        confidence: 'HIGH',
      });
    });

    it('FR-018 the response contains no reasoning-like key at any depth', async () => {
      const d = await detail(engineer, activeId);
      const keys = keysDeep(d);
      for (const k of FORBIDDEN_KEYS) expect(keys.has(k), k).toBe(false);
    });

    it('FR-032 viewer can read an agent run', async () => {
      const v = await get(viewer, activeId);
      expect(v.statusCode, v.body).toBe(200);
      const a = await get(admin, activeId);
      expect(v.body).toBe(a.body);
      const before = (
        await app.pool.query<{ c: string }>(
          `SELECT (SELECT count(*) FROM audit_events) + (SELECT count(*) FROM ingestion_log) AS c`,
        )
      ).rows[0]!.c;
      await get(viewer, completedId);
      const after = (
        await app.pool.query<{ c: string }>(
          `SELECT (SELECT count(*) FROM audit_events) + (SELECT count(*) FROM ingestion_log) AS c`,
        )
      ).rows[0]!.c;
      expect(after).toBe(before);
    });

    it('FR-032 run in an invisible project → 404', async () => {
      const hidden = (
        await app.pool.query<{ id: string }>(
          `SELECT r.id FROM agent_runs r JOIN projects p ON p.id = r.project_id WHERE p.key = 'dashboard-demo' LIMIT 1`,
        )
      ).rows[0]!.id;
      const r = await get(viewer, hidden);
      expect(r.statusCode, r.body).toBe(404);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      const unknown = await get(viewer, ZERO);
      expect(unknown.statusCode).toBe(404);
      expect(r.json()).toEqual(unknown.json());
      expect((r.json() as Problem).detail).not.toMatch(/project|organization/i);
      expect((await get(admin, hidden)).statusCode).toBe(200);
    });

    it('401 without session', async () => {
      const r = await app.inject({ method: 'GET', url: `/api/agent-runs/${activeId}` });
      expect(r.statusCode).toBe(401);
      expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
      const bad = await get(engineer, 'not-a-uuid');
      expect(bad.statusCode).toBe(400);
      expect((bad.json() as Problem).type).toBe('urn:cdevi:problem:validation');
    });
  },
);
