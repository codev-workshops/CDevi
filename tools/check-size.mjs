#!/usr/bin/env node
// CHK-SIZE: Principle IV byte budgets for the design-system stylesheet and self-hosted fonts.
// Usage: node tools/check-size.mjs [--css-budget N] [--font-budget N]
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PKG = join(ROOT, 'packages/design-system');
const require = createRequire(join(PKG, 'package.json'));

export const DEFAULT_BUDGETS = { css: 40_960, fonts: 204_800, webRouteJs: 204_800 };
const WEB = join(ROOT, 'apps/web');
const INBOX_ROUTE = '/(app)/inbox/page';

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

/**
 * Gzipped JavaScript shipped to the browser for the Inbox route (specs/003 budget: ≤ 200 KB). Returns null when
 * `apps/web` has not been built (`next build`), so `pnpm check` works without a build; CI's e2e job builds first.
 */
export function measureWebRoute(route = INBOX_ROUTE) {
  const buildManifest = join(WEB, '.next/build-manifest.json');
  const refManifest = join(WEB, `.next/server/app${route}_client-reference-manifest.js`);
  if (!existsSync(buildManifest) || !existsSync(refManifest)) return null;
  const files = new Set(JSON.parse(readFileSync(buildManifest, 'utf8')).rootMainFiles ?? []);
  // Turbopack writes the per-route client manifest as a script assigning globalThis.__RSC_MANIFEST[route].
  const g = {};
  runInNewContext(readFileSync(refManifest, 'utf8'), { globalThis: g, self: g });
  const m = g.__RSC_MANIFEST?.[route] ?? {};
  for (const entry of Object.values(m.entryJSFiles ?? {})) for (const f of entry) files.add(f);
  for (const mod of Object.values(m.clientModules ?? {}))
    for (const c of mod.chunks ?? []) files.add(c.replace(/^\/_next\//, ''));
  let gzip = 0;
  let count = 0;
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const file = join(WEB, '.next', f);
    if (!existsSync(file)) continue;
    gzip += gzipSync(readFileSync(file)).length;
    count++;
  }
  return { route, files: count, gzip };
}

export function check(budgets = DEFAULT_BUDGETS) {
  const m = measure();
  const failures = [];
  if (m.css > budgets.css) failures.push(`css/cdevi.css is ${m.css} B, budget ${budgets.css} B`);
  if (m.fonts > budgets.fonts)
    failures.push(`fonts (${m.fontFiles} woff2) are ${m.fonts} B, budget ${budgets.fonts} B`);
  const web = measureWebRoute();
  if (web && web.gzip > budgets.webRouteJs)
    failures.push(
      `apps/web ${web.route} ships ${web.gzip} B gzip JS (${web.files} files), budget ${budgets.webRouteJs} B`,
    );
  return { ...m, web, failures };
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
    webRouteJs: arg('--web-budget') ?? DEFAULT_BUDGETS.webRouteJs,
  };
  const r = check(budgets);
  console.log(`css/cdevi.css  ${r.css} B  (budget ${budgets.css} B)`);
  console.log(`fonts (${r.fontFiles} woff2)  ${r.fonts} B  (budget ${budgets.fonts} B)`);
  if (r.web)
    console.log(
      `apps/web ${r.web.route} JS  ${r.web.gzip} B gzip  (budget ${budgets.webRouteJs} B)`,
    );
  else console.log('apps/web not built — route JS budget skipped (run `pnpm -F @cdevi/web build`)');
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
