/**
 * specs/001 US6 — pure, zod-free review rules shared by @cdevi/api and @cdevi/web
 * (imported as `@cdevi/contracts/review-model` so the browser bundle carries no Zod).
 * Vocabulary mirrors packages/db/migrations/0007_reviews.sql; the Zod twins live in ./reviews.
 */
import { InvalidCursorError } from './read-model';

export const REVIEW_LANES = [
  'correctness',
  'security',
  'dependencies',
  'edge_cases',
  'testing',
  'architecture',
  'general',
] as const;
export type ReviewLane = (typeof REVIEW_LANES)[number];

export const REVIEW_LANE_WORDS: Record<ReviewLane, string> = {
  correctness: 'Correctness',
  security: 'Security',
  dependencies: 'Dependencies',
  edge_cases: 'Edge Cases',
  testing: 'Testing',
  architecture: 'Architecture',
  general: 'General',
};
export const laneWord = (lane: ReviewLane): string => REVIEW_LANE_WORDS[lane];

export const LANE_STATUSES = ['PASS', 'WARN', 'FAIL'] as const;
export type LaneStatus = (typeof LANE_STATUSES)[number];
const LANE_STATUS_WORDS: Record<LaneStatus, string> = { PASS: 'Pass', WARN: 'Warn', FAIL: 'Fail' };
export const laneStatusWord = (status: LaneStatus): string => LANE_STATUS_WORDS[status];

export const PULL_REQUEST_STATUSES = ['OPEN', 'MERGED', 'CLOSED'] as const;
export type PullRequestStatus = (typeof PULL_REQUEST_STATUSES)[number];
const PULL_REQUEST_STATUS_WORDS: Record<PullRequestStatus, string> = {
  OPEN: 'open',
  MERGED: 'merged',
  CLOSED: 'closed',
};
export const pullRequestStatusWord = (status: PullRequestStatus): string =>
  PULL_REQUEST_STATUS_WORDS[status];

