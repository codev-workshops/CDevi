import type { Problem, RequirementDetail, RequirementIngestResult } from '@cdevi/contracts';
import { hashToken } from '@cdevi/db';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asIngest, asUser, HOUR, iso, MIN, plus, signIn, skipDb, testApp, uniq } from './helpers';

const analysis = (over: Record<string, unknown> = {}) => ({
  agent: 'Requirement Agent',
  observedAt: iso(plus(-10 * MIN)),
  summary: 'Feasible within the payments domain.',
  acceptanceCriteria: [
    'Retries stop after three attempts.',
    'A declined card is never retried twice a day.',
  ],
  rules: ['Hard declines are terminal.'],
  openQuestions: [] as string[],
  ...over,
});

describe.skipIf(skipDb)(
  'PUT /api/ingest/requirements/{externalId}/analysis (specs/001 US4, FR-036/FR-009/FR-007/FR-032, SC-007)',
  () => {
    let app: FastifyInstance;
    let engineer: string;
    let payments: string;
    const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });

    beforeAll(async () => {
      app = await testApp();
      engineer = await signIn(app, 'engineer1@cdevi.demo');
      payments = (
        await app.pool.query<{ id: string }>(`SELECT id FROM projects WHERE key = 'payments-api'`)
      ).rows[0]!.id;
    });
    afterAll(async () => {
      await app.close();
      await pool.end();
    });

    const put = (ext: string, body: object, token?: string) =>
      app.inject(
        asIngest(
          { method: 'PUT', url: `/api/ingest/requirements/${ext}/analysis`, payload: body },
          token,
        ),
      );
    const detail = async (id: string): Promise<RequirementDetail> => {
      const r = await app.inject(
        asUser(engineer, { method: 'GET', url: `/api/requirements/${id}` }),
      );
      expect(r.statusCode, r.body).toBe(200);
      return r.json();
    };
    /** Creates a requirement as engineer1 and optionally submits it (DRAFT → ANALYZING). */
    async function requirement(submit = true, criteria: string[] = []): Promise<RequirementDetail> {
      const r = await app.inject(
        asUser(engineer, {
          method: 'POST',
          url: '/api/requirements',
          payload: {
            projectId: payments,
            title: `Analysis target ${uniq('a')}`,
            businessObjective:
              'Reduce involuntary churn caused by soft card declines at renewal time.',
            acceptanceCriteria: criteria,
          },
        }),
      );
      expect(r.statusCode, r.body).toBe(201);
      const d = r.json() as RequirementDetail;
      if (!submit) return d;
      const s = await app.inject(
        asUser(engineer, { method: 'POST', url: `/api/requirements/${d.requirement.id}/submit` }),
      );
      expect(s.statusCode, s.body).toBe(200);
      return s.json();
    }
    const items = async (id: string) =>
      (
        await pool.query<{
          kind: string;
          position: number;
          text: string;
          ai_generated: boolean;
          source: string;
        }>(
          `SELECT kind, position, text, ai_generated, source FROM requirement_analysis_items WHERE requirement_id = $1 ORDER BY kind, ai_generated, position`,
          [id],
        )
      ).rows;
    const logOutcomes = async (ext: string) =>
      (
        await pool.query<{ outcome: string }>(
          `SELECT outcome FROM ingestion_log WHERE target_external_id = $1 ORDER BY received_at`,
          [ext],
        )
      ).rows.map((r) => r.outcome);

    it('FR-036 on ANALYZING with 0 open questions returns accepted/READY and stores AI items with aiGenerated:true source agent:{agent}, analysis_observed_at, summary; ingestion_log row written', async () => {
      const d = await requirement();
      expect(d.requirement.state).toBe('ANALYZING');
      const ext = d.requirement.externalId;
      const r = await put(ext, analysis());
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json() as RequirementIngestResult).toEqual({
        outcome: 'accepted',
        id: d.requirement.id,
        state: 'READY',
      });
      const rows = await items(d.requirement.id);
      expect(rows).toHaveLength(3);
      expect(rows.every((i) => i.ai_generated && i.source === 'agent:Requirement Agent')).toBe(
        true,
      );
      expect(rows.filter((i) => i.kind === 'acceptance_criterion').map((i) => i.position)).toEqual([
        1, 2,
      ]);
      const head = await pool.query<{
        state: string;
        analysis_observed_at: Date;
        analysis_agent: string;
        analysis_summary: string;
      }>(
        `SELECT state, analysis_observed_at, analysis_agent, analysis_summary FROM requirements WHERE id = $1`,
        [d.requirement.id],
      );
      expect(head.rows[0]).toEqual({
        state: 'READY',
        analysis_observed_at: plus(-10 * MIN),
        analysis_agent: 'Requirement Agent',
        analysis_summary: 'Feasible within the payments domain.',
      });
      expect(await logOutcomes(ext)).toEqual(['accepted']);
      const after = await detail(d.requirement.id);
      expect(after.analysis).toMatchObject({
        observedAt: iso(plus(-10 * MIN)),
        summary: 'Feasible within the payments domain.',
      });
      expect(after.analysis!.acceptanceCriteria.every((c) => c.aiGenerated)).toBe(true);
      expect(after.transitions.at(-1)).toMatchObject({
        fromState: 'ANALYZING',
        toState: 'READY',
        actorType: 'agent',
        actorName: 'Requirement Agent',
      });
    });

    it('FR-009 with open questions returns NEEDS_CLARIFICATION; a newer delivery replaces every AI item and leaves human items untouched', async () => {
      const d = await requirement(true, ['Human criterion one.']);
      const ext = d.requirement.externalId;
      const first = await put(
        ext,
        analysis({ openQuestions: ['Which card networks are in scope?'] }),
      );
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({ outcome: 'accepted', state: 'NEEDS_CLARIFICATION' });
      const before = await detail(d.requirement.id);
      expect(before.requirement.openQuestionCount).toBe(1);
      expect(before.analysis!.openQuestions).toHaveLength(1);
      const second = await put(
        ext,
        analysis({
          observedAt: iso(plus(-5 * MIN)),
          acceptanceCriteria: ['Only the new criterion.'],
          rules: [],
          openQuestions: [],
          summary: null,
        }),
      );
      expect(second.statusCode, second.body).toBe(200);
      expect(second.json()).toMatchObject({ outcome: 'accepted', state: 'READY' });
      const rows = await items(d.requirement.id);
      expect(rows.filter((i) => i.ai_generated).map((i) => [i.kind, i.position, i.text])).toEqual([
        ['acceptance_criterion', 1, 'Only the new criterion.'],
      ]);
      expect(
        rows.filter((i) => !i.ai_generated).map((i) => [i.kind, i.position, i.text, i.source]),
      ).toEqual([['acceptance_criterion', 1, 'Human criterion one.', 'user:Engineer 1']]);
      const after = await detail(d.requirement.id);
      expect(after.requirement.openQuestionCount).toBe(0);
      expect(after.analysis!.summary).toBeNull();
      expect(after.transitions.map((t) => t.toState)).toEqual([
        'DRAFT',
        'ANALYZING',
        'NEEDS_CLARIFICATION',
        'READY',
      ]);
      expect(await logOutcomes(ext)).toEqual(['accepted', 'accepted']);
    });

    it('FR-007 analysis on a requirement created with 2 authored criteria stores AI criteria at positions 1..n next to the human criteria at positions 1..2 (no unique violation) and the detail lists human criteria first', async () => {
      const d = await requirement(true, ['Authored one.', 'Authored two.']);
      const r = await put(
        d.requirement.externalId,
        analysis({ acceptanceCriteria: ['AI one.', 'AI two.', 'AI three.'] }),
      );
      expect(r.statusCode, r.body).toBe(200);
      const after = await detail(d.requirement.id);
      expect(
        after.analysis!.acceptanceCriteria.map((c) => [c.position, c.aiGenerated, c.text]),
      ).toEqual([
        [1, false, 'Authored one.'],
        [2, false, 'Authored two.'],
        [1, true, 'AI one.'],
        [2, true, 'AI two.'],
        [3, true, 'AI three.'],
      ]);
      expect(
        after
          .analysis!.acceptanceCriteria.filter((c) => !c.aiGenerated)
          .every((c) => c.source === 'user:Engineer 1'),
      ).toBe(true);
    });

    it('FR-036 an equal or older observedAt returns stale and writes nothing', async () => {
      const d = await requirement();
      const ext = d.requirement.externalId;
      expect((await put(ext, analysis())).statusCode).toBe(200);
      const same = await put(
        ext,
        analysis({
          acceptanceCriteria: ['Would replace.'],
          openQuestions: ['Would flip the state?'],
        }),
      );
      expect(same.statusCode).toBe(200);
      expect(same.json()).toEqual({ outcome: 'stale', id: d.requirement.id, state: 'READY' });
      const older = await put(
        ext,
        analysis({ observedAt: iso(plus(-HOUR)), acceptanceCriteria: ['Would replace.'] }),
      );
      expect(older.json()).toMatchObject({ outcome: 'stale', state: 'READY' });
      const rows = await items(d.requirement.id);
      expect(rows.map((i) => i.text)).not.toContain('Would replace.');
      expect(rows.some((i) => i.kind === 'open_question')).toBe(false);
      expect(await logOutcomes(ext)).toEqual(['accepted', 'stale', 'stale']);
      expect((await detail(d.requirement.id)).transitions).toHaveLength(3);
    });

    it('FR-036 on DRAFT, APPROVED or REJECTED returns 409 invalid-transition', async () => {
      const draft = await requirement(false);
      const r = await put(draft.requirement.externalId, analysis());
      expect(r.statusCode).toBe(409);
      expect((r.json() as Problem).type).toBe('urn:cdevi:problem:invalid-transition');
      expect(await logOutcomes(draft.requirement.externalId)).toEqual(['rejected']);
      expect(await items(draft.requirement.id)).toEqual([]);
      const approver = await signIn(app, 'approver1@cdevi.demo');
      const approved = await requirement();
      expect((await put(approved.requirement.externalId, analysis())).statusCode).toBe(200);
      expect(
        (
          await app.inject(
            asUser(approver, {
              method: 'POST',
              url: `/api/requirements/${approved.requirement.id}/approve`,
            }),
          )
        ).statusCode,
      ).toBe(200);
      expect(
        (await put(approved.requirement.externalId, analysis({ observedAt: iso(plus(-MIN)) })))
          .statusCode,
      ).toBe(409);
      const rejected = await requirement(false);
      expect(
        (
          await app.inject(
            asUser(approver, {
              method: 'POST',
              url: `/api/requirements/${rejected.requirement.id}/reject`,
              payload: { reason: 'No.' },
            }),
          )
        ).statusCode,
      ).toBe(200);
      expect((await put(rejected.requirement.externalId, analysis())).statusCode).toBe(409);
    });

    it('FR-032 a principal not scoped to the project returns 403; missing bearer 401; unknown externalId 404', async () => {
      const d = await requirement();
      const token = `cdvi_${uniq('scoped').replace(/[^a-z0-9]/gi, '')}`;
      const other = await pool.query<{ id: string }>(
        `INSERT INTO ingestion_principals (organization_id, name, token_hash, project_ids)
         SELECT p.organization_id, 'web-app-only', $2, ARRAY[p.id] FROM projects p WHERE p.key = 'web-app' RETURNING id`,
        [hashToken(token)],
      );
      expect(other.rows).toHaveLength(1);
      const forbidden = await put(d.requirement.externalId, analysis(), token);
      expect(forbidden.statusCode, forbidden.body).toBe(403);
      expect((forbidden.json() as Problem).type).toBe('urn:cdevi:problem:forbidden');
      expect(await logOutcomes(d.requirement.externalId)).toEqual(['forbidden']);
      const anon = await app.inject({
        method: 'PUT',
        url: `/api/ingest/requirements/${d.requirement.externalId}/analysis`,
        payload: analysis(),
      });
      expect(anon.statusCode).toBe(401);
      const unknown = await put(uniq('req-unknown'), analysis());
      expect(unknown.statusCode).toBe(404);
      expect((unknown.json() as Problem).type).toBe('urn:cdevi:problem:not-found');
      expect((await detail(d.requirement.id)).requirement.state).toBe('ANALYZING');
    });

    it('FR-036 51 criteria or 21 open questions return 400 without echoing the body', async () => {
      const d = await requirement();
      const marker = 'ECHO-MARKER-criterion';
      const many = await put(
        d.requirement.externalId,
        analysis({ acceptanceCriteria: Array.from({ length: 51 }, (_, i) => `${marker} ${i}`) }),
      );
      expect(many.statusCode).toBe(400);
      expect((many.json() as Problem).type).toBe('urn:cdevi:problem:validation');
      expect(many.body).not.toContain(marker);
      const questions = await put(
        d.requirement.externalId,
        analysis({ openQuestions: Array.from({ length: 21 }, (_, i) => `${marker} q${i}`) }),
      );
      expect(questions.statusCode).toBe(400);
      expect(questions.body).not.toContain(marker);
      expect(await items(d.requirement.id)).toEqual([]);
      expect((await detail(d.requirement.id)).requirement.state).toBe('ANALYZING');
    });

    it('SC-007 PUT analysis with 120 items p95 ≤ 200 ms over 20 calls', async () => {
      const d = await requirement();
      const durations: number[] = [];
      for (let i = 0; i < 20; i++) {
        const started = performance.now();
        const r = await put(
          d.requirement.externalId,
          analysis({
            observedAt: iso(plus(-HOUR + i * MIN)),
            acceptanceCriteria: Array.from({ length: 50 }, (_, k) => `Criterion ${i}.${k}`),
            rules: Array.from({ length: 50 }, (_, k) => `Rule ${i}.${k}`),
            openQuestions: Array.from({ length: 20 }, (_, k) => `Question ${i}.${k}`),
          }),
        );
        durations.push(performance.now() - started);
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json()).toMatchObject({ outcome: 'accepted', state: 'NEEDS_CLARIFICATION' });
      }
      expect(await items(d.requirement.id)).toHaveLength(120);
      durations.sort((a, b) => a - b);
      const p95 = durations[Math.ceil(durations.length * 0.95) - 1]!;
      expect(p95, durations.map((x) => x.toFixed(0)).join(',')).toBeLessThanOrEqual(200);
    });
  },
);
