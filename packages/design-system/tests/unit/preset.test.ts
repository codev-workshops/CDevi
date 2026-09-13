import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pkgPath } from './helpers';

const require = createRequire(import.meta.url);

interface Preset {
  theme: Record<string, unknown> & { colors: Record<string, unknown>; extend?: unknown };
}

describe('tailwind/preset.cjs replaces default scales with tokens (FR-009)', () => {
  const preset = require(pkgPath('tailwind/preset.cjs')) as Preset;
  const tokens = JSON.parse(readFileSync(pkgPath('tokens/tokens.json'), 'utf8')) as {
    color: Record<string, unknown>;
  };

  it('uses theme (not extend) so Tailwind defaults such as blue/gray do not exist', () => {
    expect(preset.theme.extend).toBeUndefined();
    for (const key of ['colors', 'fontFamily', 'borderRadius', 'fontSize', 'spacing']) {
      expect(preset.theme[key], `theme.${key} missing`).toBeTypeOf('object');
    }
    expect(preset.theme.colors).not.toHaveProperty('blue');
    expect(preset.theme.colors).not.toHaveProperty('gray');
  });

  it('every colour key comes from tokens.json and every value is a CSS variable reference', () => {
    const tokenNames = new Set(Object.keys(tokens.color));
    const walk = (obj: Record<string, unknown>, path: string[] = []) => {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
          if (['transparent', 'current', 'inherit'].includes(k)) continue;
          expect(v, `${[...path, k].join('.')}`).toMatch(/^var\(--[a-z0-9-]+\)$/);
        } else {
          walk(v as Record<string, unknown>, [...path, k]);
        }
      }
    };
    walk(preset.theme.colors);
    const flat = (obj: Record<string, unknown>, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'string'
          ? [k === 'DEFAULT' ? prefix : prefix ? `${prefix}-${k}` : k]
          : flat(v as Record<string, unknown>, prefix ? `${prefix}-${k}` : k),
      );
    for (const name of flat(preset.theme.colors)) {
      if (['transparent', 'current', 'inherit'].includes(name)) continue;
      expect(tokenNames.has(name), `preset colour ${name} is not a token`).toBe(true);
    }
  });
});
