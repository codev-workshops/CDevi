import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';
import { scan } from '../check-class-prefix.mjs';
import { buildTokens } from '../../packages/design-system/scripts/build-tokens.mjs';
import { contrastRatio, resolveColor } from '../../packages/design-system/scripts/color.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const FIX = resolve(import.meta.dirname);

async function eslintRules(file: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: ROOT, overrideConfig: { ignores: [] }, ignore: false });
  const [result] = await eslint.lintFiles([join(FIX, file)]);
  return result!.messages.filter((m) => m.severity === 2).map((m) => m.ruleId ?? 'parse');
}

describe('violation fixtures fail their checks (SC-002)', () => {
  it('inline style → react/forbid-dom-props with the DR-07 message', async () => {
    const eslint = new ESLint({ cwd: ROOT, ignore: false });
    const [r] = await eslint.lintFiles([join(FIX, 'inline-style.tsx')]);
    const msg = r!.messages.find((m) => m.ruleId === 'react/forbid-dom-props');
    expect(msg, 'expected react/forbid-dom-props').toBeDefined();
    expect(msg!.message).toContain('DR-07');
  });

  it('div with onClick → jsx-a11y static-element + key-events rules', async () => {
    const rules = await eslintRules('div-onclick.tsx');
    expect(rules).toContain('jsx-a11y/no-static-element-interactions');
    expect(rules).toContain('jsx-a11y/click-events-have-key-events');
  });

  it('icon-only button → jsx-a11y/control-has-associated-label', async () => {
    const rules = await eslintRules('icon-no-label.tsx');
    expect(rules).toContain('jsx-a11y/control-has-associated-label');
  });

  it('raw colour and spacing → declaration-strict-value twice with the DR-06 message', async () => {
    // The fixture folder is in ignoreFiles for the normal run; load the config without that list.
    const { ignoreFiles: _ignored, ...config } = JSON.parse(
      readFileSync(join(ROOT, '.stylelintrc.json'), 'utf8'),
    ) as { ignoreFiles: string[] } & Record<string, unknown>;
    const result = await stylelint.lint({ files: join(FIX, 'raw-color.css'), cwd: ROOT, config });
    const warnings = result.results[0]!.warnings.filter(
      (w) => w.rule === 'scale-unlimited/declaration-strict-value',
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]!.text).toContain('DR-06');
  });

  it('unknown cd- class → class-prefix scanner reports it with suggestions', () => {
    const problems = scan([join(FIX, 'unknown-cd-class.tsx')]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.cls).toBe('cd-sparkle');
    expect(problems[0]!.suggestions.length).toBe(3);
    expect(problems[0]!.line).toBe(3);
  });

  it('a hand-edited generated file → token drift is detectable', () => {
    const tokens = JSON.parse(
      readFileSync(join(ROOT, 'packages/design-system/tokens/tokens.json'), 'utf8'),
    );
    const fresh = buildTokens(tokens).css;
    const committed = readFileSync(join(ROOT, 'packages/design-system/css/tokens.css'), 'utf8');
    expect(committed).toBe(fresh);
    const drifted = committed.replace('--saffron:#C9791B', '--saffron:#C9791C');
    expect(drifted).not.toBe(fresh);
  });

  it('a failing pair → contrast check computes below threshold', () => {
    const tokens = JSON.parse(
      readFileSync(join(ROOT, 'packages/design-system/tokens/tokens.json'), 'utf8'),
    );
    const ratio = contrastRatio(
      resolveColor(tokens, 'color.line-2'),
      resolveColor(tokens, 'color.surface'),
    );
    expect(ratio).toBeLessThan(4.5);
  });

  it('a token file that breaks the schema is rejected by the generator', () => {
    const tokens = JSON.parse(
      readFileSync(join(ROOT, 'packages/design-system/tokens/tokens.json'), 'utf8'),
    );
    tokens.color.rogue = { $type: 'color', $value: 'red' };
    expect(() => buildTokens(tokens)).toThrow(/schema/);
  });

  it('fixtures are excluded from the normal lint run', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    expect(await eslint.isPathIgnored(join(FIX, 'inline-style.tsx'))).toBe(true);
  });

  it('scanner honours the ignore pragma for wrapped third-party widgets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-prefix-'));
    try {
      const f = join(dir, 'Widget.tsx');
      writeFileSync(f, '// cd-classes-ignore-file\nexport const x = "cd-not-ours";\n');
      expect(scan([f])).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
