/**
 * specs/001 US6 — pull request review contracts (Review Center, finding actions, runtime ingestion).
 * Data model: packages/db/migrations/0007_reviews.sql. `readyForMerge` is derived (./review-model), never stored.
 * Ingest schemas are strict and carry bounded summaries only — no free-form reasoning field (FR-018, SC-009).
 */
import { z } from 'zod';
import { EvidenceRef } from './agent-runs';
import { DecisionLink, ExternalId, IsoDateTime, line, Uuid } from './common';
import {
  FINDING_BLOCKING_CLASSES,
  FINDING_SEVERITIES,
  FINDING_STATES,
  LANE_STATUSES,
  PULL_REQUEST_STATUSES,
  REVIEW_CYCLE_STATES,
  REVIEW_LANES,
  REVIEW_STATUSES,
} from './review-model';

export const ReviewLane = z.enum(REVIEW_LANES);
export type ReviewLane = z.infer<typeof ReviewLane>;
export const LaneStatus = z.enum(LANE_STATUSES);
export type LaneStatus = z.infer<typeof LaneStatus>;
export const ReviewStatus = z.enum(REVIEW_STATUSES);
export type ReviewStatus = z.infer<typeof ReviewStatus>;
export const FindingSeverity = z.enum(FINDING_SEVERITIES);
export type FindingSeverity = z.infer<typeof FindingSeverity>;
export const FindingBlocking = z.enum(FINDING_BLOCKING_CLASSES);
export type FindingBlocking = z.infer<typeof FindingBlocking>;
export const FindingState = z.enum(FINDING_STATES);
export type FindingState = z.infer<typeof FindingState>;
export const ReviewCycleState = z.enum(REVIEW_CYCLE_STATES);
export type ReviewCycleState = z.infer<typeof ReviewCycleState>;
export const PullRequestStatus = z.enum(PULL_REQUEST_STATUSES);
export type PullRequestStatus = z.infer<typeof PullRequestStatus>;

