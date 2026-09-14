'use client';

import { Segmented, useTheme, type ThemeSetting } from '@cdevi/design-system';
import { THEME_COOKIE } from '../../lib/theme';

const OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/** Whole-app theme choice; the root layout reads the cookie so the first paint already has the right theme. */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const choose = (next: ThemeSetting) => {
    setTheme(next);
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=${365 * 24 * 3600}; SameSite=Lax`;
  };
  return (
    <Segmented<ThemeSetting> label="Theme" value={theme} onChange={choose} options={OPTIONS} />
  );
}
