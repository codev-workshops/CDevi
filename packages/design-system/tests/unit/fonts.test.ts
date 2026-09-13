import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pkgPath } from './helpers';

describe('self-hosted fonts (FR-005)', () => {
  it('ships css/fonts.css importing only @fontsource files for the approved weights', () => {
    const file = pkgPath('css/fonts.css');
    expect(existsSync(file), 'css/fonts.css missing').toBe(true);
    const css = readFileSync(file, 'utf8');
    const imports = [...css.matchAll(/@import\s+["']([^"']+)["']/g)].map((m) => m[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec).toMatch(/^@fontsource\//);
    const expected = [
      '@fontsource/instrument-sans/latin-400.css',
      '@fontsource/instrument-sans/latin-500.css',
      '@fontsource/instrument-sans/latin-600.css',
      '@fontsource/instrument-sans/latin-700.css',
      '@fontsource/instrument-sans/latin-400-italic.css',
      '@fontsource/jetbrains-mono/latin-400.css',
      '@fontsource/jetbrains-mono/latin-500.css',
      '@fontsource/noto-sans-sinhala/sinhala-600.css',
    ];
    expect(imports.sort()).toEqual(expected.sort());
  });

  it('bundle and reference screens make no third-party font requests', () => {
    const bundle = readFileSync(pkgPath('css/cdevi.css'), 'utf8');
    expect(bundle).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    expect(bundle).toContain('@fontsource/');
    const legacy = pkgPath('legacy-gallery.html');
    if (existsSync(legacy)) {
      // legacy gallery is retired in Polish; until then it must not be the source of truth
      expect(readFileSync(pkgPath('README.md'), 'utf8')).not.toContain('legacy-gallery');
    }
  });
});
