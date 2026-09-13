import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, resolveColor } from '../../scripts/color.mjs';
import { pkgPath } from './helpers';

interface Pair {
  fg: string;
  bg: string;
  where: string;
  large?: boolean;
}

const tokens = JSON.parse(readFileSync(pkgPath('tokens/tokens.json'), 'utf8'));
const pairs = JSON.parse(readFileSync(pkgPath('tokens/pairs.json'), 'utf8')) as Pair[];

describe('WCAG 2.2 AA contrast for every token pair in tokens/pairs.json (FR-003)', () => {
  it('lists at least the pairs the components use', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(20);
    for (const p of pairs) {
      expect(p.where, 'every pair needs a `where`').toBeTruthy();
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    describe(theme, () => {
      for (const p of pairs) {
        const threshold = p.large ? 3 : 4.5;
        it(`${p.fg} on ${p.bg} (${p.where}) ≥ ${threshold}:1`, () => {
          const fg = resolveColor(tokens, p.fg, theme);
          const bg = resolveColor(tokens, p.bg, theme);
          const ratio = contrastRatio(fg, bg);
          expect(
            ratio,
            `${p.fg} (${fg}) on ${p.bg} (${bg}) in ${theme} is ${ratio.toFixed(2)}:1, below ${threshold}:1 — DR-06: adjust the token value in tokens.json, not the component`,
          ).toBeGreaterThanOrEqual(threshold);
        });
      }
    });
  }
});

describe('contrastRatio', () => {
  it('matches known values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
  });
});
