'use client';

import type { Me } from '@cdevi/contracts';
import {
  AppShell,
  Brand,
  Button,
  Main,
  NavGroup,
  NavItem,
  Panel,
  Side,
} from '@cdevi/design-system';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { NAV_ITEMS } from '../../lib/navigation';
import { ThemeSwitch } from './ThemeSwitch';

interface InboxCountStore {
  count: number | undefined;
  setCount: (n: number) => void;
  setPanel: (panel: ReactNode) => void;
}
const InboxCountContext = createContext<InboxCountStore>({
  count: undefined,
  setCount: () => {},
  setPanel: () => {},
});
/** Lets the Inbox page publish the Needs-you count and the panel from its own snapshot so nav, tab and Today agree (SC-004). */
export const useInboxCount = () => useContext(InboxCountContext);

export interface AppFrameProps {
  me: Me;
  needsYouCount: number | undefined;
  panel?: ReactNode;
  children: ReactNode;
}

/** The signed-in shell (ui-inbox-screen.md §1): full-viewport AppShell, no sticky headers (DR-05). */
export function AppFrame({ me, needsYouCount, panel, children }: AppFrameProps) {
  const pathname = usePathname() ?? '/';
  const [count, setCount] = useState<number | undefined>(needsYouCount);
  const [livePanel, setPanel] = useState<ReactNode>(undefined);
  const store = useMemo(() => ({ count, setCount, setPanel }), [count]);
  const shownPanel = livePanel ?? panel;
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const ungrouped = NAV_ITEMS.filter((n) => !n.group);
  const admin = NAV_ITEMS.filter((n) => n.group === 'Administration');

  return (
    <InboxCountContext.Provider value={store}>
      <AppShell
        variant="full"
        side={
          <Side
            brand={<Brand mark="සී" name="CDevi" wordmark="සීදේවි" href="/inbox" />}
            footer={
              <>
                <span>
                  {me.organization.name} · {me.user.displayName}
                </span>{' '}
                <form action="/api/auth/sign-out" method="post">
                  <Button variant="ghost" size="sm" type="submit">
                    Sign out
                  </Button>
                </form>
                <ThemeSwitch />
              </>
            }
          >
            <>
              {ungrouped.map((n) =>
                n.href === '/inbox' ? (
                  <NavItem
                    key={n.href}
                    href={n.href}
                    active={isActive(n.href)}
                    {...(count !== undefined ? { count } : {})}
                  >
                    {n.label}
                  </NavItem>
                ) : (
                  <NavItem key={n.href} href={n.href} active={isActive(n.href)}>
                    {n.label}
                  </NavItem>
                ),
              )}
              <NavGroup>Administration</NavGroup>
              {admin.map((n) => (
                <NavItem key={n.href} href={n.href} active={isActive(n.href)}>
                  {n.label}
                </NavItem>
              ))}
            </>
          </Side>
        }
        {...(shownPanel ? { panel: <Panel>{shownPanel}</Panel> } : {})}
      >
        <Main>{children}</Main>
      </AppShell>
    </InboxCountContext.Provider>
  );
}
