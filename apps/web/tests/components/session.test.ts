import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { populated } from '../fixtures/dashboard';

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ cookie: 'cdevi_session=abc' }),
  cookies: async () => ({ get: () => undefined }),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('Dashboard server session helpers (specs/001 US3; ui-dashboard.md §1)', () => {
  it('FR-023 selectedWindow accepts 24h/7d/30d and falls back to 7d for missing or unknown values', async () => {
    const { selectedWindow } = await import('../../lib/session');
    expect(selectedWindow('24h')).toBe('24h');
    expect(selectedWindow('7d')).toBe('7d');
    expect(selectedWindow('30d')).toBe('30d');
    expect(selectedWindow(undefined)).toBe('7d');
    expect(selectedWindow('')).toBe('7d');
    expect(selectedWindow('1y')).toBe('7d');
  });

  it('FR-025 getDashboardSnapshot fetches /api/dashboard for the project and window with the request cookie', async () => {
    const { getDashboardSnapshot } = await import('../../lib/session');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(populated), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const snapshot = await getDashboardSnapshot(populated.project, '7d');
    expect(snapshot.counts.activeWorkflows.value).toBe(18);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/dashboard\?project=[^&]+&window=7d$/);
    expect(new URL(url, 'http://localhost').searchParams.get('project')).toBe(populated.project);
    expect(new Headers(init.headers).get('cookie')).toBe('cdevi_session=abc');
  });
});
