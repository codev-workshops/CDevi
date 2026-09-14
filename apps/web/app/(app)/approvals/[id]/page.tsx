import type { Metadata } from 'next';
import { renderRecord } from '../../record-page';

export const metadata: Metadata = { title: 'Approval' };
export const dynamic = 'force-dynamic';

export default async function ApprovalRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return renderRecord('approvals', id, await searchParams);
}
