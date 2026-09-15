import type { Metadata } from 'next';
import { Topbar } from '../../../../lib/ds';
import { getMe } from '../../../../lib/session';
import { CreateRequirementForm } from './CreateRequirementForm';

export const metadata: Metadata = { title: 'New requirement' };
export const dynamic = 'force-dynamic';

/** Create requirement (specs/001 US4 scenario 1, ui-requirements.md §4); the form renders the role notice for non-creators. */
export default async function NewRequirementPage() {
  const me = (await getMe())!;
  return (
    <>
      <Topbar title="New requirement" />
      <CreateRequirementForm me={me} />
    </>
  );
}
