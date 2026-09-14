import type { Metadata } from 'next';
import { renderRecord } from '../../record-page';

export const metadata: Metadata = { title: 'Workflow' };
export const dynamic = 'force-dynamic';

export default async function WorkflowRecord({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return renderRecord('workflows', id, await searchParams);
}
