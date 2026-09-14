import { defineConfig } from 'drizzle-kit';

// Used only for `drizzle-kit generate` drafts; migrations/*.sql are hand-reviewed and are the source of truth.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './migrations/drafts',
  dbCredentials: {
    url:
      process.env['DATABASE_MIGRATOR_URL'] ?? 'postgres://migrator:migrator@localhost:5432/cdevi',
  },
});
