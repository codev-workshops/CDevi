/**
 * Typed fixtures for the Reviews list and the PR Review Center (specs/001 US6). Mirrors the seeded pull request
 * `pr-1821` (#1821 "PAY-1391 Refund processing") of packages/db/src/seed/reviews.ts: one COMPLETE cycle-3 review
 * with seven lanes and seven findings (one per lane; 5 OPEN, 1 FIXED, 1 DISMISSED; finding 2 carries a
 * restricted evidence ref) and the three fix-loop review cycles.
 */
import type {
  EvidenceRef,
  FindingActionResult,
  LaneResult,
  PullRequestReviewView,
  ReviewCycleView,
  ReviewFindingView,
  ReviewListItem,
  ReviewListResponse,
  WorkflowPullRequestView,
} from '@cdevi/contracts';

export const NOW = '2026-09-14T09:00:00.000Z';
const minsAgo = (m: number) => new Date(new Date(NOW).getTime() - m * 60_000).toISOString();
const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

export const PROJECT = { id: id(0x100), key: 'payments-api', name: 'Payments API' };
export const OTHER_PROJECT = { id: id(0x101), key: 'web-portal', name: 'Web Portal' };
export const ENGINEER = { id: id(0x201), name: 'Engineer 1' };

export const PR_ID = id(0x600);
export const WORKFLOW_ID = id(0x302);
export const REQUIREMENT_ID = id(0x401);
const REPO = 'https://github.com/acme/payments-api';

export const PULL_REQUEST: PullRequestReviewView['pullRequest'] = {
  id: PR_ID,
  externalId: 'pr-1821',
  number: 1821,
  title: 'PAY-1391 Refund processing',
  href: `${REPO}/pull/1821`,
  status: 'OPEN',
};

export const WORKFLOW: PullRequestReviewView['workflow'] = {
  id: WORKFLOW_ID,
  name: 'Add rate limiting to /api/auth',
  href: `/workflows/${WORKFLOW_ID}`,
};

export const REQUIREMENT: NonNullable<PullRequestReviewView['requirement']> = {
  id: REQUIREMENT_ID,
  title: 'Refund processing for captured payments',
  href: `/requirements/${REQUIREMENT_ID}`,
};

const blob = (path: string, line: number): EvidenceRef => ({
  kind: 'file',
  label: `${path}:${line}`,
  href: `${REPO}/blob/pay-1391-refunds/src/main/java/com/acme/payments/${path}#L${line}`,
  locator: `${path}:${line}`,
  accessible: true,
});

export const FINDING_IDS = [1, 2, 3, 4, 5, 6, 7].map((n) => id(0x700 + n));

const base = (position: number, over: Partial<ReviewFindingView>): ReviewFindingView => ({
  id: FINDING_IDS[position - 1]!,
  externalId: `find-1821-${position}`,
  position,
  lane: 'general',
  severity: 'INFO',
  blocking: 'SUGGESTION',
  title: `Finding ${position}`,
  description: `Description ${position}`,
  impact: `Impact ${position}`,
  evidence: [],
  recommendedFix: `Fix ${position}`,
  state: 'OPEN',
  dismissedReason: null,
  dismissedBy: null,
  dismissedAt: null,
  fixCycleId: null,
  issueRequestedAt: null,
  ...over,
});

export const CYCLE_IDS = [1, 2, 3].map((n) => id(0x800 + n));

