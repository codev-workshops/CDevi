'use client';

import { ThemeProvider } from '@cdevi/design-system';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return <ThemeProvider theme="system">{children}</ThemeProvider>;
}
