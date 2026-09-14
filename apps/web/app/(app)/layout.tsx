import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getInboxSnapshot, getMe, selectedProject } from '../../lib/session';
import { safeNext } from '../../lib/safe-next';
import { AppFrame } from './AppFrame';
import { InboxPanel } from './inbox/InboxPanel';

export const dynamic = 'force-dynamic';

/** Signed-in shell. Unauthenticated requests go to sign-in and come back to where they were (FR-001, FR-004). */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? '/inbox';
  const me = await getMe();
  if (!me) redirect(`/sign-in?next=${encodeURIComponent(safeNext(pathname))}`);

  const url = new URL(pathname, 'http://local');
  const tabParam = url.searchParams.get('tab');
  const tab = tabParam === 'running' || tabParam === 'done' ? tabParam : 'needsYou';
  // On failure the Inbox page shows its own error state; the shell stays usable without a count.
  const snapshot = await getInboxSnapshot(
    tab,
    await selectedProject(url.searchParams.get('project') ?? undefined),
  ).catch(() => null);
  const panel: ReactNode =
    snapshot && url.pathname === '/inbox' ? (
      <InboxPanel today={snapshot.today} policySummary={snapshot.policySummary} />
    ) : undefined;
  return (
    <AppFrame me={me} needsYouCount={snapshot?.counts.needsYou} panel={panel}>
      {children}
    </AppFrame>
  );
}
