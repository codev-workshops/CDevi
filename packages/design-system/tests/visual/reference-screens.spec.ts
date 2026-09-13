import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { REFERENCE_SCREENS } from './entries';

test.use({ viewport: { width: 1280, height: 900 } });

for (const theme of ['light', 'dark'] as const) {
  test.describe(`reference screens · ${theme}`, () => {
    for (const name of REFERENCE_SCREENS) {
      test(name, async ({ page }) => {
        await page.goto(`/reference-screens/${name}.html`);
        await page.evaluate((t) => {
          document.documentElement.dataset['theme'] = t;
          return document.fonts.ready;
        }, theme);

        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          axe.violations,
          axe.violations
            .map((v) => `${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.html).join('\n  ')}`)
            .join('\n'),
        ).toEqual([]);

        await expect(page).toHaveScreenshot(`${name}-${theme}.png`, { fullPage: true });
      });
    }
  });
}
