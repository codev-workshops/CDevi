import axe, { type AxeResults, type RunOptions } from 'axe-core';
import type { ReactElement } from 'react';
import { expect } from 'vitest';
import { renderThemed, type Theme } from './render';

const AXE_OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom has no layout engine; colour contrast is verified separately by tests/unit/contrast.test.ts
  rules: { 'color-contrast': { enabled: false } },
};

function formatViolations(results: AxeResults): string {
  return results.violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n  ${v.helpUrl}\n` +
        v.nodes.map((n) => `  - ${n.html}\n    ${n.failureSummary ?? ''}`).join('\n'),
    )
    .join('\n\n');
}

/** Runs axe against `container` and fails the test with a readable report on any violation. */
export async function expectNoViolations(container: Element): Promise<void> {
  const results = await axe.run(container, AXE_OPTIONS);
  expect(results.violations, formatViolations(results)).toEqual([]);
}

/** Renders `ui` in the given themes (default both) and asserts axe reports no violations in each. */
export async function expectAccessible(
  ui: ReactElement,
  themes: Theme[] = ['light', 'dark'],
): Promise<void> {
  for (const theme of themes) {
    const { container, unmount } = renderThemed(ui, theme);
    await expectNoViolations(container);
    unmount();
  }
}
