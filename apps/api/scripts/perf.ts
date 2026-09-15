/**
 * Performance budgets (specs/003 plan.md, Constitution IV) measured with autocannon against an in-process API over
 * the seeded database (S-500). Exit code 1 on any breach.
 *
 *   GET /api/inbox (needsYou, all projects)  30 s × 20 connections  → p95 ≤ 300 ms, p99 ≤ 600 ms
 *   PUT /api/ingest/workflows/{id}           30 s × 10 connections  → p95 ≤ 200 ms
 *
 * Env: DATABASE_URL, DATABASE_MIGRATOR_URL (to look up the seeded ingestion token), CDEVI_PERF_DURATION (s, default 30).
 */
import autocannon from 'autocannon';
import pg from 'pg';
import { hashToken } from '@cdevi/db';
import { buildApp } from '../src/app';

const DURATION = Number(process.env['CDEVI_PERF_DURATION'] ?? 30);
const BUDGETS = { inboxP95: 300, inboxP99: 600, ingestP95: 200 };

async function main() {
  const app = await buildApp({
    now: () => new Date(),
    logger: false,
    rateLimit: { signInMax: 100_000 },
  });
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  const admin = new pg.Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
  try {
    // A throwaway ingestion principal scoped to every project, removed afterwards.
    const org = (await admin.query<{ id: string }>('select id from organizations limit 1')).rows[0];
    if (!org) throw new Error('database is not seeded (run pnpm db:seed)');
    const projects = (
      await admin.query<{ id: string }>('select id from projects where organization_id=$1', [
        org.id,
      ])
    ).rows.map((r) => r.id);
    const token = `cdvi_perf_${Date.now()}`;
    const principal = (
      await admin.query<{ id: string }>(
        `insert into ingestion_principals (organization_id, name, token_hash, project_ids) values ($1,'perf',$2,$3) returning id`,
        [org.id, hashToken(token), projects],
      )
    ).rows[0]!;
    // A perf user with the administrator role so the inbox query covers every project.
    const { hashPassword } = await import('@cdevi/db');
    const email = `perf-${Date.now()}@cdevi.demo`;
    await admin.query(
      `insert into users (organization_id, email, display_name, password_hash, role) values ($1,$2,'Perf',$3,'administrator')`,
      [org.id, email, await hashPassword('perf-password-1234')],
    );
    const signIn = await fetch(`${base}/api/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'perf-password-1234' }),
    });
    const cookie = signIn.headers.get('set-cookie')?.split(';')[0];
    if (!cookie) throw new Error(`sign-in failed: ${signIn.status}`);

    const inbox = await autocannon({
      url: `${base}/api/inbox?tab=needsYou&project=all`,
      connections: 20,
      duration: DURATION,
      headers: { cookie },
    });
    let n = 0;
    const ingest = await autocannon({
      url: `${base}/api/ingest/workflows/perf-placeholder`,
      method: 'PUT',
      connections: 10,
      duration: DURATION,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      setupClient: (client) => {
        client.setBody(
          JSON.stringify({
            projectKey: 'payments-api',
            title: 'Perf workflow',
            state: 'RUNNING',
            observedAt: new Date().toISOString(),
          }),
        );
        client.on('response', () =>
          client.setBody(
            JSON.stringify({
              projectKey: 'payments-api',
              title: 'Perf workflow',
              state: 'RUNNING',
              observedAt: new Date().toISOString(),
            }),
          ),
        );
      },
      requests: [
        {
          setupRequest: (req) => ({
            ...req,
            path: `/api/ingest/workflows/perf-${process.pid}-${n++}`,
          }),
        },
      ],
    });

    const failures: string[] = [];
    const report = (name: string, r: autocannon.Result) =>
      console.log(
        `${name}: ${r.requests.average.toFixed(0)} req/s, p50 ${r.latency.p50} ms, p95 ${r.latency.p97_5 ? r.latency.p97_5 : r.latency.p99} (p97.5) / p99 ${r.latency.p99} ms, non-2xx ${r.non2xx}`,
      );
    report('GET /api/inbox', inbox);
    report('PUT /api/ingest/workflows', ingest);
    if (inbox.latency.p97_5 > BUDGETS.inboxP95)
      failures.push(`GET /api/inbox p95≈p97.5 ${inbox.latency.p97_5} ms > ${BUDGETS.inboxP95} ms`);
    if (inbox.latency.p99 > BUDGETS.inboxP99)
      failures.push(`GET /api/inbox p99 ${inbox.latency.p99} ms > ${BUDGETS.inboxP99} ms`);
    if (inbox.non2xx > 0) failures.push(`GET /api/inbox returned ${inbox.non2xx} non-2xx`);
    if (ingest.latency.p97_5 > BUDGETS.ingestP95)
      failures.push(`PUT ingest p95≈p97.5 ${ingest.latency.p97_5} ms > ${BUDGETS.ingestP95} ms`);
    if (ingest.non2xx > 0) failures.push(`PUT ingest returned ${ingest.non2xx} non-2xx`);

    // Drain requests still in flight when autocannon stopped before removing the rows they write.
    await app.close();
    await admin.query(`delete from workflows where external_id like $1`, [`perf-${process.pid}-%`]);
    await admin.query(`delete from workflow_transitions where principal_id=$1`, [principal.id]);
    await admin.query(`delete from ingestion_log where principal_id=$1`, [principal.id]);
    await admin.query(`delete from ingestion_principals where id=$1`, [principal.id]);
    await admin.query(`delete from users where email=$1`, [email]);

    if (failures.length) {
      console.error('Performance budget breached:\n  ' + failures.join('\n  '));
      process.exitCode = 1;
    } else console.log('All performance budgets met.');
  } finally {
    await admin.end();
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
