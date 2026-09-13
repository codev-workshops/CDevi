#!/usr/bin/env node
// CHK-CLASS-PREFIX: fails when code outside the design-system CSS uses a `cd-` class the package does not define.
// Usage: node tools/check-class-prefix.mjs [files or globs…]   (defaults to apps/** and packages/design-system/src/**)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CSS_DIR = join(ROOT, 'packages/design-system/css');
const DEFAULT_SCOPES = ['apps', 'packages/design-system/src', 'packages/design-system/gallery'];
const EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.html', '.css', '.mdx']);
const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'gallery-dist',
  'coverage',
  '__screenshots__',
]);
const IGNORE_PRAGMA = '// cd-classes-ignore-file';
// Class fragments that are built dynamically inside the package (`cd-${variant}`), declared here so the
// scanner can verify them against the CSS instead of guessing.
const DYNAMIC_PREFIXES = ['cd-risk-', 'cd-'];

export function definedClasses() {
  const set = new Set();
  for (const f of readdirSync(CSS_DIR)) {
    if (!f.endsWith('.css') || f === 'cdevi.css') continue;
    const css = readFileSync(join(CSS_DIR, f), 'utf8');
    for (const m of css.matchAll(/\.(cd-[a-z0-9-]+)/g)) set.add(m[1]);
  }
  return set;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (EXT.has(p.slice(p.lastIndexOf('.')))) yield p;
  }
}

function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length][b.length];
}

function suggest(cls, defined) {
  return [...defined]
    .map((d) => [distance(cls, d), d])
    .sort((x, y) => x[0] - y[0])
    .slice(0, 3)
    .map(([, d]) => d);
}

/** @returns {{ file: string, line: number, cls: string, suggestions: string[] }[]} */
export function scan(paths = []) {
  const defined = definedClasses();
  const files = [];
  const targets = paths.length ? paths : DEFAULT_SCOPES.map((s) => join(ROOT, s));
  for (const t of targets) {
    const abs = resolve(t);
    try {
      if (statSync(abs).isDirectory()) files.push(...walk(abs));
      else files.push(abs);
    } catch {
      /* scope does not exist yet (e.g. no apps/) */
    }
  }
  const problems = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (src.includes(IGNORE_PRAGMA)) continue;
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/(?<![\w$.-])(cd-[a-z0-9-]+)(?![\w-])/g)) {
        const cls = m[1];
        // template fragments like `cd-${variant}` end with '-' and are covered by DYNAMIC_PREFIXES
        if (DYNAMIC_PREFIXES.includes(cls) || cls.endsWith('-')) continue;
        if (!defined.has(cls))
          problems.push({ file, line: i + 1, cls, suggestions: suggest(cls, defined) });
      }
    });
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const problems = scan(process.argv.slice(2));
  if (problems.length === 0) {
    console.log('check:classes ✓ every cd- class is defined by @cdevi/design-system');
    process.exit(0);
  }
  for (const p of problems) {
    console.error(
      `${relative(ROOT, p.file)}:${p.line}  ${p.cls}  →  did you mean ${p.suggestions.join(', ')}?\n` +
        '    DR-09: add the class to packages/design-system/css/components.css with a gallery entry, or use an existing class (DESIGN.md §8).',
    );
  }
  console.error(`\ncheck:classes ✗ ${problems.length} undefined cd- class reference(s)`);
  process.exit(1);
}
