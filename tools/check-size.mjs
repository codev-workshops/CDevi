#!/usr/bin/env node
// CHK-SIZE: Principle IV byte budgets for the design-system stylesheet and self-hosted fonts.
// Usage: node tools/check-size.mjs [--css-budget N] [--font-budget N]
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PKG = join(ROOT, 'packages/design-system');
const require = createRequire(join(PKG, 'package.json'));

export const DEFAULT_BUDGETS = { css: 40_960, fonts: 204_800 };

/** Resolves every woff2 file referenced (transitively) by css/fonts.css and sums their sizes. */
export function measure() {
  const cssFile = join(PKG, 'css/cdevi.css');
  const css = statSync(cssFile).size;
  const fontsCss = readFileSync(join(PKG, 'css/fonts.css'), 'utf8');
  const imports = [...fontsCss.matchAll(/@import\s+["']([^"']+)["']/g)].map((m) => m[1]);
  let fonts = 0;
  const files = [];
  for (const spec of imports) {
    const file = require.resolve(spec);
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(/url\(([^)]+\.woff2)\)/g)) {
      const woff2 = resolve(file, '..', m[1].replace(/^["']|["']$/g, ''));
      if (!files.includes(woff2)) {
        files.push(woff2);
        fonts += statSync(woff2).size;
      }
    }
  }
  return { css, fonts, fontFiles: files.length };
}

export function check(budgets = DEFAULT_BUDGETS) {
  const m = measure();
  const failures = [];
  if (m.css > budgets.css) failures.push(`css/cdevi.css is ${m.css} B, budget ${budgets.css} B`);
  if (m.fonts > budgets.fonts)
    failures.push(`fonts (${m.fontFiles} woff2) are ${m.fonts} B, budget ${budgets.fonts} B`);
  return { ...m, failures };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? Number(args[i + 1]) : undefined;
  };
  const budgets = {
    css: arg('--css-budget') ?? DEFAULT_BUDGETS.css,
    fonts: arg('--font-budget') ?? DEFAULT_BUDGETS.fonts,
  };
  const r = check(budgets);
  console.log(`css/cdevi.css  ${r.css} B  (budget ${budgets.css} B)`);
  console.log(`fonts (${r.fontFiles} woff2)  ${r.fonts} B  (budget ${budgets.fonts} B)`);
  if (r.failures.length) {
    console.error(
      '\ncheck:size ✗ ' +
        r.failures.join('; ') +
        '\n    Principle IV budget — see specs/002-adopt-design-system/plan.md',
    );
    process.exit(1);
  }
  console.log('check:size ✓ within budget');
}
