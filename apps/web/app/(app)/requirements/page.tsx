import type { Metadata } from 'next';
import { Button, Notice, Topbar } from '../../../lib/ds';
import { getMe, getRequirementList, selectedProject } from '../../../lib/session';
import { RequirementsListScreen } from './RequirementsListScreen';

export const metadata: Metadata = { title: 'Requirements' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const param = (params: Record<string, string | string[] | undefined>, key: string) =>
  typeof params[key] === 'string' ? params[key] : undefined;

/** Requirements list (specs/001 US4 scenario 5, ui-requirements.md §1): server-renders the first page for the remembered project and `?state=`/`?assignee=`/`?cursor=`, then the client screen keeps it fresh. */
export default async function RequirementsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const project = await selectedProject(param(params, 'project'));
  const me = (await getMe())!;
  let initial = null;
  try {
    initial = await getRequirementList(
      project,
      param(params, 'state'),
      param(params, 'assignee'),
      param(params, 'cursor'),
    );
  } catch {
    initial = null;
  }
  if (!initial) {
    return (
      <>
        <Topbar title="Requirements" />
        <Notice
          tone="error"
          action={
            <Button variant="ghost" href="/requirements">
              Retry
            </Button>
          }
        >
          Requirements couldn&apos;t be loaded.
        </Notice>
      </>
    );
  }
  return <RequirementsListScreen me={me} initial={initial} />;
}
