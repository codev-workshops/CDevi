import type { ApprovalCenterDetail } from '@cdevi/contracts';
import type { Metadata } from 'next';
import { ApiError, apiFetch } from '../../../../lib/api';
import { Notice } from '../../../../lib/ds';
import { cookieHeader } from '../../../../lib/session';
import { ApprovalDecisionScreen } from './ApprovalDecisionScreen';

export const metadata: Metadata = { title: 'Approval' };
export const dynamic = 'force-dynamic';

export default async function ApprovalDecisionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await loadDetail(id);

  if (detail === 'missing') {
    return (
      <Notice tone="error" action={<a href="/approvals">Back to Approval Center</a>}>
        This item doesn&apos;t exist or you don&apos;t have access.
      </Notice>
    );
  }
  if (detail === null) {
    return (
      <Notice tone="error" action={<a href={`/approvals/${encodeURIComponent(id)}`}>Retry</a>}>
        Couldn&apos;t load this item. Retry.
      </Notice>
    );
  }
  return <ApprovalDecisionScreen initial={detail} />;
}

async function loadDetail(id: string): Promise<ApprovalCenterDetail | 'missing' | null> {
  try {
    return await apiFetch<ApprovalCenterDetail>(`/api/approvals/${encodeURIComponent(id)}`, {
      cookie: await cookieHeader(),
    });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return 'missing';
    return null;
  }
}
