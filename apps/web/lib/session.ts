import 'server-only';
import type {
  ApprovalCenterSnapshot,
  DashboardSnapshot,
  InboxSnapshot,
  Me,
  Tab,
  WindowKey,
} from '@cdevi/contracts';
import { WINDOW_KEYS } from '@cdevi/contracts/dashboard-model';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { ApiError, apiFetch } from './api';
import { PROJECT_COOKIE } from './navigation';

export async function cookieHeader(): Promise<string> {
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

/** `?window=` as a WindowKey; anything else (missing, unknown) is the default `7d` (ui-dashboard.md §1). */
export function selectedWindow(explicit?: string | undefined): WindowKey {
  return (WINDOW_KEYS as readonly string[]).includes(explicit ?? '')
    ? (explicit as WindowKey)
    : '7d';
}

/** Dashboard snapshot per (project, window) per request (specs/001 US3; ui-dashboard.md §1). */
export const getDashboardSnapshot = cache(
  async (project: string, window: WindowKey): Promise<DashboardSnapshot> => {
    const qs = new URLSearchParams({ project, window });
    return apiFetch<DashboardSnapshot>(`/api/dashboard?${qs}`, {
      cookie: await cookieHeader(),
    });
  },
);

/** Approval Center snapshot per project per request; layout (nav count) and page share it (specs/001 US2 scenario 6). */
export const getApprovalCenterSnapshot = cache(
  async (project: string): Promise<ApprovalCenterSnapshot> => {
    const qs = new URLSearchParams({ project });
    return apiFetch<ApprovalCenterSnapshot>(`/api/approvals?${qs}`, {
      cookie: await cookieHeader(),
    });
  },
);
