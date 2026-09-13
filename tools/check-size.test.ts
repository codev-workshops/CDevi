import { describe, expect, it } from 'vitest';
import { DEFAULT_BUDGETS, check, measure } from './check-size.mjs';

describe('check:size (Principle IV budgets)', () => {
  it('current stylesheet and fonts are within the declared budgets', () => {
    const r = check(DEFAULT_BUDGETS);
    expect(r.failures, r.failures.join('; ')).toEqual([]);
    expect(r.css).toBeGreaterThan(1000);
    expect(r.fontFiles).toBe(8);
  });

  it('fails with byte counts when the budget is exceeded', () => {
    const r = check({ css: 1, fonts: 1 });
    expect(r.failures).toHaveLength(2);
    expect(r.failures[0]).toMatch(/css\/cdevi\.css is \d+ B, budget 1 B/);
  });

  it('total first-load transfer stays under 250 KB (SC-008)', () => {
    const m = measure();
    expect(m.css + m.fonts).toBeLessThan(250 * 1024);
  });
});
