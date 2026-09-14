import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

// Visual baseline of the Inbox (T044). Named 00- so it runs before specs that ingest rows. Deterministic: S-500 at a fixed base time, API clock pinned, fonts self-hosted.
test.describe('Inbox visual baseline', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`needs you · ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await signIn(page, 'admin@cdevi.demo');
      await expect(page.getByRole('list', { name: 'Needs you' }).getByRole('listitem')).toHaveCount(
        50,
      );
      await expect(page).toHaveScreenshot(`inbox-needs-you-${theme}.png`, {
        fullPage: false,
        maxDiffPixelRatio: 0.002,
      });
    });
  }
});
