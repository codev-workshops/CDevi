import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGETS, check, measure, measureWebRoute } from './check-size.mjs';

describe('check:size (Principle IV budgets)', () => {
  it('current stylesheet and fonts are within the declared budgets', () => {
    const r = check(DEFAULT_BUDGETS);
    expect(r.failures, r.failures.join('; ')).toEqual([]);
    expect(r.css).toBeGreaterThan(1000);
    expect(r.fontFiles).toBe(8);
  });

  it('fails with byte counts when the budget is exceeded', () => {
    const r = check({ css: 1, fonts: 1, webRouteJs: 1 });
    expect(r.failures.length).toBe(r.web ? 3 : 2);
    expect(r.failures[0]).toMatch(/css\/cdevi\.css is \d+ B, budget 1 B/);
  });

  it('Inbox route JS stays under 200 KB gzip when apps/web is built (specs/003 budget)', () => {
    const web = measureWebRoute();
    if (!web) return; // not built locally; enforced in the CI e2e job after `pnpm build`
    expect(web.files).toBeGreaterThan(0);
    expect(web.gzip).toBeLessThan(DEFAULT_BUDGETS.webRouteJs);
  });

  it('total first-load transfer stays under 250 KB (SC-008)', () => {
    const m = measure();
    expect(m.css + m.fonts).toBeLessThan(250 * 1024);
  });
});
