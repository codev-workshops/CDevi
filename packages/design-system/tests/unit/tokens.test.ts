import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { buildTokens } from '../../scripts/build-tokens.mjs';
import { buildCssBundle } from '../../scripts/build-css.mjs';
import { pkgPath } from './helpers';

const tokens = JSON.parse(readFileSync(pkgPath('tokens/tokens.json'), 'utf8')) as Record<
  string,
  unknown
>;
const schemaPath = resolve(
  pkgPath(),
  '../../specs/002-adopt-design-system/contracts/tokens.schema.json',
);

describe('tokens.json is the single source of truth (FR-007, FR-008)', () => {
  it('validates against contracts/tokens.schema.json', () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
    const ok = validate(tokens);
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it('defines every CSS variable that base.css and components.css reference', () => {
    const css =
      readFileSync(pkgPath('css/components.css'), 'utf8') +
      readFileSync(pkgPath('css/base.css'), 'utf8');
    const used = new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]!));
    const generated = buildTokens(tokens).css;
    const defined = new Set([...generated.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
    const missing = [...used].filter((v) => !defined.has(v) && !v.startsWith('--cd-'));
    expect(missing, `CSS uses variables with no token: ${missing.join(', ')}`).toEqual([]);
  });

  it('committed generated files are byte-identical to a fresh build (drift check)', () => {
    const t0 = performance.now();
    const out = buildTokens(tokens);
    expect(performance.now() - t0).toBeLessThan(1000);
    const diff = (name: string, expected: string) => {
      const actual = readFileSync(pkgPath(name), 'utf8');
      expect(
        actual,
        `${name} drifted from tokens.json — run \`pnpm -F @cdevi/design-system build:tokens\` and commit`,
      ).toBe(expected);
    };
    diff('css/tokens.css', out.css);
    diff('tailwind/preset.cjs', out.preset);
    diff('src/tokens.generated.ts', out.ts);
    diff('css/cdevi.css', buildCssBundle());
  });

  it('includes the 9 workflow states and 4 risk levels as semantic references', () => {
    const semantic = tokens['semantic'] as {
      state: Record<string, unknown>;
      risk: Record<string, unknown>;
    };
    expect(Object.keys(semantic.state).sort()).toEqual(
      [
        'blocked',
        'cancelled',
        'completed',
        'failed',
        'queued',
        'retrying',
        'running',
        'waiting',
        'waiting-for-human',
      ].sort(),
    );
    expect(Object.keys(semantic.risk).sort()).toEqual(['critical', 'high', 'low', 'medium']);
  });

  it('build writes all outputs to a target directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cdevi-tokens-'));
    try {
      const written = buildTokens(tokens, dir);
      expect(written.files.map((f: string) => f.replace(dir, ''))).toEqual([
        '/css/tokens.css',
        '/tailwind/preset.cjs',
        '/src/tokens.generated.ts',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
