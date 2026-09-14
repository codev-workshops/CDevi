import { migrate } from '@cdevi/db';
import { seed } from '@cdevi/db/seed';
import { E2E } from '../../playwright.config';

export default async function globalSetup() {
  if (!process.env['DATABASE_URL'] || !process.env['DATABASE_MIGRATOR_URL']) {
    throw new Error(
      'DATABASE_URL and DATABASE_MIGRATOR_URL must be set for the e2e suite (see .env.example)',
    );
  }
  process.env['CDEVI_ENV'] = 'test';
  await migrate({ log: () => {} });
  await seed({
    base: new Date(E2E.base),
    password: E2E.password,
    ingestToken: E2E.ingestToken,
    log: () => {},
  });
}
