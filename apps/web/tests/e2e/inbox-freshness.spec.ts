import { expect, test } from '@playwright/test';
import { ingestNeedsYou, signIn } from './helpers';

test.describe('Freshness over SSE (FR-019, SC-007)', () => {
  test('an ingested request appears in Needs you within 5 s (p95 over 5 iterations) and counts move together', async ({
    page,
    request,
  }) => {
    await signIn(page, 'admin@cdevi.demo');
    const needsYou = page.getByRole('tab', { name: /Needs you/ });
    const count = async () => Number((await needsYou.textContent())!.replace(/\D/g, ''));
    const latencies: number[] = [];
    for (let i = 0; i < 5; i++) {
      const before = await count();
      const title = `Live ingestion ${i} ${Date.now()}`;
      const t0 = Date.now();
      await ingestNeedsYou(request, title);
      await expect(page.getByRole('link', { name: title })).toBeVisible({ timeout: 5_000 });
      latencies.push(Date.now() - t0);
      await expect.poll(count).toBe(before + 1);
      const navCount = await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: /^Inbox/ })
        .locator('.cd-count')
        .textContent();
      expect(Number(navCount)).toBe(before + 1);
      await expect(
        page.getByLabel('Today').getByRole('link', { name: String(before + 1) }),
      ).toBeVisible();
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]!;
    console.log(`SSE freshness latencies ms: ${latencies.join(', ')} (p95 ${p95})`);
    expect(p95).toBeLessThanOrEqual(5_000);
  });

  test('the stream flows through the Next rewrite: first event under 1 s after an ingestion', async ({
    page,
    request,
  }) => {
    await signIn(page, 'admin@cdevi.demo');
    const firstEvent = page.evaluate(
      () =>
        new Promise<number>((resolve, reject) => {
          const es = new EventSource('/api/inbox/stream');
          const started = performance.now();
          es.addEventListener('inbox.changed', () => {
            es.close();
            resolve(performance.now() - started);
          });
          es.addEventListener('error', () => reject(new Error('stream error')));
          setTimeout(() => reject(new Error('no event within 5 s')), 5_000);
        }),
    );
    await page.waitForTimeout(200);
    await ingestNeedsYou(request, `Rewrite check ${Date.now()}`);
    const ms = await firstEvent;
    expect(ms).toBeLessThan(1_000 + 200);
  });
});
