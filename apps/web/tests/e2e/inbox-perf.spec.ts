import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe('Performance budgets (SC-003, Constitution IV)', () => {
  test('LCP p95 ≤ 2 s over 20 cold loads of /inbox with S-500', async ({ page }) => {
    test.setTimeout(180_000);
    await signIn(page, 'admin@cdevi.demo');
    const lcps: number[] = [];
    for (let i = 0; i < 20; i++) {
      await page.goto('about:blank');
      await page.goto('/inbox', { waitUntil: 'load' });
      const lcp = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            let value = 0;
            const po = new PerformanceObserver((list) => {
              for (const e of list.getEntries()) value = e.startTime;
            });
            po.observe({ type: 'largest-contentful-paint', buffered: true });
            setTimeout(() => {
              po.disconnect();
              resolve(value || performance.getEntriesByType('navigation')[0]!.duration);
            }, 300);
          }),
      );
      lcps.push(lcp);
    }
    lcps.sort((a, b) => a - b);
    const p95 = lcps[Math.ceil(lcps.length * 0.95) - 1]!;
    console.log(`/inbox LCP ms: median ${lcps[10]}, p95 ${p95}`);
    expect(p95).toBeLessThanOrEqual(2_000);
  });

  test('a refresh re-render of 50 rows stays responsive', async ({ page }) => {
    await signIn(page, 'admin@cdevi.demo');
    await page.getByRole('tab', { name: /Done/ }).click();
    await expect(page.getByRole('list', { name: 'Done' }).getByRole('listitem')).toHaveCount(50);
    const t0 = Date.now();
    await page.getByRole('tab', { name: /Running/ }).click();
    await expect(page.getByRole('list', { name: 'Running' }).getByRole('listitem')).toHaveCount(50);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});
