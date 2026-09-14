// Identified live-dependency suite (Constitution II): every test here talks to PostgreSQL.
// The database is migrated and re-seeded (S-500 at a fixed base time) once per run so tests are deterministic.
import { migrate } from '@cdevi/db';
import { seed } from '@cdevi/db/seed';

export const FIXED_NOW = new Date('2026-09-14T09:00:00Z');
export const SEED_PASSWORD = 'cdevi-demo-test-password';
export const SEED_INGEST_TOKEN = 'cdvi_test_ingest_token_0000000000000000';

if (!process.env['DATABASE_URL']) {
  if (process.env['CI']) throw new Error('DATABASE_URL must be set in CI for the api test project');
  console.warn('[api tests] DATABASE_URL unset — skipping (set it or run `docker compose up -d`)');
  process.env['CDEVI_SKIP_DB_TESTS'] = '1';
} else {
  process.env['CDEVI_ENV'] = 'test';
  process.env['SESSION_SECRET'] ??= 'test-session-secret-0000000000000000';
  await migrate({ log: () => {} });
  await seed({
    base: FIXED_NOW,
    password: SEED_PASSWORD,
    ingestToken: SEED_INGEST_TOKEN,
    log: () => {},
  });
}
