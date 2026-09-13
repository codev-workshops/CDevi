import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ENTRY_NAMES } from './entries';

const THEMES = ['light', 'dark'] as const;

for (const theme of THEMES) {
  test.describe(`gallery · ${theme}`, () => {
    for (const name of ENTRY_NAMES) {
      test(`${name}`, async ({ page }) => {
        await page.goto(`/gallery/?entry=${name}&theme=${theme}`);
        const section = page.locator(`[data-entry="${name}"]`);
        await expect(section).toBeVisible();
        await page.evaluate(() => document.fonts.ready);

        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .include(`[data-entry="${name}"]`)
          .analyze();
        expect(
          axe.violations,
          axe.violations
            .map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.html).join('\n  ')}`)
            .join('\n'),
        ).toEqual([]);

        await expect(section.locator('.g-stage')).toHaveScreenshot(`${name}-${theme}.png`);
      });
    }
  });
}
