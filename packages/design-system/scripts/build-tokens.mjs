// Generates css/tokens.css, tailwind/preset.cjs and src/tokens.generated.ts from tokens/tokens.json.
// tokens.json is the single source of truth; never edit the generated files by hand (tests/unit/tokens.test.ts).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const schemaPath = resolve(
  root,
  '../../specs/002-adopt-design-system/contracts/tokens.schema.json',
);

const HEADER = '/* GENERATED from tokens/tokens.json by scripts/build-tokens.mjs — do not edit. */';

/** Flattens the token tree into [{ path, cssVar, type, light, dark, twKey }]. */
function flatten(tokens) {
  const out = [];
  const groups = ['color', 'font', 'radius', 'space', 'text', 'shadow'];
  for (const group of groups) {
    for (const [name, tok] of Object.entries(tokens[group])) {
      const cssVar = tok.$extensions?.['cdevi.cssVar'] ?? defaultVar(group, name);
      const light = serialize(tok);
      const dark = tok.$extensions?.['cdevi.dark'];
      out.push({ path: `${group}.${name}`, group, name, cssVar, type: tok.$type, light, dark });
    }
  }
  return out;
}

function defaultVar(group, name) {
  if (group === 'color') return `--${name}`;
  if (group === 'font') return `--${name}`;
  if (group === 'shadow') return `--shadow-${name}`;
  if (group === 'radius') return `--radius-${name}`;
  return `--${group}-${name}`;
}

function serialize(tok) {
  if (tok.$type === 'fontFamily') {
    return tok.$value.map((f) => (/\s/.test(f) ? `"${f}"` : f)).join(',');
  }
  return String(tok.$value);
}

function block(selector, vars, indent = '') {
  return `${indent}${selector}{\n${vars.map(([k, v]) => `${indent}  ${k}:${v};`).join('\n')}\n${indent}}`;
}

function buildCss(flat) {
  const light = flat.map((t) => [t.cssVar, t.light]);
  const dark = flat.filter((t) => t.dark).map((t) => [t.cssVar, t.dark]);
  return [
    HEADER,
    block(':root', light),
    block('[data-theme="dark"]', dark),
    '@media (prefers-color-scheme:dark){',
    block(':root:not([data-theme="light"])', dark, '  '),
    '}',
    '',
  ].join('\n');
}

/** Nests `saffron-soft` → colors.saffron.soft, `ink-2` → colors.ink[2], plain → DEFAULT. */
function nestColors(flat) {
  const colors = {};
  const names = new Set(flat.filter((t) => t.group === 'color').map((t) => t.name));
  for (const t of flat.filter((t) => t.group === 'color')) {
    const value = `var(${t.cssVar})`;
    const dash = t.name.indexOf('-');
    const base = dash > 0 ? t.name.slice(0, dash) : t.name;
    const suffix = dash > 0 ? t.name.slice(dash + 1) : null;
    if (suffix !== null && names.has(base)) {
      colors[base] =
        typeof colors[base] === 'string' ? { DEFAULT: colors[base] } : (colors[base] ?? {});
      colors[base][suffix] = value;
    } else if (suffix !== null) {
      // e.g. code-bg with no bare `code` token: group under the base name
      colors[base] ??= {};
      colors[base][suffix] = value;
    } else {
      colors[t.name] =
        typeof colors[t.name] === 'object' ? { ...colors[t.name], DEFAULT: value } : value;
    }
  }
  return colors;
}

function buildPreset(flat) {
  const byGroup = (g) =>
    Object.fromEntries(flat.filter((t) => t.group === g).map((t) => [t.name, `var(${t.cssVar})`]));
  const theme = {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      ...nestColors(flat),
    },
    fontFamily: Object.fromEntries(
      flat.filter((t) => t.group === 'font').map((t) => [t.name, [`var(${t.cssVar})`]]),
    ),
    borderRadius: { none: '0', ...byGroup('radius') },
    fontSize: byGroup('text'),
    spacing: { 0: '0', px: '1px', ...byGroup('space') },
    boxShadow: { none: 'none', ...byGroup('shadow') },
  };
  return (
    `// ${HEADER.slice(3, -3).trim()}\n` +
    '// CDevi Tailwind preset: `theme` REPLACES Tailwind defaults so only token-backed utilities exist (FR-009).\n' +
    '// Colours resolve to CSS variables so dark mode follows css/tokens.css.\n' +
    `module.exports = ${JSON.stringify({ theme }, null, 2)};\n`
  );
}

function buildTs(flat, tokens) {
  const entries = flat.map((t) => `  '${t.path}': '${t.cssVar}',`).join('\n');
  const semantic = (obj, prefix) =>
    Object.entries(obj)
      .filter(([, v]) => typeof v === 'object' && '$value' in v)
      .map(([k, v]) => `  '${prefix}${k}': '${v.$value.slice(1, -1)}',`)
      .join('\n');
  return (
    `// ${HEADER.slice(3, -3).trim()}\n` +
    `export const tokenVersion = '${tokens.version}';\n\n` +
    `/** Token path → CSS custom property name. */\nexport const cssVar = {\n${entries}\n} as const;\n\n` +
    `export type TokenName = keyof typeof cssVar;\n\n` +
    `/** Semantic alias → base colour token path. */\nexport const semanticColor = {\n` +
    semantic(tokens.semantic, '') +
    '\n' +
    semantic(tokens.semantic.state, 'state.') +
    '\n' +
    semantic(tokens.semantic.risk, 'risk.') +
    '\n} as const;\n'
  );
}

/**
 * Builds all outputs. When `outDir` is given, writes them under it (used for the real build and the drift test).
 * @returns {{ css: string, preset: string, ts: string, files: string[] }}
 */
export function buildTokens(tokens, outDir) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
  if (!validate(tokens)) {
    throw new Error(
      'tokens.json failed schema validation:\n' + JSON.stringify(validate.errors, null, 2),
    );
  }
  const flat = flatten(tokens);
  const out = {
    css: buildCss(flat),
    preset: buildPreset(flat),
    ts: buildTs(flat, tokens),
    files: [],
  };
  if (outDir) {
    const targets = [
      ['css/tokens.css', out.css],
      ['tailwind/preset.cjs', out.preset],
      ['src/tokens.generated.ts', out.ts],
    ];
    for (const [rel, content] of targets) {
      const file = resolve(outDir, rel);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      out.files.push(file);
    }
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const tokens = JSON.parse(readFileSync(resolve(root, 'tokens/tokens.json'), 'utf8'));
  const { files } = buildTokens(tokens, root);
  for (const f of files) console.log(`wrote ${f}`);
}
