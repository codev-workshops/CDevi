import { defineConfig } from 'vitest/config';

// Root runner: the design-system package project plus repository tooling tests under tools/.
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
    ],
  },
});
