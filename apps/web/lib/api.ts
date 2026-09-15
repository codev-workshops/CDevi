import type {
  DismissFindingBody,
  FindingActionResult,
  Problem,
  PullRequestReviewView,
  PullRequestStatus,
  ReviewListResponse,
} from '@cdevi/contracts';

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

// --- specs/001 US6 Reviews (FR-020, FR-021). Browser-safe: types only from the contracts.

export interface ReviewsQuery {
  project: string;
  state?: PullRequestStatus | undefined;
  cursor?: string | undefined;
}

export function reviewsPath(query: ReviewsQuery): string {
  const qs = new URLSearchParams({ project: query.project });
  if (query.state) qs.set('state', query.state);
  if (query.cursor) qs.set('cursor', query.cursor);
  return `/api/reviews?${qs}`;
}

/** Bounded (50) keyset page of pull requests under review. */
export const getReviews = (query: ReviewsQuery, init?: ApiFetchInit) =>
  apiFetch<ReviewListResponse>(reviewsPath(query), init);

/** The Review Center read model: latest review, findings and cycles for one pull request. */
export const getPullRequestReview = (pullRequestId: string, init?: ApiFetchInit) =>
  apiFetch<PullRequestReviewView>(`/api/reviews/${encodeURIComponent(pullRequestId)}`, init);

const findingActionPath = (pullRequestId: string, findingId: string, action: string) =>
  `/api/reviews/${encodeURIComponent(pullRequestId)}/findings/${encodeURIComponent(findingId)}/${action}`;

export const dismissFinding = (pullRequestId: string, findingId: string, reason: string) =>
  apiFetch<FindingActionResult>(findingActionPath(pullRequestId, findingId, 'dismiss'), {
    method: 'POST',
    body: JSON.stringify({ reason } satisfies DismissFindingBody),
  });

export const applyFix = (pullRequestId: string, findingId: string) =>
  apiFetch<FindingActionResult>(findingActionPath(pullRequestId, findingId, 'fix'), {
    method: 'POST',
    body: JSON.stringify({}),
  });

export const createIssue = (pullRequestId: string, findingId: string) =>
  apiFetch<FindingActionResult>(findingActionPath(pullRequestId, findingId, 'issue'), {
    method: 'POST',
    body: JSON.stringify({}),
  });
