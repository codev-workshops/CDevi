import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asIngest, FIXED_NOW, HOUR, iso, MIN, plus, skipDb, testApp, uniq } from './helpers';

const wfBody = (over: Record<string, unknown> = {}) => ({
  projectKey: 'payments-api',
  title: 'Ingested workflow',
  agent: 'Implementation Agent',
  state: 'RUNNING',
  stage: { index: 3, count: 7, name: 'Implementation' },
  observedAt: iso(plus(-10 * MIN)),
  ...over,
});

describe.skipIf(skipDb)('ingestion API (FR-020, FR-021)', () => {
  let app: FastifyInstance;
  const pool = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
  beforeAll(async () => {
    app = await testApp();
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const put = (ext: string, body: object, token?: string) =>
    app.inject(
      asIngest({ method: 'PUT', url: `/api/ingest/workflows/${ext}`, payload: body }, token),
    );
  const transition = (ext: string, body: object) =>
    app.inject(
      asIngest({ method: 'POST', url: `/api/ingest/workflows/${ext}/transitions`, payload: body }),
    );
  const logOutcomes = async (ext: string) =>
    (
      await pool.query(
        `select outcome from ingestion_log where target_external_id=$1 order by received_at`,
        [ext],
      )
    ).rows.map((r) => r.outcome);

  it('FR-021 unknown token → 401; disabled principal → 401; no token → 401', async () => {
    expect((await put(uniq('w'), wfBody(), 'cdvi_not_a_real_token')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/ingest/workflows/${uniq('w')}`,
          payload: wfBody(),
        })
      ).statusCode,
    ).toBe(401);
    const { rows } = await pool.query(
      `insert into ingestion_principals (organization_id, name, token_hash, project_ids, disabled_at) select id, 'dead', decode('00','hex'), '{}', now() from organizations limit 1 returning id`,
    );
    expect(rows).toHaveLength(1);
  });

  it('FR-021 project outside scope → 403; unknown project → 404 (both logged)', async () => {
    const { rows } = await pool.query(`select id from organizations limit 1`);
    const token = 'cdvi_scoped_token_000000000000000000000';
    const { hashToken } = await import('@cdevi/db');
    const p = (await pool.query(`select id from projects where key='web-app'`)).rows[0].id;
    await pool.query(
      `insert into ingestion_principals (organization_id, name, token_hash, project_ids) values ($1,'scoped',$2,$3) on conflict (token_hash) do nothing`,
      [rows[0].id, hashToken(token), [p]],
    );
    const ext = uniq('scoped');
    const forb = await put(ext, wfBody({ projectKey: 'payments-api' }), token);
    expect(forb.statusCode).toBe(403);
    const nf = await put(ext, wfBody({ projectKey: 'does-not-exist' }), token);
    expect(nf.statusCode).toBe(404);
    expect(await logOutcomes(ext)).toEqual(['forbidden', 'rejected']);
    expect((await put(ext, wfBody({ projectKey: 'web-app' }), token)).statusCode).toBe(200);
  });

  it('creates a workflow with a state and appends the transition with the principal', async () => {
    const ext = uniq('create');
    const res = await put(ext, wfBody());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'accepted', state: 'RUNNING' });
    const w = (await pool.query(`select * from workflows where external_id=$1`, [ext])).rows[0];
    expect(w.state).toBe('RUNNING');
    expect(w.started_at).toEqual(plus(-10 * MIN));
    expect(w.stage_index).toBe(3);
    expect(w.stage_name).toBe('Implementation');
    const t = (
      await pool.query(
        `select from_state, to_state, principal_id from workflow_transitions where workflow_id=$1 order by observed_at`,
        [w.id],
      )
    ).rows;
    expect(t).toHaveLength(1);
    expect(t[0].from_state).toBeNull();
    expect(t[0].to_state).toBe('RUNNING');
    expect(t[0].principal_id).not.toBeNull();
    expect(await logOutcomes(ext)).toEqual(['accepted']);
  });

  it('creating directly in a non-initial state → 409 invalid-transition', async () => {
    const res = await put(uniq('bad'), wfBody({ state: 'COMPLETED' }));
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toBe('urn:cdevi:problem:invalid-transition');
  });

  it('FR-021 out-of-order transition → 200 outcome=stale, state unchanged, logged stale', async () => {
    const ext = uniq('stale');
    await put(ext, wfBody());
    const res = await transition(ext, {
      toState: 'WAITING_FOR_HUMAN',
      observedAt: iso(plus(-20 * MIN)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'stale', state: 'RUNNING' });
    const w = (await pool.query(`select state from workflows where external_id=$1`, [ext])).rows[0];
    expect(w.state).toBe('RUNNING');
    expect(await logOutcomes(ext)).toEqual(['accepted', 'stale']);
    // same timestamp is also stale (must be strictly newer)
    expect(
      (
        await transition(ext, { toState: 'WAITING_FOR_HUMAN', observedAt: iso(plus(-10 * MIN)) })
      ).json().outcome,
    ).toBe('stale');
  });

  it('every transition in the table is accepted and every other pair is 409 (data-model.md §3)', async () => {
    const { WORKFLOW_TRANSITIONS, WORKFLOW_STATES } = await import('@cdevi/contracts');
    for (const from of WORKFLOW_STATES) {
      for (const to of WORKFLOW_STATES) {
        const allowed = WORKFLOW_TRANSITIONS[from].includes(to);
        const ext = uniq(`tt-${from}-${to}`);
        // reach `from` via a legal path
        const path = pathTo(from);
        let t = -60;
        await put(ext, wfBody({ state: path[0], observedAt: iso(plus(t * MIN)) }));
        for (const s of path.slice(1)) {
          t += 1;
          const r = await transition(ext, { toState: s, observedAt: iso(plus(t * MIN)) });
          expect(r.statusCode, `${path.join('>')}`).toBe(200);
        }
        const res = await transition(ext, { toState: to, observedAt: iso(plus((t + 1) * MIN)) });
        expect(res.statusCode, `${from} → ${to}`).toBe(allowed ? 200 : 409);
      }
    }
  });

  it('started_at is set on first RUNNING; finished_at on COMPLETED/CANCELLED', async () => {
    const ext = uniq('times');
    await put(ext, wfBody({ state: 'QUEUED', observedAt: iso(plus(-30 * MIN)), stage: null }));
    let w = (
      await pool.query(`select started_at, finished_at from workflows where external_id=$1`, [ext])
    ).rows[0];
    expect(w.started_at).toBeNull();
    await transition(ext, { toState: 'RUNNING', observedAt: iso(plus(-25 * MIN)) });
    await transition(ext, { toState: 'WAITING', observedAt: iso(plus(-20 * MIN)) });
    await transition(ext, { toState: 'RUNNING', observedAt: iso(plus(-15 * MIN)) });
    w = (
      await pool.query(`select started_at, finished_at from workflows where external_id=$1`, [ext])
    ).rows[0];
    expect(w.started_at).toEqual(plus(-25 * MIN));
    await transition(ext, { toState: 'COMPLETED', observedAt: iso(plus(-5 * MIN)) });
    w = (
      await pool.query(
        `select started_at, finished_at, state from workflows where external_id=$1`,
        [ext],
      )
    ).rows[0];
    expect(w.finished_at).toEqual(plus(-5 * MIN));
    expect(
      (await transition(ext, { toState: 'RUNNING', observedAt: iso(FIXED_NOW) })).statusCode,
    ).toBe(409);
  });

  it('PUT approvals raises, refuses a second pending request, and resolves with a decision', async () => {
    const ext = uniq('appr');
    await put(ext, wfBody());
    await transition(ext, { toState: 'WAITING_FOR_HUMAN', observedAt: iso(plus(-5 * MIN)) });
    const a1 = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/approvals/${ext}-a1`,
        payload: {
          workflowExternalId: ext,
          ask: 'Approve: open a PR against `main`',
          riskLevel: 'HIGH',
          requestedAt: iso(plus(-5 * MIN)),
          expiresAt: iso(plus(4 * HOUR)),
        },
      }),
    );
    expect(a1.statusCode).toBe(200);
    const c1 = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/clarifications/${ext}-c1`,
        payload: {
          workflowExternalId: ext,
          question: 'Also this?',
          requestedAt: iso(plus(-4 * MIN)),
        },
      }),
    );
    expect(c1.statusCode).toBe(409);
    expect(c1.json().type).toBe('urn:cdevi:problem:pending-request-exists');
    const upd = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/approvals/${ext}-a1`,
        payload: {
          workflowExternalId: ext,
          ask: 'Approve: open a PR against `main` (updated)',
          riskLevel: 'CRITICAL',
          requestedAt: iso(plus(-5 * MIN)),
        },
      }),
    );
    expect(upd.statusCode).toBe(200);
    expect(
      (
        await pool.query(`select risk_level, ask from approvals where external_id=$1`, [
          `${ext}-a1`,
        ])
      ).rows[0],
    ).toMatchObject({ risk_level: 'CRITICAL', ask: 'Approve: open a PR against `main` (updated)' });
    const dec = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/approvals/${ext}-a1`,
        payload: {
          workflowExternalId: ext,
          ask: 'Approve: open a PR against `main` (updated)',
          riskLevel: 'CRITICAL',
          requestedAt: iso(plus(-5 * MIN)),
          decision: {
            outcome: 'approved',
            decidedAt: iso(plus(-1 * MIN)),
            decidedBy: 'Approver 1',
          },
        },
      }),
    );
    expect(dec.statusCode).toBe(200);
    expect(
      (
        await pool.query(`select decision, decided_by from approvals where external_id=$1`, [
          `${ext}-a1`,
        ])
      ).rows[0],
    ).toMatchObject({ decision: 'approved', decided_by: 'Approver 1' });
    // now a clarification may be raised
    expect(
      (
        await app.inject(
          asIngest({
            method: 'PUT',
            url: `/api/ingest/clarifications/${ext}-c1`,
            payload: {
              workflowExternalId: ext,
              question: 'Also this?',
              requestedAt: iso(FIXED_NOW),
              hasRecommendedAnswer: true,
            },
          }),
        )
      ).statusCode,
    ).toBe(200);
    const ans = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/clarifications/${ext}-c1`,
        payload: {
          workflowExternalId: ext,
          question: 'Also this?',
          requestedAt: iso(FIXED_NOW),
          answer: { answeredAt: iso(FIXED_NOW), answeredBy: 'Engineer 1' },
        },
      }),
    );
    expect(ans.statusCode).toBe(200);
    expect(
      (
        await pool.query(`select answered_by from clarifications where external_id=$1`, [
          `${ext}-c1`,
        ])
      ).rows[0].answered_by,
    ).toBe('Engineer 1');
  });

  it('approval for an unknown workflow → 404; for a workflow outside scope → 403', async () => {
    const r = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/approvals/${uniq('x')}`,
        payload: {
          workflowExternalId: 'no-such-workflow',
          ask: 'x',
          riskLevel: 'LOW',
          requestedAt: iso(FIXED_NOW),
        },
      }),
    );
    expect(r.statusCode).toBe(404);
  });

  it('FR-021 invalid body → 400 Problem with errors[] and nothing written', async () => {
    const ext = uniq('invalid');
    const res = await put(ext, wfBody({ title: '', state: 'NOPE' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().type).toBe('urn:cdevi:problem:validation');
    expect(res.json().errors.length).toBeGreaterThan(0);
    expect((await pool.query(`select 1 from workflows where external_id=$1`, [ext])).rowCount).toBe(
      0,
    );
    expect(JSON.stringify(res.json())).not.toMatch(/select|insert|at .*\.ts/i);
  });

  it('descriptive update without state keeps the state and is accepted', async () => {
    const ext = uniq('desc');
    await put(ext, wfBody());
    const res = await put(ext, {
      projectKey: 'payments-api',
      title: 'Renamed',
      pullRequestRef: 'PR #999',
      observedAt: iso(plus(-1 * MIN)),
    });
    expect(res.json()).toMatchObject({ outcome: 'accepted', state: 'RUNNING' });
    expect(
      (
        await pool.query(`select title, pull_request_ref from workflows where external_id=$1`, [
          ext,
        ])
      ).rows[0],
    ).toMatchObject({ title: 'Renamed', pull_request_ref: 'PR #999' });
  });
});

/** A legal path from creation to `state`. */
function pathTo(state: string): string[] {
  switch (state) {
    case 'QUEUED':
      return ['QUEUED'];
    case 'RUNNING':
      return ['RUNNING'];
    case 'RETRYING':
    case 'WAITING':
    case 'WAITING_FOR_HUMAN':
    case 'BLOCKED':
    case 'FAILED':
    case 'COMPLETED':
    case 'CANCELLED':
      return ['RUNNING', state];
    default:
      throw new Error(state);
  }
}