/** Bounded prose that may span lines (description, impact, recommended fix). */
const text = (max: number) => z.string().trim().min(1).max(max);
const HttpUrl = z
  .string()
  .trim()
  .max(500)
  .refine((s) => /^https?:\/\//.test(s), { message: 'must be an http(s) URL' });

export const LaneResult = z
  .object({
    lane: ReviewLane,
    status: LaneStatus,
    summary: line(240).nullable().optional(),
  })
  .strict();
export type LaneResult = z.infer<typeof LaneResult>;

/** Exactly the seven lanes of UI spec §20, each once. */
export const LaneResults = z
  .array(LaneResult)
  .length(REVIEW_LANES.length)
  .refine((lanes) => new Set(lanes.map((l) => l.lane)).size === lanes.length, {
    message: 'each review lane must appear exactly once',
  });
export type LaneResults = z.infer<typeof LaneResults>;

export const FindingPosition = z.number().int().min(1).max(50);
const UserRef = z.object({ id: Uuid, displayName: z.string() });

/** The content of a finding as the runtime reports it (data-model §, FR-020). */
const FindingContent = z.object({
  externalId: ExternalId,
  position: FindingPosition,
  lane: ReviewLane,
  severity: FindingSeverity,
  blocking: FindingBlocking,
  title: line(200),
  description: text(2000),
  impact: text(1000),
  evidence: z.array(EvidenceRef).max(10),
  recommendedFix: text(1000),
});

export const ReviewFindingView = FindingContent.extend({
  id: Uuid,
  state: FindingState,
  dismissedReason: z.string().nullable(),
  dismissedBy: UserRef.nullable(),
  dismissedAt: IsoDateTime.nullable(),
  fixCycleId: Uuid.nullable(),
  issueRequestedAt: IsoDateTime.nullable(),
});
export type ReviewFindingView = z.infer<typeof ReviewFindingView>;

const count = z.number().int().min(0);
const CycleCounts = {
  findingsCount: count,
  fixedCount: count,
  remainingCount: count,
  iteration: z.number().int().min(1),
};
const countsConsistent = (c: {
  findingsCount: number;
  fixedCount: number;
  remainingCount: number;
}) => c.fixedCount + c.remainingCount <= c.findingsCount;
const iterationWithinMax = (c: { iteration: number; maxIterations?: number | undefined }) =>
  c.maxIterations === undefined || c.iteration <= c.maxIterations;

export const ReviewCycleView = z
  .object({
    id: Uuid,
    cycleNumber: z.number().int().min(1),
    ...CycleCounts,
    maxIterations: z.number().int().min(1),
    state: ReviewCycleState,
    requestedBy: UserRef.nullable(),
    requestedByAgent: z.string().nullable(),
    startedAt: IsoDateTime,
    finishedAt: IsoDateTime.nullable(),
  })
  .refine(countsConsistent, {
    message: 'fixedCount + remainingCount must not exceed findingsCount',
  })
  .refine(iterationWithinMax, { message: 'iteration must not exceed maxIterations' });
export type ReviewCycleView = z.infer<typeof ReviewCycleView>;

const PullRequestRef = z.object({
  id: Uuid,
  externalId: ExternalId,
  number: z.number().int().min(1),
  title: z.string(),
  href: HttpUrl,
  status: PullRequestStatus,
});
const WorkflowRef = z.object({ id: Uuid, name: z.string(), href: DecisionLink });
const RequirementRef = z.object({ id: Uuid, title: z.string(), href: DecisionLink });

export const LatestReviewView = z.object({
  id: Uuid,
  cycleNumber: z.number().int().min(1),
  status: ReviewStatus,
  lanes: LaneResults,
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
});
export type LatestReviewView = z.infer<typeof LatestReviewView>;

/** GET /api/reviews/{pullRequestId} — the Review Center read model (UI spec §20–§22). */
export const PullRequestReviewView = z.object({
  pullRequest: PullRequestRef,
  workflow: WorkflowRef,
  requirement: RequirementRef.nullable(),
  latestReview: LatestReviewView.nullable(),
  findings: z.array(ReviewFindingView).max(50),
  cycles: z.array(ReviewCycleView).max(20),
  readyForMerge: z.boolean(),
  blockingOpenCount: count,
});
export type PullRequestReviewView = z.infer<typeof PullRequestReviewView>;

/** GET /api/reviews — one row of the bounded list. */
export const ReviewListItem = PullRequestRef.extend({
  project: z.object({ id: Uuid, key: z.string(), name: z.string() }),
  workflow: WorkflowRef,
  reviewStatus: ReviewStatus.nullable(),
  openFindingsCount: count,
  blockingOpenCount: count,
  readyForMerge: z.boolean(),
  reviewHref: DecisionLink,
  updatedAt: IsoDateTime,
});
export type ReviewListItem = z.infer<typeof ReviewListItem>;

export const ReviewListResponse = z.object({
  items: z.array(ReviewListItem).max(50),
  nextCursor: z.string().nullable(),
});
export type ReviewListResponse = z.infer<typeof ReviewListResponse>;

export const ReviewListQuery = z.object({
  project: z.union([z.literal('all'), Uuid]).default('all'),
  state: PullRequestStatus.optional(),
  cursor: z.string().max(200).optional(),
});
export type ReviewListQuery = z.infer<typeof ReviewListQuery>;

export const PullRequestIdParams = z.object({ pullRequestId: Uuid });
export type PullRequestIdParams = z.infer<typeof PullRequestIdParams>;
export const FindingActionParams = z.object({ pullRequestId: Uuid, findingId: Uuid });
export type FindingActionParams = z.infer<typeof FindingActionParams>;

export const DismissFindingBody = z.object({ reason: line(240) }).strict();
export type DismissFindingBody = z.infer<typeof DismissFindingBody>;
export const ApplyFixBody = z.object({}).strict();
export type ApplyFixBody = z.infer<typeof ApplyFixBody>;
export const CreateIssueBody = z.object({}).strict();
export type CreateIssueBody = z.infer<typeof CreateIssueBody>;

/** Result of dismiss / fix / issue: the finding after the action, the cycle Apply Fix created or joined, and the derived readiness. */
export const FindingActionResult = z.object({
  finding: ReviewFindingView,
  cycle: ReviewCycleView.optional(),
  readyForMerge: z.boolean(),
  blockingOpenCount: count,
});
export type FindingActionResult = z.infer<typeof FindingActionResult>;

// --- ingestion (FR-036): the runtime reports, the control plane never writes audit_events for these.

export const PullRequestExternalIdParams = z.object({ externalId: ExternalId });
export type PullRequestExternalIdParams = z.infer<typeof PullRequestExternalIdParams>;
export const ReviewCycleParams = z.object({
  externalId: ExternalId,
  cycle: z.coerce.number().int().min(1),
});
export type ReviewCycleParams = z.infer<typeof ReviewCycleParams>;

/** PUT /api/ingest/pull-requests/{externalId} */
export const PullRequestIngest = z
  .object({
    number: z.number().int().min(1),
    title: line(200),
    href: HttpUrl,
    status: PullRequestStatus,
    requirementExternalId: ExternalId.nullable().optional(),
    workflowExternalId: ExternalId,
    /** Position of the workflow stage that represents Review; Apply Fix flips that stage to RUNNING. */
    reviewStagePosition: z.number().int().min(1).max(20).nullable().optional(),
    observedAt: IsoDateTime,
  })
  .strict();
export type PullRequestIngest = z.infer<typeof PullRequestIngest>;

/** What the runtime may say about a finding's state: human states (DISMISSED, FIX_REQUESTED, ISSUE_REQUESTED) are preserved by the ingest. */
export const FindingIngestStatus = z.enum(['open', 'fixed']);
export type FindingIngestStatus = z.infer<typeof FindingIngestStatus>;
export const ReviewFindingIngest = FindingContent.extend({
  status: FindingIngestStatus.default('open'),
}).strict();
export type ReviewFindingIngest = z.infer<typeof ReviewFindingIngest>;

/** PUT /api/ingest/pull-requests/{externalId}/reviews/{cycle} — replaces the review and its findings whole. */
export const ReviewIngest = z
  .object({
    externalId: ExternalId,
    status: ReviewStatus,
    lanes: LaneResults,
    findings: z
      .array(ReviewFindingIngest)
      .max(50)
      .refine((f) => new Set(f.map((x) => x.position)).size === f.length, {
        message: 'finding positions must be unique',
      })
      .refine((f) => new Set(f.map((x) => x.externalId)).size === f.length, {
        message: 'finding externalIds must be unique',
      }),
    startedAt: IsoDateTime,
    finishedAt: IsoDateTime.optional(),
    agentRunExternalId: ExternalId.optional(),
    observedAt: IsoDateTime,
  })
  .strict();
export type ReviewIngest = z.infer<typeof ReviewIngest>;

/** PUT /api/ingest/pull-requests/{externalId}/cycles/{cycle} — the runtime's progress on a fix cycle. */
export const ReviewCycleIngest = z
  .object({
    ...CycleCounts,
    maxIterations: z.number().int().min(1).optional(),
    state: ReviewCycleState,
    agentRunExternalId: ExternalId.optional(),
    startedAt: IsoDateTime,
    finishedAt: IsoDateTime.optional(),
    observedAt: IsoDateTime,
  })
  .strict()
  .refine(countsConsistent, {
    message: 'fixedCount + remainingCount must not exceed findingsCount',
  })
  .refine(iterationWithinMax, { message: 'iteration must not exceed maxIterations' });
export type ReviewCycleIngest = z.infer<typeof ReviewCycleIngest>;
