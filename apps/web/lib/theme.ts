import type { ThemeSetting } from '@cdevi/design-system';

export const THEME_COOKIE = 'cdevi_theme';

export function parseTheme(value: string | undefined | null): ThemeSetting {
  return value === 'light' || value === 'dark' ? value : 'system';
}
