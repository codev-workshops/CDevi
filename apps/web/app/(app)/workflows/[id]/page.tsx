import type { WorkflowDetail } from '@cdevi/contracts';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { apiFetch } from '../../../../lib/api';
import { Button, Notice, Topbar } from '../../../../lib/ds';
import { getMe } from '../../../../lib/session';
import { WorkflowDetailScreen } from './WorkflowDetailScreen';

export const metadata: Metadata = { title: 'Workflow' };
export const dynamic = 'force-dynamic';

/** Workflow Detail (specs/001 US1, ui-workflow-detail-screen.md §1). 400/403/404/5xx all render the same notice. */
export default async function WorkflowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = (await getMe())!;
  let detail: WorkflowDetail | null = null;
  try {
    detail = await apiFetch<WorkflowDetail>(`/api/workflows/${encodeURIComponent(id)}`, {
      cookie: (await headers()).get('cookie') ?? '',
    });
  } catch {
    detail = null;
  }
  if (!detail) {
    return (
      <>
        <Topbar title="Workflow" />
        <Notice tone="error">This item isn&apos;t available to you.</Notice>
        <p>
          <Button variant="ghost" href="/inbox">
            Back to Inbox
          </Button>
        </p>
      </>
    );
  }
  return <WorkflowDetailScreen initial={detail} userRole={me.user.role} />;
}
