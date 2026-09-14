'use client';

import { ThemeProvider, type ThemeSetting } from '@cdevi/design-system';
import type { ReactNode } from 'react';

export function Providers({ theme, children }: { theme: ThemeSetting; children: ReactNode }) {
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}
