import type { RequirementDetail } from '@cdevi/contracts';
import type { Metadata } from 'next';
import { Button, Notice, Topbar } from '../../../../lib/ds';
import { getMe, getRequirementDetail } from '../../../../lib/session';
import { RequirementDetailScreen } from './RequirementDetailScreen';

export const metadata: Metadata = { title: 'Requirement' };
export const dynamic = 'force-dynamic';

/** Requirement Detail (specs/001 US4, ui-requirements.md §1). 400/403/404/5xx all render the same notice (§5.2). */
export default async function RequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = (await getMe())!;
  let detail: RequirementDetail | null = null;
  try {
    detail = await getRequirementDetail(id);
  } catch {
    detail = null;
  }
  if (!detail) {
    return (
      <>
        <Topbar title="Requirement" />
        <Notice tone="error">This item isn&apos;t available to you.</Notice>
        <p>
          <Button variant="ghost" href="/requirements">
            Back to Requirements
          </Button>
        </p>
      </>
    );
  }
  return <RequirementDetailScreen me={me} initial={detail} />;
}
