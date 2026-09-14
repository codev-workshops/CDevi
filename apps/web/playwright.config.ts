import { defineConfig, devices } from '@playwright/test';

// End-to-end suite (specs/003 research R11): fresh migrate + seed (S-500 at a fixed base time) in globalSetup, the
// API pinned to the same clock (CDEVI_FIXED_NOW) so ages, stale flags and expiries are deterministic.
export const E2E = {
  webPort: 3100,
  apiPort: 3101,
  base: '2026-09-14T09:00:00Z',
  password: 'cdevi-demo-e2e-password',
  ingestToken: 'cdvi_e2e_ingest_token_00000000000000000',
} as const;

const webOrigin = `http://localhost:${E2E.webPort}`;
const apiOrigin = `http://localhost:${E2E.apiPort}`;
const sharedEnv = {
  ...process.env,
  CDEVI_ENV: 'test',
  API_ORIGIN: apiOrigin,
  WEB_ORIGIN: webOrigin,
  API_PORT: String(E2E.apiPort),
  CDEVI_FIXED_NOW: E2E.base,
  // Sign-in rate limiting is covered by apps/api tests; the e2e suite signs in many times per minute.
  CDEVI_SIGNIN_RATE_MAX: '1000',
  SESSION_SECRET: process.env['SESSION_SECRET'] ?? 'e2e-session-secret-000000000000000000',
};

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: webOrigin,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: 'pnpm --filter @cdevi/api exec tsx src/main.ts',
      url: `${apiOrigin}/api/healthz`,
      cwd: '../..',
      env: sharedEnv,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm exec next build && pnpm exec next start --port ${E2E.webPort}`,
      url: `${webOrigin}/sign-in`,
      env: sharedEnv,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
});
