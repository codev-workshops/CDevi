/**
 * specs/001 US6 review seed (plan "Data model — 0007_reviews.sql"): pull request #1821 "PAY-1391 Refund
 * processing" on the showcase workflow `s500-001` (payments-api), one COMPLETE review (cycle 3) with seven
 * lanes and seven findings — one per lane, every finding state row rendering exercised — and the three
 * fix-loop cycles of UI spec §22. Lanes are runtime-reported (stored as authored, not derived); readiness is
 * derived from the findings at read time.
 */
import type {
  EvidenceRef,
  FindingBlocking,
  FindingSeverity,
  FindingState,
  LaneResult,
  ReviewCycleState,
  ReviewLane,
  ReviewStatus,
} from '@cdevi/contracts';
import { buildS500, SHOWCASE_WAITING } from './s500';

const MIN = 60_000;

export interface SeedPullRequest {
  externalId: string;
  workflow: string;
  number: number;
  title: string;
  href: string;
  status: 'OPEN' | 'MERGED' | 'CLOSED';
  observedAt: Date;
}

export interface SeedReviewFinding {
  externalId: string;
  position: number;
  lane: ReviewLane;
  severity: FindingSeverity;
  blocking: FindingBlocking;
  title: string;
  description: string;
  impact: string;
  evidence: EvidenceRef[];
  recommendedFix: string;
  state: FindingState;
  /** Demo user email; resolved to the row id at insert. */
  dismissedBy: string | null;
  dismissedReason: string | null;
  dismissedAt: Date | null;
  /** Cycle number the fix landed in; resolved to review_cycles.id at insert. */
  fixCycle: number | null;
}

export interface SeedReview {
  externalId: string;
  cycleNumber: number;
  status: ReviewStatus;
  lanes: LaneResult[];
  startedAt: Date;
  finishedAt: Date | null;
  /** Agent run external id; resolved at insert. */
  agentRun: string | null;
  observedAt: Date;
  findings: SeedReviewFinding[];
}

export interface SeedReviewCycle {
  cycleNumber: number;
  findingsCount: number;
  fixedCount: number;
  remainingCount: number;
  iteration: number;
  maxIterations: number;
  state: ReviewCycleState;
  requestedByAgent: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  agentRun: string | null;
  observedAt: Date;
}

export interface ReviewSeed {
  pullRequest: SeedPullRequest;
  review: SeedReview;
  cycles: SeedReviewCycle[];
}

/** Ids and counts the API / e2e suites rely on (mirrors EXPECTED_AGENT_DECISIONS). */
export const EXPECTED_REVIEW_SEED = {
  workflow: SHOWCASE_WAITING,
  project: 'payments-api',
  pullRequest: { externalId: 'pr-1821', number: 1821, title: 'PAY-1391 Refund processing' },
  review: { externalId: 'rev-1821-3', cycleNumber: 3, status: 'COMPLETE', agentRun: 's500-001-r7' },
  findings: [
    'find-1821-1',
    'find-1821-2',
    'find-1821-3',
    'find-1821-4',
    'find-1821-5',
    'find-1821-6',
    'find-1821-7',
  ],
  securityFinding: 'find-1821-2',
  restrictedEvidenceFinding: 'find-1821-2',
  fixedFinding: 'find-1821-4',
  dismissedFinding: 'find-1821-5',
  lanes: {
    correctness: 'WARN',
    security: 'FAIL',
    dependencies: 'PASS',
    edge_cases: 'PASS',
    testing: 'PASS',
    architecture: 'PASS',
    general: 'PASS',
  },
  byState: { OPEN: 5, FIXED: 1, DISMISSED: 1 },
  blockingOpenCount: 1,
  readyForMerge: false,
  cycles: 3,
  latestCycle: {
    cycleNumber: 3,
    findingsCount: 7,
    fixedCount: 6,
    remainingCount: 1,
    iteration: 3,
    maxIterations: 5,
  },
} as const;

const DISMISSER = 'engineer1@cdevi.demo';
const REVIEW_AGENT = 'Review Agent';
const REPO = 'https://github.com/acme/payments-api';

