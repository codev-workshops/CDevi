import '@cdevi/design-system/css';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './Providers';

export const metadata: Metadata = {
  title: { default: 'CDevi', template: '%s · CDevi' },
  description: 'CDevi — SDLC control plane',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
