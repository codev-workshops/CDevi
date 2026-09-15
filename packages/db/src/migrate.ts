import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const MIGRATIONS_DIR = resolve(import.meta.dirname, '../migrations');
const RLS_TABLES = [
  'organizations',
  'projects',
  'users',
  'project_memberships',
  'sessions',
  'ingestion_principals',
  'workflows',
  'workflow_transitions',
  'approvals',
  'clarifications',
  'ingestion_log',
  'inbox_change_log',
  'workflow_stages',
  'agent_runs',
  'artifacts',
  'test_runs',
  'audit_events',
  'integration_project_mappings',
  'requirements',
  'requirement_analysis_items',
  'requirement_transitions',
  'agent_decisions',
];

export interface MigrateOptions {
  connectionString?: string | undefined;
  rls?: boolean | undefined;
  log?: ((msg: string) => void) | undefined;
}

/** Applies unapplied `migrations/*.sql` files in order, each in one transaction, as the migrator role. */
export async function migrate(opts: MigrateOptions = {}): Promise<string[]> {
  const connectionString = opts.connectionString ?? process.env['DATABASE_MIGRATOR_URL'];
  if (!connectionString) throw new Error('DATABASE_MIGRATOR_URL is not set');
  const rls = opts.rls ?? process.env['CDEVI_RLS'] === 'on';
  const log = opts.log ?? ((m: string) => console.log(m));
  const client = new pg.Client({ connectionString });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    await client.query('SELECT pg_advisory_lock(727301)');
    const done = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
        (r) => r.name,
      ),
    );
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
        log(`applied ${file}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    for (const t of RLS_TABLES) {
      await client.query(`ALTER TABLE ${t} ${rls ? 'ENABLE' : 'DISABLE'} ROW LEVEL SECURITY`);
    }
    log(`row-level security ${rls ? 'enabled' : 'disabled'} (CDEVI_RLS=${rls ? 'on' : 'off'})`);
    await client.query('SELECT pg_advisory_unlock(727301)');
  } finally {
    await client.end();
  }
  return applied;
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  migrate().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
