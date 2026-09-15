import type { FastifyInstance } from 'fastify';
import { expect } from 'vitest';
import { asIngest, iso, MIN, plus, uniq } from './helpers';

export const STAGES = [
  'Requirement',
  'Analysis',
  'Architecture',
  'Implementation',
  'Testing',
  'Review',
  'PR',
] as const;
export const REVIEW_STAGE_POSITION = 6;
let nextPullRequestNumber = 4000;

export const lanes = (over: Record<string, 'PASS' | 'WARN' | 'FAIL'> = {}) =>
  (
    [
      'correctness',
      'security',
      'dependencies',
      'edge_cases',
      'testing',
      'architecture',
      'general',
    ] as const
  ).map((lane) => ({ lane, status: over[lane] ?? 'PASS' }));

export const evidence = (over: Record<string, unknown> = {}) => ({
  kind: 'file',
  label: 'src/refunds/service.ts',
  href: 'https://git.cdevi.demo/payments-api/blob/main/src/refunds/service.ts',
  locator: 'src/refunds/service.ts:42',
  accessible: true,
  ...over,
});

export const finding = (position: number, over: Record<string, unknown> = {}) => ({
  externalId: `f-${position}`,
  position,
  lane: 'correctness',
  severity: 'HIGH',
  blocking: 'BLOCKING',
  title: `Finding ${position}`,
  description: `Description ${position}.`,
  impact: `Impact ${position}.`,
  evidence: [evidence()],
  recommendedFix: `Fix ${position}.`,
  ...over,
});

/** Two blocking OPEN, one non-blocking OPEN, one suggestion already FIXED → blockingOpenCount 2, not ready. */
export const defaultFindings = (prefix: string) => [
  finding(1, { externalId: `${prefix}-f1`, lane: 'security', severity: 'CRITICAL' }),
  finding(2, { externalId: `${prefix}-f2` }),
  finding(3, { externalId: `${prefix}-f3`, blocking: 'NON_BLOCKING', severity: 'MEDIUM' }),
  finding(4, {
    externalId: `${prefix}-f4`,
    blocking: 'SUGGESTION',
    severity: 'LOW',
    status: 'fixed',
    evidence: [evidence({ href: undefined, accessible: false })],
  }),
];

export interface ReviewFixture {
  workflowExternalId: string;
  workflowId: string;
  pullRequestExternalId: string;
  pullRequestId: string;
  reviewId: string;
  findingExternalIds: string[];
}

export interface ReviewFixtureOptions {
  projectKey?: string;
  reviewStageState?: string;
  findings?: ReturnType<typeof finding>[];
  reviewStatus?: 'RUNNING' | 'COMPLETE' | 'FAILED';
  withReview?: boolean;
  /** Position of the stage the pull request links as its Review stage (default 6); `null` leaves it unlinked. */
  reviewStagePosition?: number | null;
}

/**
 * A fresh workflow with the seven S-500 stages (Review at position 6), one pull request and one cycle-1 review,
 * created through the ingest routes so each test owns its rows and the seeded `pr-1821` stays untouched.
 */
export async function reviewFixture(
  app: FastifyInstance,
  opts: ReviewFixtureOptions = {},
): Promise<ReviewFixture> {
  const workflowExternalId = uniq('us6-w');
  const pullRequestExternalId = uniq('us6-pr');
  const put = (url: string, payload: Record<string, unknown>) =>
    app.inject(asIngest({ method: 'PUT', url, payload }));

  const w = await put(`/api/ingest/workflows/${workflowExternalId}`, {
    projectKey: opts.projectKey ?? 'payments-api',
    title: 'US6 fixture workflow',
    state: 'RUNNING',
    observedAt: iso(plus(-60 * MIN)),
  });
  expect(w.statusCode, w.body).toBe(200);
  const workflowId = (w.json() as { id: string }).id;
  for (const [i, name] of STAGES.entries()) {
    const position = i + 1;
    const target =
      position < REVIEW_STAGE_POSITION
        ? 'COMPLETED'
        : position === REVIEW_STAGE_POSITION
          ? (opts.reviewStageState ?? 'WAITING_FOR_HUMAN')
          : 'QUEUED';
    const states = target === 'QUEUED' || target === 'RUNNING' ? [target] : ['RUNNING', target];
    for (const [k, state] of states.entries()) {
      const s = await put(`/api/ingest/workflows/${workflowExternalId}/stages/${position}`, {
        name,
        state,
        observedAt: iso(plus(-55 * MIN + position * MIN + k * 10_000)),
        count: STAGES.length,
      });
      expect(s.statusCode, s.body).toBe(200);
    }
  }

  const pr = await put(`/api/ingest/pull-requests/${pullRequestExternalId}`, {
    number: nextPullRequestNumber++,
    title: 'US6 fixture pull request',
    href: 'https://git.cdevi.demo/payments-api/pull/4001',
    status: 'OPEN',
    workflowExternalId,
    reviewStagePosition: opts.reviewStagePosition === undefined ? 6 : opts.reviewStagePosition,
    observedAt: iso(plus(-40 * MIN)),
  });
  expect(pr.statusCode, pr.body).toBe(200);
  const pullRequestId = (pr.json() as { id: string }).id;

  const findings = opts.findings ?? defaultFindings(pullRequestExternalId);
  let reviewId = '';
  if (opts.withReview !== false) {
    const r = await put(`/api/ingest/pull-requests/${pullRequestExternalId}/reviews/1`, {
      externalId: `${pullRequestExternalId}-rev-1`,
      status: opts.reviewStatus ?? 'COMPLETE',
      lanes: lanes({ security: 'FAIL', correctness: 'WARN' }),
      findings,
      startedAt: iso(plus(-35 * MIN)),
      finishedAt: iso(plus(-31 * MIN)),
      observedAt: iso(plus(-30 * MIN)),
    });
    expect(r.statusCode, r.body).toBe(200);
    reviewId = (r.json() as { id: string }).id;
  }
  return {
    workflowExternalId,
    workflowId,
    pullRequestExternalId,
    pullRequestId,
    reviewId,
    findingExternalIds: findings.map((f) => f.externalId),
  };
}