const blob = (path: string, line: number): EvidenceRef => ({
  kind: 'file',
  label: `${path}:${line}`,
  href: `${REPO}/blob/pay-1391-refunds/src/main/java/com/acme/payments/${path}#L${line}`,
  locator: `${path}:${line}`,
  accessible: true,
});

export function buildReviewSeed(base: Date): ReviewSeed {
  const { showcase } = buildS500(base);
  const wait = showcase.find((s) => s.externalId === SHOWCASE_WAITING);
  const reviewRun = wait?.runs.find((r) => r.externalId === EXPECTED_REVIEW_SEED.review.agentRun);
  if (!reviewRun)
    throw new Error(`S-500 showcase has no run ${EXPECTED_REVIEW_SEED.review.agentRun}`);
  const t0 = reviewRun.startedAt.getTime();
  const at = (min: number) => new Date(t0 + min * MIN);

  const cycles: SeedReviewCycle[] = [
    {
      cycleNumber: 1,
      findingsCount: 12,
      fixedCount: 8,
      remainingCount: 4,
      iteration: 1,
      startedAt: at(0),
      finishedAt: at(3),
    },
    {
      cycleNumber: 2,
      findingsCount: 9,
      fixedCount: 6,
      remainingCount: 3,
      iteration: 2,
      startedAt: at(3),
      finishedAt: at(6),
    },
    {
      cycleNumber: 3,
      findingsCount: 7,
      fixedCount: 6,
      remainingCount: 1,
      iteration: 3,
      startedAt: at(6),
      finishedAt: at(10),
    },
  ].map((c) => ({
    ...c,
    maxIterations: 5,
    state: 'COMPLETED' as const,
    requestedByAgent: REVIEW_AGENT,
    agentRun: c.cycleNumber === 3 ? EXPECTED_REVIEW_SEED.review.agentRun : null,
    observedAt: c.finishedAt,
  }));
  const finishedAt = at(10);

  const finding = (
    position: number,
    lane: ReviewLane,
    severity: FindingSeverity,
    blocking: FindingBlocking,
    title: string,
    description: string,
    impact: string,
    evidence: EvidenceRef[],
    recommendedFix: string,
    over: Partial<SeedReviewFinding> = {},
  ): SeedReviewFinding => ({
    externalId: `find-1821-${position}`,
    position,
    lane,
    severity,
    blocking,
    title,
    description,
    impact,
    evidence,
    recommendedFix,
    state: 'OPEN',
    dismissedBy: null,
    dismissedReason: null,
    dismissedAt: null,
    fixCycle: null,
    ...over,
  });

  const findings: SeedReviewFinding[] = [
    finding(
      1,
      'correctness',
      'MEDIUM',
      'NON_BLOCKING',
      'Null `originalPayment` not handled in `RefundService.refund()`',
      'RefundService.refund() dereferences the originalPayment returned by the repository without a null check; a refund against an unknown payment id throws NullPointerException.',
      'Refunds against an unknown payment fail with an opaque 500 instead of a 404.',
      [blob('RefundService.java', 112)],
      'Return 404 payment_not_found when the repository lookup is empty.',
    ),
    finding(
      2,
      'security',
      'CRITICAL',
      'BLOCKING',
      'Refund endpoint does not verify authorization against the original payment owner',
      'POST /refunds loads the payment by id from the request body and issues the refund without checking that the caller owns the payment or holds the refunds:write scope for that merchant.',
      "A user may potentially refund another user's payment.",
      [
        blob('RefundController.java', 84),
        { kind: 'url', label: 'Threat model — refunds', accessible: false },
      ],
      'Validate payment ownership before processing.',
    ),
    finding(
      3,
      'dependencies',
      'LOW',
      'SUGGESTION',
      'Pin `payments-sdk` to the tested minor',
      'build.gradle declares payments-sdk with an open minor range; the refund flow was verified against 3.4.x only.',
      'A future minor of payments-sdk could change refund semantics without a code change here.',
      [
        {
          kind: 'file',
          label: 'build.gradle:41',
          href: `${REPO}/blob/pay-1391-refunds/build.gradle#L41`,
          locator: 'build.gradle:41',
          accessible: true,
        },
      ],
      'Pin payments-sdk to 3.4.+ and let Renovate propose upgrades.',
    ),
    finding(
      4,
      'edge_cases',
      'HIGH',
      'BLOCKING',
      'Partial refund amount is not bounded by the captured amount',
      'RefundService.refund() accepts any positive amount; nothing compares it against the captured amount minus refunds already issued.',
      'A partial refund can exceed what was captured, creating a negative ledger balance for the merchant.',
      [
        blob('RefundService.java', 140),
        {
          kind: 'ticket',
          label: 'PAY-1391',
          href: 'https://jira.cdevi.demo/browse/PAY-1391',
          locator: 'PAY-1391',
          accessible: true,
        },
      ],
      'Reject requests where requested > captured − refunded with 409 refund_exceeds_captured.',
      { state: 'FIXED', fixCycle: 3 },
    ),
    finding(
      5,
      'testing',
      'MEDIUM',
      'NON_BLOCKING',
      'No negative test for refunds after the 90-day window',
      'RefundServiceTest covers refunds inside the window only; the rejection path for payments older than 90 days is untested.',
      'A regression in the window check would ship undetected.',
      [blob('RefundServiceTest.java', 12)],
      'Add a test asserting a 91-day-old payment is rejected with 409 refund_window_closed.',
      {
        state: 'DISMISSED',
        dismissedBy: DISMISSER,
        dismissedReason: 'Covered by the payments-ledger contract suite; tracked in PAY-1402.',
        dismissedAt: new Date(finishedAt.getTime() + 4 * MIN),
      },
    ),
    finding(
      6,
      'architecture',
      'LOW',
      'SUGGESTION',
      'Move `RefundPolicy` next to the other payment policies',
      'RefundPolicy lives under controller/ while CapturePolicy and AuthorizationPolicy live under policy/.',
      'Module boundaries of the payments package become harder to read.',
      [blob('RefundPolicy.java', 1)],
      'Move RefundPolicy to the policy package.',
    ),
    finding(
      7,
      'general',
      'INFO',
      'SUGGESTION',
      'Inconsistent naming: `refundAmt` vs `refundAmount`',
      'RefundRequest uses refundAmt while RefundService and the ledger use refundAmount.',
      'Minor readability inconsistency.',
      [blob('RefundRequest.java', 18)],
      'Rename refundAmt to refundAmount.',
    ),
  ];

  const lanes: LaneResult[] = [
    { lane: 'correctness', status: 'WARN', summary: 'One unchecked null path in RefundService' },
    { lane: 'security', status: 'FAIL', summary: 'Authorization gap on the refund endpoint' },
    { lane: 'dependencies', status: 'PASS', summary: 'No new dependencies' },
    { lane: 'edge_cases', status: 'PASS', summary: 'Partial refund bound fixed in cycle 3' },
    {
      lane: 'testing',
      status: 'PASS',
      summary: 'Refund paths covered; one negative test dismissed as tracked',
    },
    { lane: 'architecture', status: 'PASS', summary: 'Follows the payments module boundaries' },
    { lane: 'general', status: 'PASS', summary: 'Minor naming inconsistencies only' },
  ];

  return {
    pullRequest: {
      externalId: EXPECTED_REVIEW_SEED.pullRequest.externalId,
      workflow: SHOWCASE_WAITING,
      number: EXPECTED_REVIEW_SEED.pullRequest.number,
      title: EXPECTED_REVIEW_SEED.pullRequest.title,
      href: `${REPO}/pull/${EXPECTED_REVIEW_SEED.pullRequest.number}`,
      status: 'OPEN',
      observedAt: finishedAt,
    },
    review: {
      externalId: EXPECTED_REVIEW_SEED.review.externalId,
      cycleNumber: 3,
      status: 'COMPLETE',
      lanes,
      startedAt: at(6),
      finishedAt,
      agentRun: EXPECTED_REVIEW_SEED.review.agentRun,
      observedAt: finishedAt,
      findings,
    },
    cycles,
  };
}
