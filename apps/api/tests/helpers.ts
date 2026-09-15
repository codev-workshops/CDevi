import { hashPassword } from '@cdevi/db';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuildOptions } from '../src/app';
import { FIXED_NOW, SEED_INGEST_TOKEN, SEED_PASSWORD } from './setup';

export { FIXED_NOW, SEED_INGEST_TOKEN, SEED_PASSWORD };
export const skipDb = Boolean(process.env['CDEVI_SKIP_DB_TESTS']);

export async function testApp(opts: Partial<BuildOptions> = {}): Promise<FastifyInstance> {
  const app = await buildApp({ now: () => FIXED_NOW, logger: false, ...opts });
  await app.ready();
  return app;
}

export function cookieOf(res: LightMyRequestResponse): string {
  const set = res.headers['set-cookie'];
  const first = Array.isArray(set) ? set[0] : set;
  if (!first) throw new Error('no Set-Cookie header');
  return first.split(';')[0]!;
}

export async function signIn(
  app: FastifyInstance,
  email: string,
  password = SEED_PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in',
    payload: { email, password },
    headers: { origin: 'http://localhost:3000' },
  });
  if (res.statusCode !== 204) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  return cookieOf(res);
}

export const asUser = (cookie: string, opts: InjectOptions): InjectOptions => ({
  ...opts,
  headers: { ...(opts.headers ?? {}), cookie, origin: 'http://localhost:3000' },
});

export const asIngest = (opts: InjectOptions, token = SEED_INGEST_TOKEN): InjectOptions => ({
  ...opts,
  headers: {
    ...(opts.headers ?? {}),
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
});

export const iso = (d: Date) => d.toISOString();
export const plus = (ms: number, from = FIXED_NOW) => new Date(from.getTime() + ms);
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
let n = 0;
export const uniq = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(n++).toString(36)}`;

export interface Sc007Org {
  organizationId: string;
  projectIds: string[];
  email: string;
  password: string;
}

/**
 * SC-007 workload in a fresh organization: 500 workflows (50 of them active), 5 000 agent runs, 5 000 test runs
 * and 50 000 audit events spread over the 60 days before FIXED_NOW, inserted with `generate_series` so the
 * fixture costs a handful of statements. Returns an administrator who sees all four projects.
 */
export async function seedSc007Org(app: FastifyInstance, base = FIXED_NOW): Promise<Sc007Org> {
  const email = `${uniq('sc7-admin')}@cdevi.test`;
  const password = 'sc7-fixture-password';
  const client = await app.pool.connect();
  let organizationId = '';
  let projectIds: string[] = [];
  try {
    await client.query('BEGIN');
    organizationId = (
      await client.query<{ id: string }>(
        `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
        [uniq('SC-007')],
      )
    ).rows[0]!.id;
    projectIds = (
      await client.query<{ id: string }>(
        `INSERT INTO projects (organization_id, key, name)
         SELECT $1, 'sc7-' || g, 'SC7 ' || g FROM generate_series(1, 4) g RETURNING id`,
        [organizationId],
      )
    ).rows.map((r) => r.id);
    await client.query(
      `INSERT INTO users (organization_id, email, display_name, password_hash, role) VALUES ($1, $2, 'SC7 Admin', $3, 'administrator')`,
      [organizationId, email, await hashPassword(password)],
    );
    await client.query(
      `INSERT INTO workflows (organization_id, project_id, external_id, title, agent, state, state_observed_at, stage_index, stage_count, stage_name, pull_request_ref, started_at, finished_at)
       SELECT $1, ($2::uuid[])[(g % 4) + 1], 'sc7-w' || g, 'Workflow ' || g, 'Implementation Agent',
              CASE WHEN g % 10 = 0 THEN 'RUNNING' ELSE 'COMPLETED' END::workflow_state,
              $3::timestamptz - (g % 60) * interval '1 day',
              (g % 7) + 1, 7, 'Implementation',
              CASE WHEN g % 10 = 0 THEN NULL ELSE 'PR #' || g END,
              $3::timestamptz - (g % 60) * interval '1 day' - interval '2 hours',
              CASE WHEN g % 10 = 0 THEN NULL ELSE $3::timestamptz - (g % 60) * interval '1 day' END
         FROM generate_series(1, 500) g`,
      [organizationId, projectIds, base],
    );
    await client.query(
      `INSERT INTO workflow_stages (organization_id, project_id, workflow_id, position, name, state, state_observed_at)
       SELECT organization_id, project_id, id, 1, 'Implementation', 'COMPLETED', state_observed_at
         FROM workflows WHERE organization_id = $1`,
      [organizationId],
    );
    await client.query(
      `WITH s AS (SELECT id, project_id, workflow_id, row_number() OVER (ORDER BY id) rn FROM workflow_stages WHERE organization_id = $1)
       INSERT INTO agent_runs (organization_id, project_id, workflow_id, stage_id, external_id, agent, state, started_at, finished_at)
       SELECT $1, s.project_id, s.workflow_id, s.id, 'sc7-r' || g, 'Implementation Agent',
              CASE WHEN g % 10 = 0 THEN 'FAILED' ELSE 'COMPLETED' END::workflow_state,
              $2::timestamptz - (g % 60) * interval '1 day' - interval '1 hour',
              $2::timestamptz - (g % 60) * interval '1 day'
         FROM generate_series(1, 5000) g JOIN s ON s.rn = (g % 500) + 1`,
      [organizationId, base],
    );
    await client.query(
      `WITH s AS (SELECT id, project_id, workflow_id, row_number() OVER (ORDER BY id) rn FROM workflow_stages WHERE organization_id = $1)
       INSERT INTO test_runs (organization_id, project_id, workflow_id, stage_id, external_id, category, status, total, passed, failed, started_at, finished_at)
       SELECT $1, s.project_id, s.workflow_id, s.id, 'sc7-t' || g, 'unit', 'PASSED', 100, 97, 3,
              $2::timestamptz - (g % 60) * interval '1 day' - interval '1 hour',
              $2::timestamptz - (g % 60) * interval '1 day'
         FROM generate_series(1, 5000) g JOIN s ON s.rn = (g % 500) + 1`,
      [organizationId, base],
    );
    await client.query(
      `INSERT INTO audit_events (organization_id, project_id, actor_type, actor_name, action, target_type, target_id, risk_level, result, occurred_at)
       SELECT $1, ($2::uuid[])[(g % 4) + 1], 'user', 'Tess Approver', 'approval.approved', 'approval', gen_random_uuid(),
              (ARRAY['LOW','MEDIUM','HIGH','CRITICAL']::risk_level[])[(g % 4) + 1], 'RUNNING',
              $3::timestamptz - (g % 60) * interval '1 day'
         FROM generate_series(1, 50000) g`,
      [organizationId, projectIds, base],
    );
    await client.query('COMMIT');
    await client.query('ANALYZE workflows, workflow_stages, agent_runs, test_runs, audit_events');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { organizationId, projectIds, email, password };
}
