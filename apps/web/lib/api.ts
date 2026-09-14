import type { Problem } from '@cdevi/contracts';

export const API_TIMEOUT_MS = 5_000;

/** Thrown for any non-2xx response; carries the Problem body when the API sent one. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly problem: Problem | null,
  ) {
    super(problem?.detail ?? problem?.title ?? `Request failed (${status})`);
    this.name = 'ApiError';
  }
}

export interface ApiFetchInit extends Omit<RequestInit, 'signal'> {
  /** Cookie header to forward (server components); omitted in the browser where cookies are first-party. */
  cookie?: string | undefined;
}

/**
 * Base URL: in the browser `/api` is proxied by Next; on the server we talk to the API origin directly.
 */
export function apiBase(): string {
  if (typeof window !== 'undefined') return '';
  return process.env['API_ORIGIN'] ?? 'http://localhost:3001';
}

/** Typed fetch with a 5 s timeout (Constitution IV) and Problem parsing. No automatic retries. */
export async function apiFetch<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { cookie, headers, ...rest } = init;
  const res = await fetch(`${apiBase()}${path}`, {
    ...rest,
    headers: {
      accept: 'application/json',
      ...(rest.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
    credentials: 'same-origin',
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) {
    let problem: Problem | null = null;
    if (res.headers.get('content-type')?.includes('json'))
      problem = (await res.json().catch(() => null)) as Problem | null;
    throw new ApiError(res.status, problem);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
