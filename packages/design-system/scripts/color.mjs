// WCAG 2.x relative luminance and contrast ratio helpers; shared by the contrast check and the generator.

/** @param {string} hex `#RRGGBB` */
export function hexToRgb(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #RRGGBB colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** @param {string} hex */
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two `#RRGGBB` colours (≥ 1). */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Resolves a token path (`color.saffron`, `semantic.risk.critical`) or a literal (`#fff`, `white`)
 * to a `#RRGGBB` value for the given theme, following `{references}`.
 */
export function resolveColor(tokens, ref, theme = 'light', depth = 0) {
  if (depth > 8) throw new Error(`reference loop at ${ref}`);
  if (ref === 'white' || ref === '#fff' || ref === '#FFF') return '#FFFFFF';
  if (ref.startsWith('#')) return ref.toUpperCase();
  const node = ref.split('.').reduce((o, k) => (o == null ? undefined : o[k]), tokens);
  if (!node || typeof node !== 'object' || !('$value' in node))
    throw new Error(`unknown token ${ref}`);
  const value = node.$value;
  if (typeof value === 'string' && value.startsWith('{')) {
    return resolveColor(tokens, value.slice(1, -1), theme, depth + 1);
  }
  const dark = node.$extensions?.['cdevi.dark'];
  return String(theme === 'dark' && dark ? dark : value).toUpperCase();
}
