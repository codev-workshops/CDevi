import { defineConfig } from 'vitest/config';

// Root runner. Projects that need PostgreSQL (`db`, `api`) read DATABASE_URL; locally they skip with a
// message when it is unset, in CI (`CI=true`) they fail instead so a misconfigured job cannot pass silently.
export default defineConfig({
  test: {
    projects: [
      'packages/design-system/vitest.config.ts',
      {
        test: {
          name: 'tools',
          environment: 'node',
          include: ['tools/**/*.test.ts'],
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'contracts',
          environment: 'node',
          include: ['packages/contracts/tests/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'db',
          environment: 'node',
          include: ['packages/db/tests/**/*.test.ts'],
          setupFiles: ['packages/db/tests/setup.ts'],
          testTimeout: 60_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'api',
          environment: 'node',
          include: ['apps/api/tests/**/*.test.ts'],
          setupFiles: ['apps/api/tests/setup.ts'],
          testTimeout: 60_000,
          fileParallelism: false,
        },
      },
      'apps/web/vitest.config.ts',
    ],
  },
});
