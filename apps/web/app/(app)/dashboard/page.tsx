import type { Metadata } from 'next';
import { ApiError } from '../../../lib/api';
import { Notice } from '../../../lib/ds';
import { getDashboardSnapshot, getMe, selectedProject, selectedWindow } from '../../../lib/session';
import { DashboardScreen } from './DashboardScreen';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const param = (params: Record<string, string | string[] | undefined>, key: string) =>
  typeof params[key] === 'string' ? params[key] : undefined;

/** Dashboard (specs/001 US3, ui-dashboard.md §1): server-renders the first snapshot for the remembered project and `?window=`, then the client screen keeps it fresh. */
export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const project = await selectedProject(param(params, 'project'));
  const window = selectedWindow(param(params, 'window'));
  const me = (await getMe())!;
  const initial = await loadSnapshot(project, window);
  if (!initial) {
    return (
      <Notice tone="error" action={<a href="/dashboard">Retry</a>}>
        Couldn&apos;t load the dashboard.
      </Notice>
    );
  }
  return <DashboardScreen me={me} initial={initial} />;
}

async function loadSnapshot(project: string, window: ReturnType<typeof selectedWindow>) {
  try {
    return await getDashboardSnapshot(project, window);
  } catch (e) {
    // The remembered project is no longer visible (or was never a project): fall back to all projects.
    if (e instanceof ApiError && (e.status === 404 || e.status === 400))
      return getDashboardSnapshot('all', window).catch(() => null);
    return null;
  }
}
