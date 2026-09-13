import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type ThemeSetting = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: ThemeSetting;
  setTheme: (theme: ThemeSetting) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  /** Initial theme. `system` removes `data-theme` so `prefers-color-scheme` applies. */
  theme?: ThemeSetting;
  /** Element that receives `data-theme`. Defaults to `<html>`. */
  target?: HTMLElement | null;
  children?: ReactNode;
}

/** Controls the `data-theme` attribute that css/tokens.css reads. */
export function ThemeProvider({ theme: initial = 'system', target, children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<ThemeSetting>(initial);

  useEffect(() => {
    const el = target ?? document.documentElement;
    if (theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', theme);
  }, [theme, target]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Access the current theme setting and setter; must be used under ThemeProvider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within <ThemeProvider>');
  return ctx;
}
