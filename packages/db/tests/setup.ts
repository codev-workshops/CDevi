// Identified live-dependency suite (Constitution II): needs PostgreSQL. Locally without DATABASE_URL the
// suite is skipped with a message; in CI a missing DATABASE_URL is a configuration error and fails.
if (!process.env['DATABASE_URL']) {
  if (process.env['CI']) throw new Error('DATABASE_URL must be set in CI for the db test project');
  console.warn('[db tests] DATABASE_URL unset — skipping (set it or run `docker compose up -d`)');
  process.env['CDEVI_SKIP_DB_TESTS'] = '1';
}
