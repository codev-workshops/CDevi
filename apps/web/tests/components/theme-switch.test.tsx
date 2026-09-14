import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@cdevi/design-system';
import { describe, expect, it } from 'vitest';
import { ThemeSwitch } from '../../app/(app)/ThemeSwitch';
import { THEME_COOKIE, parseTheme } from '../../lib/theme';
import { expectNoViolations, renderApp } from '../a11y';

describe('Theme switch (applies to the whole app, persisted in a cookie)', () => {
  it('offers light / dark / system, sets data-theme on <html> and remembers the choice', async () => {
    renderApp(
      <ThemeProvider theme="system">
        <ThemeSwitch />
      </ThemeProvider>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Theme' });
    expect(group).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
    await userEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(document.documentElement.dataset['theme']).toBe('light');
    await userEvent.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement.dataset['theme']).toBeUndefined();
    expect(document.cookie).toContain(`${THEME_COOKIE}=system`);
  });

  it('parseTheme only accepts the three known values', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme('neon')).toBe('system');
    expect(parseTheme(undefined)).toBe('system');
  });

  it('is accessible', async () => {
    const { container } = renderApp(
      <ThemeProvider theme="light">
        <ThemeSwitch />
      </ThemeProvider>,
    );
    await expectNoViolations(container);
  });
});
