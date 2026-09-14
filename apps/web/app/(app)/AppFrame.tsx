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
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { NAV_ITEMS } from '../../lib/navigation';
import { ThemeSwitch } from './ThemeSwitch';

interface InboxCountStore {
  count: number | undefined;
  setCount: (n: number) => void;
  /** Pending approvals + clarifications shown beside "Approvals" (specs/001 US2 scenario 6). */
  setApprovalsCount: Dispatch<SetStateAction<number | undefined>>;
  setPanel: (panel: ReactNode) => void;
}
const InboxCountContext = createContext<InboxCountStore>({
  count: undefined,
  setCount: () => {},
  setApprovalsCount: () => {},
  setPanel: () => {},
});
/** Lets the Inbox page publish the Needs-you count and the panel from its own snapshot so nav, tab and Today agree (SC-004). */
export const useInboxCount = () => useContext(InboxCountContext);

export interface AppFrameProps {
  me: Me;
  needsYouCount: number | undefined;
  approvalsCount?: number | undefined;
  panel?: ReactNode;
  children: ReactNode;
}

/** The signed-in shell (ui-inbox-screen.md §1): full-viewport AppShell, no sticky headers (DR-05). */
export function AppFrame({ me, needsYouCount, approvalsCount, panel, children }: AppFrameProps) {
  const pathname = usePathname() ?? '/';
  const [count, setCount] = useState<number | undefined>(needsYouCount);
  const [pendingDecisions, setApprovalsCount] = useState<number | undefined>(approvalsCount);
  const [livePanel, setPanel] = useState<ReactNode>(undefined);
  const store = useMemo(() => ({ count, setCount, setApprovalsCount, setPanel }), [count]);
  const navCount = (href: string) =>
    href === '/inbox' ? count : href === '/approvals' ? pendingDecisions : undefined;
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
              {ungrouped.map((n) => {
                const c = navCount(n.href);
                return (
                  <NavItem
                    key={n.href}
                    href={n.href}
                    active={isActive(n.href)}
                    {...(c !== undefined ? { count: c } : {})}
                  >
                    {n.label}
                  </NavItem>
                );
              })}
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