export const FINDINGS: ReviewFindingView[] = [
  base(1, {
    lane: 'correctness',
    severity: 'MEDIUM',
    blocking: 'NON_BLOCKING',
    title: 'Null `originalPayment` not handled in `RefundService.refund()`',
    description:
      'RefundService.refund() dereferences the originalPayment returned by the repository without a null check.',
    impact: 'Refunds against an unknown payment fail with an opaque 500 instead of a 404.',
    evidence: [blob('RefundService.java', 112)],
    recommendedFix: 'Return 404 payment_not_found when the repository lookup is empty.',
  }),
  base(2, {
    lane: 'security',
    severity: 'CRITICAL',
    blocking: 'BLOCKING',
    title: 'Refund endpoint does not verify authorization against the original payment owner',
    description:
      'POST /refunds loads the payment by id from the request body and issues the refund without checking ownership.',
    impact: "A user may potentially refund another user's payment.",
    evidence: [
      blob('RefundController.java', 84),
      { kind: 'url', label: 'Threat model — refunds', accessible: false },
    ],
    recommendedFix: 'Validate payment ownership before processing.',
  }),
  base(3, {
    lane: 'dependencies',
    severity: 'LOW',
    blocking: 'SUGGESTION',
    title: 'Pin `payments-sdk` to the tested minor',
    description: 'build.gradle declares payments-sdk with an open minor range.',
    impact:
      'A future minor of payments-sdk could change refund semantics without a code change here.',
    evidence: [
      {
        kind: 'file',
        label: 'build.gradle:41',
        href: `${REPO}/blob/pay-1391-refunds/build.gradle#L41`,
        locator: 'build.gradle:41',
        accessible: true,
      },
    ],
    recommendedFix: 'Pin payments-sdk to 3.4.+ and let Renovate propose upgrades.',
  }),
  base(4, {
    lane: 'edge_cases',
    severity: 'HIGH',
    blocking: 'BLOCKING',
    title: 'Partial refund amount is not bounded by the captured amount',
    description: 'RefundService.refund() accepts any positive amount.',
    impact: 'A partial refund can exceed what was captured.',
    evidence: [blob('RefundService.java', 140)],
    recommendedFix: 'Reject requests where requested > captured − refunded.',
    state: 'FIXED',
    fixCycleId: CYCLE_IDS[2]!,
  }),
  base(5, {
    lane: 'testing',
    severity: 'MEDIUM',
    blocking: 'NON_BLOCKING',
    title: 'No negative test for refunds after the 90-day window',
    description: 'RefundServiceTest covers refunds inside the window only.',
    impact: 'A regression in the window check would ship undetected.',
    evidence: [blob('RefundServiceTest.java', 12)],
    recommendedFix: 'Add a test asserting a 91-day-old payment is rejected.',
    state: 'DISMISSED',
    dismissedReason: 'Covered by the payments-ledger contract suite; tracked in PAY-1402.',
    dismissedBy: { id: ENGINEER.id, displayName: ENGINEER.name },
    dismissedAt: minsAgo(40),
  }),
  base(6, {
    lane: 'architecture',
    severity: 'LOW',
    blocking: 'SUGGESTION',
    title: 'Move `RefundPolicy` next to the other payment policies',
    description: 'RefundPolicy lives under controller/.',
    impact: 'Module boundaries of the payments package become harder to read.',
    evidence: [blob('RefundPolicy.java', 1)],
    recommendedFix: 'Move RefundPolicy to the policy package.',
  }),
  base(7, {
    lane: 'general',
    severity: 'INFO',
    blocking: 'SUGGESTION',
    title: 'Inconsistent naming: `refundAmt` vs `refundAmount`',
    description: 'RefundRequest uses refundAmt while RefundService uses refundAmount.',
    impact: 'Minor readability inconsistency.',
    evidence: [blob('RefundRequest.java', 18)],
    recommendedFix: 'Rename refundAmt to refundAmount.',
  }),
];

export const LANES: LaneResult[] = [
  { lane: 'correctness', status: 'WARN', summary: 'One unchecked null path in RefundService' },
  { lane: 'security', status: 'FAIL', summary: 'Authorization gap on the refund endpoint' },
  { lane: 'dependencies', status: 'PASS', summary: 'No new dependencies' },
  { lane: 'edge_cases', status: 'PASS', summary: 'Partial refund bound fixed in cycle 3' },
  { lane: 'testing', status: 'PASS', summary: 'Refund paths covered' },
  { lane: 'architecture', status: 'PASS', summary: 'Follows the payments module boundaries' },
  { lane: 'general', status: 'PASS', summary: 'Minor naming inconsistencies only' },
];

const cycle = (
  n: number,
  counts: { findingsCount: number; fixedCount: number; remainingCount: number },
  over: Partial<ReviewCycleView> = {},
): ReviewCycleView => ({
  id: CYCLE_IDS[n - 1] ?? id(0x800 + n),
  cycleNumber: n,
  ...counts,
  iteration: n,
  maxIterations: 5,
  state: 'COMPLETED',
  requestedBy: null,
  requestedByAgent: 'Review Agent',
  startedAt: minsAgo(60 - (n - 1) * 3),
  finishedAt: minsAgo(57 - (n - 1) * 3),
  ...over,
});

export const CYCLES: ReviewCycleView[] = [
  cycle(1, { findingsCount: 12, fixedCount: 8, remainingCount: 4 }),
  cycle(2, { findingsCount: 9, fixedCount: 6, remainingCount: 3 }),
  cycle(3, { findingsCount: 7, fixedCount: 6, remainingCount: 1 }),
];

