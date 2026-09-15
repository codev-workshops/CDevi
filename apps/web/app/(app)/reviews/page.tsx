import { PULL_REQUEST_STATUSES } from '@cdevi/contracts/review-model';
import type { Metadata } from 'next';
import { Button, Notice, Topbar } from '../../../lib/ds';
import { getMe, getReviewList, selectedProject } from '../../../lib/session';
import { ReviewsScreen } from './ReviewsScreen';

export const metadata: Metadata = { title: 'Reviews' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const param = (params: Record<string, string | string[] | undefined>, key: string) =>
  typeof params[key] === 'string' ? params[key] : undefined;

/** Reviews list (specs/001 US6, UI spec §20): server-renders the first page for the remembered project and `?state=`/`?cursor=`, then the client screen keeps it fresh. */
export default async function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const project = await selectedProject(param(params, 'project'));
  const me = (await getMe())!;
  const stateParam = param(params, 'state');
  const state = PULL_REQUEST_STATUSES.find((s) => s === stateParam);
  let initial = null;
  try {
    initial = await getReviewList(project, state, param(params, 'cursor'));
  } catch {
    initial = null;
  }
  if (!initial) {
    return (
      <>
        <Topbar title="Reviews" />
        <Notice
          tone="error"
          action={
            <Button variant="ghost" href="/reviews">
              Retry
            </Button>
          }
        >
          Pull requests under review couldn&apos;t be loaded.
        </Notice>
      </>
    );
  }
  return (
    <ReviewsScreen
      me={me}
      initial={initial}
      now={new Date().toISOString()}
      project={project}
      state={state}
    />
  );
}
