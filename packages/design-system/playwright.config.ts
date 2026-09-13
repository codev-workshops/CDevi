import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
// CI installs Playwright's Chromium. Locally, fall back to installed Google Chrome when the download is unavailable.
const cache =
  process.platform === 'darwin'
    ? join(homedir(), 'Library/Caches/ms-playwright')
    : join(homedir(), '.cache/ms-playwright');
const hasChromium =
  existsSync(cache) &&
  readdirSync(cache).some((d) => d.startsWith('chromium-')) &&
  process.env['PW_CHANNEL'] !== 'chrome';
const browser = hasChromium ? {} : { channel: 'chrome' as const };

export default defineConfig({
  testDir: './tests/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.001, animations: 'disabled' },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    colorScheme: 'light',
  },
  webServer: {
    command: 'pnpm gallery:build && pnpm gallery:preview',
    url: `http://127.0.0.1:${PORT}/gallery/`,
    reuseExistingServer: !process.env['CI'],
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...browser } }],
});
