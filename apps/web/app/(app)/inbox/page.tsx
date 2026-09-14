import type { Metadata } from 'next';
import { Notice } from '../../../lib/ds';
import { ApiError } from '../../../lib/api';
import { getInboxSnapshot, getMe, selectedProject } from '../../../lib/session';
import { InboxScreen } from './InboxScreen';

export const metadata: Metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Home page (FR-001): server-renders the first snapshot, then `InboxScreen` keeps it fresh over SSE. */
export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tabParam = typeof params['tab'] === 'string' ? params['tab'] : undefined;
  const tab = tabParam === 'running' || tabParam === 'done' ? tabParam : 'needsYou';
  const project = await selectedProject(
    typeof params['project'] === 'string' ? params['project'] : undefined,
  );
  const me = (await getMe())!;
  const snapshot = await loadSnapshot(tab, project);
  if (!snapshot) {
    return (
      <Notice tone="error" action={<a href="/inbox">Retry</a>}>
        Couldn&apos;t load the Inbox. Retry.
      </Notice>
    );
  }
  return <InboxScreen me={me} initial={snapshot} />;
}

async function loadSnapshot(tab: 'needsYou' | 'running' | 'done', project: string) {
  try {
    return await getInboxSnapshot(tab, project);
  } catch (e) {
    // The remembered project is no longer visible: fall back to all projects.
    if (e instanceof ApiError && e.status === 404)
      return getInboxSnapshot(tab, 'all').catch(() => null);
    return null;
  }
}
