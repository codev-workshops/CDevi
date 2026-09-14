import '@cdevi/design-system/css';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { parseTheme, THEME_COOKIE } from '../lib/theme';
import { Providers } from './Providers';

export const metadata: Metadata = {
  title: { default: 'CDevi', template: '%s · CDevi' },
  description: 'CDevi — SDLC control plane',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The chosen theme is applied on the server too, so there is no flash before hydration.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      {...(theme !== 'system' ? { 'data-theme': theme } : {})}
      suppressHydrationWarning
    >
      <body>
        <Providers theme={theme}>{children}</Providers>
      </body>
    </html>
  );
}