/** Seeded pull request #1821: 5 OPEN findings, one of them BLOCKING → not ready for merge. */
export function reviewView(over: Partial<PullRequestReviewView> = {}): PullRequestReviewView {
  return {
    pullRequest: PULL_REQUEST,
    workflow: WORKFLOW,
    requirement: REQUIREMENT,
    latestReview: {
      id: id(0x900),
      cycleNumber: 3,
      status: 'COMPLETE',
      lanes: LANES,
      startedAt: minsAgo(54),
      finishedAt: minsAgo(50),
    },
    findings: FINDINGS,
    cycles: CYCLES,
    readyForMerge: false,
    blockingOpenCount: 1,
    ...over,
  };
}

/** Same PR after the blocking finding was dismissed: ready for merge approval. */
export function readyView(): PullRequestReviewView {
  return reviewView({
    findings: FINDINGS.map((f) =>
      f.position === 2
        ? {
            ...f,
            state: 'DISMISSED',
            dismissedReason: 'False positive: the scope check lives in the gateway.',
            dismissedBy: { id: ENGINEER.id, displayName: ENGINEER.name },
            dismissedAt: minsAgo(5),
          }
        : f,
    ),
    readyForMerge: true,
    blockingOpenCount: 0,
  });
}

/** `FindingActionResult` for Apply Fix on finding 2: a new RUNNING cycle #4 with 5 open findings. */
export function applyFixResult(): FindingActionResult {
  const finding = FINDINGS[1]!;
  return {
    finding: { ...finding, state: 'FIX_REQUESTED', fixCycleId: id(0x804) },
    cycle: cycle(
      4,
      { findingsCount: 5, fixedCount: 0, remainingCount: 5 },
      {
        id: id(0x804),
        iteration: 4,
        state: 'RUNNING',
        requestedBy: { id: ENGINEER.id, displayName: ENGINEER.name },
        requestedByAgent: null,
        startedAt: NOW,
        finishedAt: null,
      },
    ),
    readyForMerge: false,
    blockingOpenCount: 1,
  };
}

export function dismissResult(reason: string): FindingActionResult {
  const finding = FINDINGS[1]!;
  return {
    finding: {
      ...finding,
      state: 'DISMISSED',
      dismissedReason: reason,
      dismissedBy: { id: ENGINEER.id, displayName: ENGINEER.name },
      dismissedAt: NOW,
    },
    readyForMerge: true,
    blockingOpenCount: 0,
  };
}

export function createIssueResult(position = 1): FindingActionResult {
  const finding = FINDINGS[position - 1]!;
  return {
    finding: { ...finding, state: 'ISSUE_REQUESTED', issueRequestedAt: NOW },
    readyForMerge: false,
    blockingOpenCount: 1,
  };
}

export function listItem(over: Partial<ReviewListItem> = {}): ReviewListItem {
  return {
    ...PULL_REQUEST,
    project: PROJECT,
    workflow: WORKFLOW,
    reviewStatus: 'COMPLETE',
    openFindingsCount: 5,
    blockingOpenCount: 1,
    readyForMerge: false,
    reviewHref: `/reviews/${PR_ID}`,
    updatedAt: minsAgo(50),
    ...over,
  };
}

export const READY_PR_ID = id(0x601);

export function listPopulated(): ReviewListResponse {
  return {
    items: [
      listItem(),
      listItem({
        id: READY_PR_ID,
        externalId: 'pr-1822',
        number: 1822,
        title: 'PAY-1402 Ledger contract suite',
        href: `${REPO}/pull/1822`,
        status: 'MERGED',
        reviewStatus: 'RUNNING',
        openFindingsCount: 0,
        blockingOpenCount: 0,
        readyForMerge: true,
        reviewHref: `/reviews/${READY_PR_ID}`,
        updatedAt: minsAgo(10),
      }),
    ],
    nextCursor: null,
  };
}

export const listEmpty = (): ReviewListResponse => ({ items: [], nextCursor: null });

/** Workflow Detail's `pullRequest` for the same PR. */
export function workflowPullRequest(
  over: Partial<WorkflowPullRequestView> = {},
): WorkflowPullRequestView {
  return {
    id: PR_ID,
    number: 1821,
    title: 'PAY-1391 Refund processing',
    href: `${REPO}/pull/1821`,
    reviewStatus: 'COMPLETE',
    readyForMerge: false,
    blockingOpenCount: 1,
    reviewHref: `/reviews/${PR_ID}`,
    ...over,
  };
}
