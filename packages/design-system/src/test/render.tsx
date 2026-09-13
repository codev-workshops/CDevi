import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';

export type Theme = 'light' | 'dark';

/**
 * Renders `ui` inside a `.cd-root` container with the requested theme applied to <html>,
 * mirroring how the design system is mounted in an application.
 */
export function renderThemed(
  ui: ReactElement,
  theme: Theme = 'light',
  options: Omit<RenderOptions, 'wrapper'> = {},
): RenderResult {
  document.documentElement.dataset['theme'] = theme;
  return render(ui, {
    ...options,
    wrapper: ({ children }) => <div className="cd-root">{children}</div>,
  });
}
