import type { AgentDecisionsIngestResult, AgentRunDetail, Problem } from '@cdevi/contracts';
import { hashToken } from '@cdevi/db';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asIngest, asUser, iso, MIN, plus, signIn, skipDb, testApp, uniq } from './helpers';

const DECISIONS_ROUTE = 'PUT /ingest/agent-runs/{externalId}/decisions';

const evidence = (over: Record<string, unknown> = {}) => ({
  kind: 'file',
  label: 'src/auth/limiter.ts',
  href: 'https://git.cdevi.demo/payments-api/blob/main/src/auth/limiter.ts',
  locator: 'src/auth/limiter.ts:12',
  accessible: true,
  ...over,
});
const decision = (position: number, over: Record<string, unknown> = {}) => ({
  position,
  decidedAt: iso(plus(-20 * MIN + position * 1000)),
  action: `Decision ${position}`,
  reason: `Reason ${position}.`,
  confidence: 'HIGH',
  policyOutcome: 'ALLOWED',
  evidence: [evidence()],
  ...over,
});
const batch = (n: number, observedAt = iso(plus(-10 * MIN))) => ({
  observedAt,
  decisions: Array.from({ length: n }, (_, i) => decision(i + 1)),
});

describe.skipIf(skipDb)(
  'PUT /api/ingest/agent-runs/{externalId}/decisions (specs/001 US5, FR-017/FR-018/FR-034/FR-036, SC-007)',
  () => {
    let app: FastifyInstance;
    let engineer: string;
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });

    beforeAll(async () => {
      app = await testApp();
      engineer = await signIn(app, 'engineer1@cdevi.demo');
    });
    afterAll(async () => {
      await app.close();
      await pool.end();
    });

    const putRun = (ext: string, payload: Record<string, unknown>) =>
      app.inject(asIngest({ method: 'PUT', url: `/api/ingest/agent-runs/${ext}`, payload }));
    const putDecisions = (
      ext: string,
      body: NonNullable<InjectOptions['payload']>,
      token?: string,
    ) =>
      app.inject(
        asIngest(
          { method: 'PUT', url: `/api/ingest/agent-runs/${ext}/decisions`, payload: body },
          token,
        ),
      );
    /** A RUNNING workflow with one stage and one agent run (state per `runState`). */
    async function newRun(runState = 'RUNNING', over: Record<string, unknown> = {}) {
      const wext = uniq('dec-w');
      const w = await app.inject(
        asIngest({
          method: 'PUT',
          url: `/api/ingest/workflows/${wext}`,
          payload: {
            projectKey: 'payments-api',
            title: 'Decisions ingest',
            state: 'RUNNING',
            observedAt: iso(plus(-40 * MIN)),
          },
        }),
      );
      expect(w.statusCode, w.body).toBe(200);
      const s = await app.inject(
        asIngest({
          method: 'PUT',
          url: `/api/ingest/workflows/${wext}/stages/4`,
          payload: { name: 'Implementation', state: 'RUNNING', observedAt: iso(plus(-39 * MIN)) },
        }),
      );
      expect(s.statusCode, s.body).toBe(200);
      const ext = uniq('dec-r');
      const r = await putRun(ext, {
        workflowExternalId: wext,
        stagePosition: 4,
        agent: 'Implementation Agent',
        model: 'gpt-5',
        state: runState,
        startedAt: iso(plus(-38 * MIN)),
        finishedAt: runState === 'RUNNING' ? null : iso(plus(-30 * MIN)),
        ...over,
      });
      expect(r.statusCode, r.body).toBe(200);
      return { ext, id: r.json().id as string, workflowId: w.json().id as string };
    }
    const rows = (runId: string) =>
      pool
        .query<{ position: number; action: string; evidence: unknown; risk_level: string | null }>(
          `SELECT position, action, evidence, risk_level FROM agent_decisions WHERE agent_run_id = $1 ORDER BY position`,
          [runId],
        )
        .then((r) => r.rows);
    const logRows = (ext: string) =>
      pool
        .query<{ outcome: string; route: string; detail: string | null }>(
          `SELECT outcome, route, detail FROM ingestion_log WHERE target_external_id = $1 AND route = $2 ORDER BY received_at`,
          [ext, DECISIONS_ROUTE],
        )
        .then((r) => r.rows);
    const inboxCount = async (workflowId: string) =>
      Number(
        (
          await pool.query<{ c: string }>(
            `SELECT count(*) c FROM inbox_change_log WHERE workflow_id = $1`,
            [workflowId],
          )
        ).rows[0]!.c,
      );
    const watermark = async (runId: string) =>
      (
        await pool.query<{ decisions_observed_at: Date | null }>(
          `SELECT decisions_observed_at FROM agent_runs WHERE id = $1`,
          [runId],
        )
      ).rows[0]!.decisions_observed_at;
    const detail = async (id: string): Promise<AgentRunDetail> => {
      const r = await app.inject(asUser(engineer, { method: 'GET', url: `/api/agent-runs/${id}` }));
      expect(r.statusCode, r.body).toBe(200);
      return r.json();
    };

    it('FR-017 decisions ingest replaces the whole set', async () => {
      const run = await newRun();
      const first = await putDecisions(run.ext, {
        observedAt: iso(plus(-10 * MIN)),
        decisions: [
          decision(1),
          decision(2, { policyOutcome: 'DENIED', policyRef: 'POL-DEP-01', riskLevel: 'HIGH' }),
          decision(3, {
            evidence: [evidence({ kind: 'artifact', href: undefined, accessible: false })],
          }),
        ],
      });
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json() as AgentDecisionsIngestResult).toEqual({ result: 'accepted', count: 3 });
      const stored = await rows(run.id);
      expect(stored.map((r) => r.position)).toEqual([1, 2, 3]);
      expect(stored[1]!.risk_level).toBe('HIGH');
      expect(stored[2]!.evidence).toEqual([
        {
          kind: 'artifact',
          label: 'src/auth/limiter.ts',
          locator: 'src/auth/limiter.ts:12',
          accessible: false,
        },
      ]);
      const copied = await pool.query<{ ok: boolean }>(
        `SELECT bool_and(d.organization_id = r.organization_id AND d.project_id = r.project_id AND d.workflow_id = r.workflow_id AND d.stage_id = r.stage_id) ok
           FROM agent_decisions d JOIN agent_runs r ON r.id = d.agent_run_id WHERE d.agent_run_id = $1`,
        [run.id],
      );
      expect(copied.rows[0]!.ok).toBe(true);
      expect((await watermark(run.id))?.toISOString()).toBe(iso(plus(-10 * MIN)));

      const second = await putDecisions(run.ext, {
        observedAt: iso(plus(-5 * MIN)),
        decisions: [decision(7, { action: 'Replaced' }), decision(9, { action: 'Replaced too' })],
      });
      expect(second.statusCode, second.body).toBe(200);
      expect(second.json()).toEqual({ result: 'accepted', count: 2 });
      expect((await rows(run.id)).map((r) => [r.position, r.action])).toEqual([
        [7, 'Replaced'],
        [9, 'Replaced too'],
      ]);
      expect((await logRows(run.ext)).map((l) => l.outcome)).toEqual(['accepted', 'accepted']);

      const read = await detail(run.id);
      expect(read.decisions.map((d) => d.position)).toEqual([7, 9]);
      expect(read.decisions.every((d) => typeof d.id === 'string')).toBe(true);
    });

    it('FR-036 stale observedAt → stale, no writes', async () => {
      const run = await newRun();
      expect((await putDecisions(run.ext, batch(2, iso(plus(-10 * MIN))))).statusCode).toBe(200);
      const before = await rows(run.id);
      const inboxBefore = await inboxCount(run.workflowId);

      const stale = await putDecisions(run.ext, batch(3, iso(plus(-10 * MIN))));
      expect(stale.statusCode, stale.body).toBe(200);
      expect(stale.json()).toEqual({ result: 'stale', count: 2 });
      const older = await putDecisions(run.ext, batch(1, iso(plus(-15 * MIN))));
      expect(older.json()).toEqual({ result: 'stale', count: 2 });

      expect(await rows(run.id)).toEqual(before);
      expect((await watermark(run.id))?.toISOString()).toBe(iso(plus(-10 * MIN)));
      expect(await inboxCount(run.workflowId)).toBe(inboxBefore);
      const log = await logRows(run.ext);
      expect(log.map((l) => l.outcome)).toEqual(['accepted', 'stale', 'stale']);
      expect(log[1]!.detail).toMatch(/not newer/);
    });

    it('FR-036 the decisions watermark is independent of the run upsert; a stale batch on a terminal run is still 200 stale (no 409)', async () => {
      const run = await newRun();
      expect((await putDecisions(run.ext, batch(1, iso(plus(-10 * MIN))))).statusCode).toBe(200);
      // A later run upsert (bumps the run itself) must not make the next decisions batch stale.
      const upsert = await putRun(run.ext, {
        workflowExternalId: (
          await pool.query<{ external_id: string }>(
            `SELECT external_id FROM workflows WHERE id = $1`,
            [run.workflowId],
          )
        ).rows[0]!.external_id,
        stagePosition: 4,
        agent: 'Implementation Agent',
        state: 'COMPLETED',
        startedAt: iso(plus(-38 * MIN)),
        finishedAt: iso(plus(-2 * MIN)),
        steps: [{ label: 'Done', status: 'completed' }],
      });
      expect(upsert.statusCode, upsert.body).toBe(200);
      const newer = await putDecisions(run.ext, batch(2, iso(plus(-8 * MIN))));
      expect(newer.statusCode, newer.body).toBe(200);
      expect(newer.json()).toEqual({ result: 'accepted', count: 2 });

      const olderOnTerminal = await putDecisions(run.ext, batch(1, iso(plus(-9 * MIN))));
      expect(olderOnTerminal.statusCode, olderOnTerminal.body).toBe(200);
      expect(olderOnTerminal.json()).toEqual({ result: 'stale', count: 2 });
      expect((await rows(run.id)).map((r) => r.position)).toEqual([1, 2]);
      expect((await logRows(run.ext)).map((l) => l.outcome)).toEqual([
        'accepted',
        'accepted',
        'stale',
      ]);
      const newerOnTerminal = await putDecisions(run.ext, batch(3, iso(plus(-7 * MIN))));
      expect(newerOnTerminal.json()).toEqual({ result: 'accepted', count: 3 });
    });

    it('FR-018 unknown reasoning keys → 400', async () => {
      const run = await newRun();
      for (const key of ['reasoning', 'chainOfThought', 'thoughts']) {
        const r = await putDecisions(run.ext, {
          observedAt: iso(plus(-10 * MIN)),
          decisions: [decision(1, { [key]: 'Let me think step by step about the token bucket…' })],
        });
        expect(r.statusCode, `${key}: ${r.body}`).toBe(400);
        const p = r.json() as Problem;
        expect(p.type).toBe('urn:cdevi:problem:validation');
        expect(JSON.stringify(p.errors)).toContain(key);
        expect(r.body).not.toContain('step by step');
      }
      const top = await putDecisions(run.ext, { ...batch(1), rationale: 'nope' });
      expect(top.statusCode).toBe(400);
      expect(await rows(run.id)).toEqual([]);
      expect(await logRows(run.ext)).toEqual([]);
    });

    it('bounds: 51 decisions → 400', async () => {
      const run = await newRun();
      const cases: [string, NonNullable<InjectOptions['payload']>][] = [
        ['51 decisions', batch(51)],
        [
          '21 evidence refs',
          {
            observedAt: iso(plus(-10 * MIN)),
            decisions: [decision(1, { evidence: Array.from({ length: 21 }, () => evidence()) })],
          },
        ],
        [
          'duplicate position',
          { observedAt: iso(plus(-10 * MIN)), decisions: [decision(1), decision(1)] },
        ],
        [
          '601-char reason',
          {
            observedAt: iso(plus(-10 * MIN)),
            decisions: [decision(1, { reason: 'x'.repeat(601) })],
          },
        ],
        [
          'evidence without accessible',
          {
            observedAt: iso(plus(-10 * MIN)),
            decisions: [decision(1, { evidence: [evidence({ accessible: undefined })] })],
          },
        ],
      ];
      for (const [name, body] of cases) {
        const r = await putDecisions(run.ext, body);
        expect(r.statusCode, `${name}: ${r.body}`).toBe(400);
        expect((r.json() as Problem).type).toBe('urn:cdevi:problem:validation');
      }
      const max = await putDecisions(run.ext, {
        observedAt: iso(plus(-10 * MIN)),
        decisions: Array.from({ length: 50 }, (_, i) =>
          decision(i + 1, { evidence: Array.from({ length: 20 }, () => evidence()) }),
        ),
      });
      expect(max.statusCode, max.body).toBe(200);
      expect(max.json()).toEqual({ result: 'accepted', count: 50 });
    });

    it('NOTIFY: one inbox_change_log row per ingest', async () => {
      const run = await newRun();
      const base = await inboxCount(run.workflowId);
      expect((await putDecisions(run.ext, batch(3, iso(plus(-10 * MIN))))).statusCode).toBe(200);
      expect(await inboxCount(run.workflowId)).toBe(base + 1);
      const empty = await putDecisions(run.ext, { observedAt: iso(plus(-9 * MIN)), decisions: [] });
      expect(empty.statusCode, empty.body).toBe(200);
      expect(empty.json()).toEqual({ result: 'accepted', count: 0 });
      expect(await rows(run.id)).toEqual([]);
      expect(await inboxCount(run.workflowId)).toBe(base + 2);
      const last = await pool.query<{ project_id: string; organization_id: string }>(
        `SELECT project_id, organization_id FROM inbox_change_log WHERE workflow_id = $1 ORDER BY seq DESC LIMIT 1`,
        [run.workflowId],
      );
      const runRow = await pool.query<{ project_id: string; organization_id: string }>(
        `SELECT project_id, organization_id FROM agent_runs WHERE id = $1`,
        [run.id],
      );
      expect(last.rows[0]).toEqual(runRow.rows[0]);

      const fresh = await newRun();
      const freshBase = await inboxCount(fresh.workflowId);
      const emptyOnEmpty = await putDecisions(fresh.ext, {
        observedAt: iso(plus(-9 * MIN)),
        decisions: [],
      });
      expect(emptyOnEmpty.statusCode, emptyOnEmpty.body).toBe(200);
      expect(await inboxCount(fresh.workflowId)).toBe(freshBase + 1);
    });

    it('FR-032 unknown externalId → 404; principal scoped to another project → 403 (logged); missing bearer → 401', async () => {
      const run = await newRun();
      const unknown = await putDecisions(uniq('dec-unknown'), batch(1));
      expect(unknown.statusCode, unknown.body).toBe(404);
      expect((unknown.json() as Problem).type).toBe('urn:cdevi:problem:not-found');

      const token = `cdvi_${uniq('scoped').replace(/[^a-z0-9]/gi, '')}`;
      await pool.query(
        `INSERT INTO ingestion_principals (organization_id, name, token_hash, project_ids)
         SELECT p.organization_id, 'web-app-only', $1, ARRAY[p.id] FROM projects p WHERE p.key = 'web-app'`,
        [hashToken(token)],
      );
      const forbidden = await putDecisions(run.ext, batch(1), token);
      expect(forbidden.statusCode, forbidden.body).toBe(403);
      expect((await logRows(run.ext)).map((l) => l.outcome)).toEqual(['forbidden']);
      expect(await rows(run.id)).toEqual([]);

      const anon = await app.inject({
        method: 'PUT',
        url: `/api/ingest/agent-runs/${run.ext}/decisions`,
        payload: batch(1),
      });
      expect(anon.statusCode).toBe(401);
    });

    it('FR-017 a run upsert that moves the run to another stage moves its decisions with it', async () => {
      const run = await newRun();
      expect((await putDecisions(run.ext, batch(2, iso(plus(-10 * MIN))))).statusCode).toBe(200);
      const wext = (
        await pool.query<{ external_id: string }>(
          `SELECT external_id FROM workflows WHERE id = $1`,
          [run.workflowId],
        )
      ).rows[0]!.external_id;
      const s5 = await app.inject(
        asIngest({
          method: 'PUT',
          url: `/api/ingest/workflows/${wext}/stages/5`,
          payload: { name: 'Verification', state: 'RUNNING', observedAt: iso(plus(-9 * MIN)) },
        }),
      );
      expect(s5.statusCode, s5.body).toBe(200);
      const moved = await putRun(run.ext, {
        workflowExternalId: wext,
        stagePosition: 5,
        agent: 'Implementation Agent',
        state: 'RUNNING',
        startedAt: iso(plus(-38 * MIN)),
      });
      expect(moved.statusCode, moved.body).toBe(200);
      const stages = await pool.query<{ run_stage: string; decision_stages: string[] }>(
        `SELECT r.stage_id AS run_stage, array_agg(DISTINCT d.stage_id::text) AS decision_stages
           FROM agent_runs r JOIN agent_decisions d ON d.agent_run_id = r.id WHERE r.id = $1 GROUP BY r.stage_id`,
        [run.id],
      );
      expect(stages.rows[0]!.decision_stages).toEqual([stages.rows[0]!.run_stage]);
      expect((await detail(run.id)).stage.position).toBe(5);
      expect((await rows(run.id)).map((r) => r.position)).toEqual([1, 2]);
    });

    it('FR-016 GET /api/agent-runs/{id} returns the timeline in chronological order even when the runtime sent it unordered', async () => {
      const at = (m: number) => iso(plus(m * MIN));
      const run = await newRun('RUNNING', {
        timeline: [
          { at: at(-20), kind: 'note', message: 'third' },
          { at: at(-30), kind: 'note', message: 'first' },
          { at: at(-25), kind: 'note', message: 'second' },
        ],
      });
      expect((await detail(run.id)).timeline.map((e) => e.message)).toEqual([
        'first',
        'second',
        'third',
      ]);
    });

    it('FR-016 GET /api/agent-runs/{id} exposes the runtime-provided steps (≤ 20, default [])', async () => {
      const steps = Array.from({ length: 20 }, (_, i) => ({
        label: `Step ${i + 1}`,
        status: i < 3 ? 'completed' : i === 3 ? 'running' : 'pending',
      }));
      const run = await newRun('RUNNING', { steps });
      expect((await detail(run.id)).steps).toEqual(steps);
      const plain = await newRun();
      expect((await detail(plain.id)).steps).toEqual([]);
    });
  },
);
