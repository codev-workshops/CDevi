import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asIngest, iso, MIN, plus, skipDb, testApp, uniq } from './helpers';

describe.skipIf(skipDb)('US1 ingestion: stages, agent runs, artifacts, test runs (FR-002)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await testApp();
  });
  afterAll(() => app.close());

  const newWorkflow = async () => {
    const ext = uniq('ing');
    const r = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/workflows/${ext}`,
        payload: {
          projectKey: 'payments-api',
          title: 'Ingest test',
          state: 'RUNNING',
          observedAt: iso(plus(-30 * MIN)),
        },
      }),
    );
    expect(r.statusCode, r.body).toBe(200);
    return { ext, id: r.json().id as string };
  };
  const putStage = (ext: string, position: number, payload: Record<string, unknown>) =>
    app.inject(
      asIngest({ method: 'PUT', url: `/api/ingest/workflows/${ext}/stages/${position}`, payload }),
    );

  it('FR-002 creates a stage, records a transition, syncs workflows.stage_index and rejects illegal moves', async () => {
    const { ext, id } = await newWorkflow();
    const created = await putStage(ext, 1, {
      name: 'Specify',
      state: 'RUNNING',
      observedAt: iso(plus(-29 * MIN)),
      agent: 'spec-agent',
      count: 7,
    });
    expect(created.statusCode, created.body).toBe(200);
    expect(created.json().outcome).toBe('accepted');
    const w = await app.pool.query(
      `SELECT stage_index, stage_count, stage_name FROM workflows WHERE id = $1`,
      [id],
    );
    expect(w.rows[0]).toEqual({ stage_index: 1, stage_count: 7, stage_name: 'Specify' });
    const t = await app.pool.query(
      `SELECT from_state, to_state, stage_id FROM workflow_transitions WHERE workflow_id = $1 AND stage_id IS NOT NULL`,
      [id],
    );
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ from_state: null, to_state: 'RUNNING' });

    const stale = await putStage(ext, 1, {
      name: 'Specify',
      state: 'COMPLETED',
      observedAt: iso(plus(-29 * MIN)),
    });
    expect(stale.statusCode).toBe(200);
    expect(stale.json().outcome).toBe('stale');

    const illegal = await putStage(ext, 1, {
      name: 'Specify',
      state: 'QUEUED',
      observedAt: iso(plus(-28 * MIN)),
    });
    expect(illegal.statusCode).toBe(409);
    expect(illegal.json().type).toMatch(/invalid-transition/);

    const done = await putStage(ext, 1, {
      name: 'Specify',
      state: 'COMPLETED',
      observedAt: iso(plus(-27 * MIN)),
    });
    expect(done.statusCode).toBe(200);
    const s = await app.pool.query(
      `SELECT state, started_at, finished_at FROM workflow_stages WHERE workflow_id = $1 AND position = 1`,
      [id],
    );
    expect(s.rows[0].state).toBe('COMPLETED');
    expect(s.rows[0].started_at).toEqual(plus(-29 * MIN));
    expect(s.rows[0].finished_at).toEqual(plus(-27 * MIN));
  });

  it('FR-002 agent runs, artifacts and test runs attach to an existing stage; unknown stage is a 404 Problem', async () => {
    const { ext, id } = await newWorkflow();
    await putStage(ext, 1, { name: 'Plan', state: 'RUNNING', observedAt: iso(plus(-29 * MIN)) });
    const run = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/agent-runs/${uniq('run')}`,
        payload: {
          workflowExternalId: ext,
          stagePosition: 1,
          agent: 'planner',
          model: 'fable-5.1',
          state: 'RUNNING',
          startedAt: iso(plus(-28 * MIN)),
          timeline: [{ at: iso(plus(-28 * MIN)), kind: 'note', message: 'Reading the ticket' }],
        },
      }),
    );
    expect(run.statusCode, run.body).toBe(200);
    const art = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/artifacts/${uniq('art')}`,
        payload: {
          workflowExternalId: ext,
          stagePosition: 1,
          type: 'implementation_plan',
          title: 'Plan v1',
          producedAt: iso(plus(-27 * MIN)),
        },
      }),
    );
    expect(art.statusCode, art.body).toBe(200);
    const tr = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/test-runs/${uniq('tr')}`,
        payload: {
          workflowExternalId: ext,
          stagePosition: 1,
          category: 'unit',
          status: 'PASSED',
          total: 10,
          passed: 10,
          startedAt: iso(plus(-26 * MIN)),
          finishedAt: iso(plus(-25 * MIN)),
        },
      }),
    );
    expect(tr.statusCode, tr.body).toBe(200);
    const counts = await app.pool.query(
      `SELECT (SELECT count(*) FROM agent_runs WHERE workflow_id = $1)::int AS runs,
              (SELECT count(*) FROM artifacts WHERE workflow_id = $1)::int AS artifacts,
              (SELECT count(*) FROM test_runs WHERE workflow_id = $1)::int AS tests`,
      [id],
    );
    expect(counts.rows[0]).toEqual({ runs: 1, artifacts: 1, tests: 1 });

    const missing = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/agent-runs/${uniq('run')}`,
        payload: {
          workflowExternalId: ext,
          stagePosition: 9,
          agent: 'planner',
          state: 'RUNNING',
          startedAt: iso(plus(-20 * MIN)),
        },
      }),
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.json().type).toMatch(/unknown-stage/);
  });

  it('FR-002 artifacts become immutable once the producing stage completes (409)', async () => {
    const { ext } = await newWorkflow();
    await putStage(ext, 1, { name: 'Plan', state: 'RUNNING', observedAt: iso(plus(-29 * MIN)) });
    const artExt = uniq('art');
    const payload = {
      workflowExternalId: ext,
      stagePosition: 1,
      type: 'requirement_spec',
      title: 'Spec',
      producedAt: iso(plus(-28 * MIN)),
    };
    expect(
      (
        await app.inject(
          asIngest({ method: 'PUT', url: `/api/ingest/artifacts/${artExt}`, payload }),
        )
      ).statusCode,
    ).toBe(200);
    await putStage(ext, 1, { name: 'Plan', state: 'COMPLETED', observedAt: iso(plus(-27 * MIN)) });
    const again = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/artifacts/${artExt}`,
        payload: { ...payload, title: 'Spec (edited)' },
      }),
    );
    expect(again.statusCode).toBe(409);
    expect(again.json().type).toMatch(/artifact-immutable/);
  });

  it('rejects a token that is not scoped to the workflow project and validates bodies (400)', async () => {
    const { ext } = await newWorkflow();
    const bad = await putStage(ext, 1, { name: 'x', state: 'NOPE', observedAt: 'yesterday' });
    expect(bad.statusCode).toBe(400);
    const badTr = await app.inject(
      asIngest({
        method: 'PUT',
        url: `/api/ingest/test-runs/${uniq('tr')}`,
        payload: {
          workflowExternalId: ext,
          stagePosition: 1,
          category: 'unit',
          status: 'PASSED',
          total: 1,
          passed: 2,
          startedAt: iso(plus(-1 * MIN)),
        },
      }),
    );
    expect(badTr.statusCode).toBe(400);
  });
});
