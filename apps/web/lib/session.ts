import 'server-only';
import type { InboxSnapshot, Me, Tab } from '@cdevi/contracts';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { ApiError, apiFetch } from './api';
import { PROJECT_COOKIE } from './navigation';

async function cookieHeader(): Promise<string> {
  return (await headers()).get('cookie') ?? '';
}

/** Current user or null when not signed in / session expired. Cached per request. */
export const getMe = cache(async (): Promise<Me | null> => {
  try {
    return await apiFetch<Me>('/api/auth/me', { cookie: await cookieHeader() });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
});

/** The project scope chosen in the selector, persisted as a cookie so the layout and the page agree. */
export async function selectedProject(explicit?: string | undefined): Promise<string> {
  if (explicit) return explicit;
  return (await cookies()).get(PROJECT_COOKIE)?.value ?? 'all';
}

/** One snapshot per (tab, project) per request; layout and page share it (SC-004). */
export const getInboxSnapshot = cache(async (tab: Tab, project: string): Promise<InboxSnapshot> => {
  const qs = new URLSearchParams({ tab, project });
  return apiFetch<InboxSnapshot>(`/api/inbox?${qs}`, { cookie: await cookieHeader() });
});
