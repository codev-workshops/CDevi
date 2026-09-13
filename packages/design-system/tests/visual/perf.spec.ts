import { expect, test } from '@playwright/test';

// SC-008 / Principle IV budget: the built gallery's Largest Contentful Paint ≤ 2000 ms (Chromium, no throttling).
test('gallery LCP is within the 2 s budget', async ({ page }) => {
  await page.goto('/gallery/');
  const lcp = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = 0;
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) last = e.startTime;
        });
        po.observe({ type: 'largest-contentful-paint', buffered: true });
        // LCP is finalised on first interaction/hide; sample after load settles.
        setTimeout(() => {
          po.disconnect();
          resolve(last);
        }, 1500);
      }),
  );
  const nav = await page.evaluate(() => {
    const [n] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return n ? { domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null;
  });
  test.info().annotations.push({ type: 'lcp-ms', description: String(Math.round(lcp)) });
  test.info().annotations.push({ type: 'navigation', description: JSON.stringify(nav) });
  expect(
    lcp,
    `LCP ${Math.round(lcp)} ms exceeds the 2000 ms budget (specs/002 plan.md, Principle IV)`,
  ).toBeLessThanOrEqual(2000);
});
