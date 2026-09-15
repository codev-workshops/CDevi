import type { Metadata } from 'next';
import { ApiError } from '../../../lib/api';
import { Notice } from '../../../lib/ds';
import { getApprovalCenterSnapshot, getMe, selectedProject } from '../../../lib/session';
import { ApprovalCenterScreen } from './ApprovalCenterScreen';

export const metadata: Metadata = { title: 'Approval Center' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Approval Center (specs/001 US2, ui-approval-center.md §1): server-renders the first snapshot, then the client screen keeps it fresh. */
export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const project = await selectedProject(
    typeof params['project'] === 'string' ? params['project'] : undefined,
  );
  const me = (await getMe())!;
  const snapshot = await loadSnapshot(project);
  if (!snapshot) {
    return (
      <Notice tone="error" action={<a href="/approvals">Retry</a>}>
        Couldn&apos;t load approvals. Retry.
      </Notice>
    );
  }
  return <ApprovalCenterScreen me={me} initial={snapshot} />;
}

async function loadSnapshot(project: string) {
  try {
    return await getApprovalCenterSnapshot(project);
  } catch (e) {
    // The remembered project is no longer visible: fall back to all projects.
    if (e instanceof ApiError && e.status === 404)
      return getApprovalCenterSnapshot('all').catch(() => null);
    return null;
  }
}