export const REVIEW_STATUSES = ['RUNNING', 'COMPLETE', 'FAILED'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
const REVIEW_STATUS_WORDS: Record<ReviewStatus, string> = {
  RUNNING: 'AI review running',
  COMPLETE: 'AI review complete',
  FAILED: 'AI review failed',
};
export const reviewStatusWord = (status: ReviewStatus): string => REVIEW_STATUS_WORDS[status];

export const FINDING_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_BLOCKING_CLASSES = ['BLOCKING', 'NON_BLOCKING', 'SUGGESTION'] as const;
export type FindingBlocking = (typeof FINDING_BLOCKING_CLASSES)[number];

export const FINDING_STATES = [
  'OPEN',
  'FIX_REQUESTED',
  'FIXED',
  'DISMISSED',
  'ISSUE_REQUESTED',
] as const;
export type FindingState = (typeof FINDING_STATES)[number];
const FINDING_STATE_WORDS: Record<FindingState, string> = {
  OPEN: 'Open',
  FIX_REQUESTED: 'Fix requested',
  FIXED: 'Fixed',
  DISMISSED: 'Dismissed',
  ISSUE_REQUESTED: 'Issue requested',
};
export const findingStateWord = (state: FindingState): string => FINDING_STATE_WORDS[state];

export const REVIEW_CYCLE_STATES = ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type ReviewCycleState = (typeof REVIEW_CYCLE_STATES)[number];
const CYCLE_STATE_WORDS: Record<ReviewCycleState, string> = {
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};
export const cycleStateWord = (state: ReviewCycleState): string => CYCLE_STATE_WORDS[state];

/** `Pill` variant names of @cdevi/design-system (DESIGN.md §161). */
export type PillVariant = 'blocked' | 'fail' | 'wait' | 'needs-you' | 'neutral';
export interface PillWords {
  word: string;
  variant: PillVariant;
}
const SEVERITY_VARIANTS: Record<FindingSeverity, PillVariant> = {
  CRITICAL: 'blocked',
  HIGH: 'fail',
  MEDIUM: 'wait',
  LOW: 'neutral',
  INFO: 'neutral',
};
export const severityPill = (severity: FindingSeverity): PillWords => ({
  word: severity.toLowerCase(),
  variant: SEVERITY_VARIANTS[severity],
});

/** The design system spells the middle class `NON-BLOCKING` (`FindingRow blocking`); the contract uses `NON_BLOCKING`. */
export type DesignBlocking = 'BLOCKING' | 'NON-BLOCKING' | 'SUGGESTION';
export const toDesignBlocking = (blocking: FindingBlocking): DesignBlocking =>
  blocking === 'NON_BLOCKING' ? 'NON-BLOCKING' : blocking;
export const blockingPill = (blocking: FindingBlocking): PillWords => ({
  word: toDesignBlocking(blocking).toLowerCase(),
  variant: blocking === 'BLOCKING' ? 'needs-you' : 'neutral',
});

/** The subset of a finding the merge-readiness and lane rules need. */
export interface FindingLike {
  lane: ReviewLane;
  blocking: FindingBlocking;
  state: FindingState;
}

/** A finding still counts against the pull request while it is OPEN or a fix is in flight. */
export const isFindingOpen = (state: FindingState): boolean =>
  state === 'OPEN' || state === 'FIX_REQUESTED';

const isBlockingOpen = (f: FindingLike) => f.blocking === 'BLOCKING' && isFindingOpen(f.state);

/** FR-022: derived, never stored — no BLOCKING finding may be OPEN or FIX_REQUESTED. */
export const blockingOpenCount = (findings: readonly FindingLike[]): number =>
  findings.filter(isBlockingOpen).length;
export const readyForMerge = (findings: readonly FindingLike[]): boolean =>
  blockingOpenCount(findings) === 0;

/** The always-visible Review Center notice while the PR is not ready; null once it is. */
export function mergeReadinessNotice(findings: readonly FindingLike[]): string | null {
  const n = blockingOpenCount(findings);
  if (n === 0) return null;
  return `Not ready for merge approval — ${n} blocking ${n === 1 ? 'finding' : 'findings'} open`;
}

/** FAIL when an open BLOCKING finding sits in the lane, WARN when only open NON_BLOCKING ones do, else PASS — open SUGGESTIONs never change a lane. */
export function laneStatusFromFindings(
  lane: ReviewLane,
  findings: readonly FindingLike[],
): LaneStatus {
  const open = findings.filter((f) => f.lane === lane && isFindingOpen(f.state));
  if (open.some((f) => f.blocking === 'BLOCKING')) return 'FAIL';
  return open.some((f) => f.blocking === 'NON_BLOCKING') ? 'WARN' : 'PASS';
}

export interface CycleLike {
  findingsCount: number;
  fixedCount: number;
  remainingCount: number;
  iteration: number;
  maxIterations: number;
}

/** `Progress` input for a fix cycle: fixed findings out of the findings the cycle started with. */
export const cycleProgress = (cycle: CycleLike): { value: number; max: number } => ({
  value: Math.min(cycle.fixedCount, cycle.findingsCount),
  max: cycle.findingsCount,
});
export const iterationWord = (cycle: CycleLike): string =>
  `Iteration ${cycle.iteration} of ${cycle.maxIterations}`;

export type ReviewActorRole = 'administrator' | 'approver' | 'engineer' | 'viewer';
/** FR-032: viewers are read-only; every other role may dismiss, apply a fix or request an issue. */
export const canActOnFinding = (role: ReviewActorRole): boolean => role !== 'viewer';
/** Actions are offered on OPEN findings only; every other state is already resolved or in flight. */
export const canActOnFindingState = (state: FindingState): boolean => state === 'OPEN';

export const reviewHref = (pullRequestId: string): string => `/reviews/${pullRequestId}`;

export const REVIEWS_PAGE_SIZE = 50;
export type ReviewCursor = { updatedAt: string; id: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const b64url = {
  encode: (s: string) => Buffer.from(s, 'utf8').toString('base64url'),
  decode: (s: string) => Buffer.from(s, 'base64url').toString('utf8'),
};

export const encodeReviewCursor = (k: ReviewCursor): string =>
  b64url.encode(JSON.stringify(['reviews', k.updatedAt, k.id]));

export function decodeReviewCursor(cursor: string): ReviewCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(b64url.decode(cursor));
  } catch {
    throw new InvalidCursorError();
  }
  if (!Array.isArray(parsed) || parsed.length !== 3 || parsed[0] !== 'reviews')
    throw new InvalidCursorError();
  const [, updatedAt, id] = parsed as [unknown, unknown, unknown];
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt)))
    throw new InvalidCursorError();
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new InvalidCursorError();
  return { updatedAt, id };
}
