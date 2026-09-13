import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pkgPath } from './helpers';

const components = readFileSync(pkgPath('css/components.css'), 'utf8');

describe('components.css class contract', () => {
  it('styles the table with the class the examples use (regression: cd-cd-table)', () => {
    expect(components).toMatch(/table\.cd-table\s*\{/);
    expect(components).not.toContain('cd-cd-table');
  });

  it('defines every class prefix the React components render', () => {
    const required = [
      'cd-root',
      'cd-app',
      'cd-full',
      'cd-side',
      'cd-brand',
      'cd-nav',
      'cd-main',
      'cd-panel',
      'cd-topbar',
      'cd-crumbs',
      'cd-btn',
      'cd-pill',
      'cd-rt',
      'cd-key',
      'cd-mono',
      'cd-card',
      'cd-list',
      'cd-row',
      'cd-tabs',
      'cd-field',
      'cd-input',
      'cd-seg',
      'cd-chip',
      'cd-help',
      'cd-kv',
      'cd-meter',
      'cd-check',
      'cd-msg',
      'cd-tools',
      'cd-decision',
      'cd-opt',
      'cd-diff',
      'cd-stepper',
      'cd-stat',
      'cd-bars',
      'cd-table',
      'cd-term',
    ];
    const defined = new Set([...components.matchAll(/\.(cd-[a-z0-9-]+)/g)].map((m) => m[1]));
    const base = readFileSync(pkgPath('css/base.css'), 'utf8');
    for (const cls of [...base.matchAll(/\.(cd-[a-z0-9-]+)/g)]) defined.add(cls[1]!);
    const missing = required.filter((c) => !defined.has(c));
    expect(missing, `missing classes: ${missing.join(', ')}`).toEqual([]);
  });

  it('provides hover, active, disabled and ARIA-state selectors for interactive components', () => {
    for (const sel of [
      '.cd-btn:hover',
      '.cd-btn:active',
      '.cd-btn:disabled',
      '[aria-selected="true"]',
      '[aria-current',
      '[aria-checked="true"]',
      '[aria-pressed="true"]',
    ]) {
      expect(components, `expected selector containing ${sel}`).toContain(sel);
    }
  });
});
