import type { RecordView } from '@cdevi/contracts';
import { headers } from 'next/headers';
import { ApiError, apiFetch } from '../../lib/api';
import { Button, Notice } from '../../lib/ds';
import { RecordStub } from './RecordStub';

/** Shared server renderer for /approvals/[id] and /workflows/[id]. 403 and 404 look identical (spec edge case). */
export async function renderRecord(
  kind: 'approvals' | 'workflows',
  id: string,
  searchParams: Record<string, string | string[] | undefined>,
) {
  const back = new URLSearchParams();
  if (typeof searchParams['tab'] === 'string') back.set('tab', searchParams['tab']);
  if (typeof searchParams['project'] === 'string') back.set('project', searchParams['project']);
  back.set('focus', 'tabs');
  const backHref = `/inbox?${back}`;
  try {
    const view = await apiFetch<RecordView>(
      `/api/inbox/records/${kind}/${encodeURIComponent(id)}`,
      { cookie: (await headers()).get('cookie') ?? '' },
    );
    return (
      <RecordStub view={view} kind={kind} backHref={backHref} now={new Date().toISOString()} />
    );
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
      return (
        <>
          <Notice tone="error">This item isn&apos;t available to you.</Notice>
          <Button variant="ghost" href={backHref}>
            Back to Inbox
          </Button>
        </>
      );
    }
    throw e;
  }
}
