import { ThemeProvider } from '@cdevi/design-system';
import { render, type RenderResult } from '@testing-library/react';
import axe, { type AxeResults, type RunOptions } from 'axe-core';
import type { ReactElement } from 'react';
import { expect } from 'vitest';

const AXE_OPTIONS: RunOptions = {
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
  // jsdom has no layout engine; contrast is verified by the design-system contrast test and Playwright.
  rules: { 'color-contrast': { enabled: false } },
};

/** Renders like the app does: under a ThemeProvider (light) so components using `useTheme` work. */
export function renderApp(ui: ReactElement): RenderResult {
  document.documentElement.dataset['theme'] = 'light';
  return render(ui, {
    wrapper: ({ children }) => <ThemeProvider theme="light">{children}</ThemeProvider>,
  });
}

export async function expectNoViolations(container: Element): Promise<void> {
  const results: AxeResults = await axe.run(container, AXE_OPTIONS);
  const report = results.violations
    .map((v) => `${v.id}: ${v.help}\n` + v.nodes.map((n) => `  - ${n.html}`).join('\n'))
    .join('\n\n');
  expect(results.violations, report).toEqual([]);
}
