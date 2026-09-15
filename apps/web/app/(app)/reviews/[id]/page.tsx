import type { PullRequestReviewView } from '@cdevi/contracts';
import type { Metadata } from 'next';
import { Button, Notice, Topbar } from '../../../../lib/ds';
import { getMe, getPullRequestReviewView } from '../../../../lib/session';
import { ReviewCenterScreen } from './ReviewCenterScreen';

export const metadata: Metadata = { title: 'Review' };
export const dynamic = 'force-dynamic';

/** PR Review Center (specs/001 US6, UI spec §20–22). 400/403/404/5xx all render the same notice. */
export default async function ReviewCenterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = (await getMe())!;
  let view: PullRequestReviewView | null = null;
  try {
    view = await getPullRequestReviewView(id);
  } catch {
    view = null;
  }
  if (!view) {
    return (
      <>
        <Topbar title="Review" />
        <Notice tone="error">This pull request isn&apos;t available to you.</Notice>
        <p>
          <Button variant="ghost" href="/reviews">
            Back to Reviews
          </Button>
        </p>
      </>
    );
  }
  return (
    <ReviewCenterScreen initial={view} userRole={me.user.role} now={new Date().toISOString()} />
  );
}
