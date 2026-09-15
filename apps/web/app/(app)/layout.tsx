import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  getApprovalCenterSnapshot,
  getInboxSnapshot,
  getMe,
  selectedProject,
} from '../../lib/session';
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
  const project = await selectedProject(url.searchParams.get('project') ?? undefined);
  // On failure the Inbox / Approval Center pages show their own error state; the shell stays usable without counts.
  const [snapshot, approvals] = await Promise.all([
    getInboxSnapshot(tab, project).catch(() => null),
    getApprovalCenterSnapshot(project).catch(() => null),
  ]);
  const panel: ReactNode =
    snapshot && url.pathname === '/inbox' ? (
      <InboxPanel today={snapshot.today} policySummary={snapshot.policySummary} />
    ) : undefined;
  return (
    <AppFrame
      me={me}
      needsYouCount={snapshot?.counts.needsYou}
      approvalsCount={
        approvals ? approvals.counts.approvals + approvals.counts.clarifications : undefined
      }
      panel={panel}
    >
      {children}
    </AppFrame>
  );
}
