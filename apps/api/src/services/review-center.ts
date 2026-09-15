/**
 * specs/001 US6 — Review Center read models (FR-020, FR-022, FR-025, FR-032).
 * `GET /reviews` is bounded to REVIEWS_PAGE_SIZE rows, keyset over (updated_at DESC, id DESC) over the caller's
 * visible projects; `GET /reviews/{pullRequestId}` runs in one REPEATABLE READ transaction with four statements
 * (visible projects, head with its latest review, findings, cycles). `readyForMerge` / `blockingOpenCount` are
 * derived with @cdevi/contracts/review-model, never stored. Unknown and invisible pull requests are both `null`.
 */
import type {
  EvidenceRef,
  FindingBlocking,
  FindingSeverity,
  FindingState,
  LaneResults,
  PullRequestReviewView,
  PullRequestStatus,
  ReviewCycleState,
  ReviewCycleView,
  ReviewFindingView,
  ReviewLane,
  ReviewListItem,
  ReviewListQuery,
  ReviewListResponse,
  ReviewStatus,
} from '@cdevi/contracts';
import { requirementHrefs } from '@cdevi/contracts/requirement-rules';
import {
  blockingOpenCount,
  decodeReviewCursor,
  encodeReviewCursor,
  type FindingLike,
  readyForMerge,
  reviewHref,
  REVIEWS_PAGE_SIZE,
} from '@cdevi/contracts/review-model';
import type pg from 'pg';
import { visibleProjects, type SessionUser } from './auth';

export const FINDINGS_LIMIT = 50;
export const CYCLES_LIMIT = 20;

interface ListRow {
  id: string;
  external_id: string;
  number: number;
  title: string;
  href: string;
  status: PullRequestStatus;
  updated_at: Date;
  project_id: string;
  project_key: string;
  project_name: string;
  workflow_id: string;
  workflow_title: string;
  review_status: ReviewStatus | null;
  findings: FindingLike[];
}

interface HeadRow extends ListRow {
  requirement_id: string | null;
  requirement_title: string | null;
  review_id: string | null;
  review_cycle_number: number | null;
  review_lanes: LaneResults | null;
  review_started_at: Date | null;
  review_finished_at: Date | null;
}

export interface FindingRow {
  id: string;
  review_id: string;
  external_id: string;
  position: number;
  lane: ReviewLane;
  severity: FindingSeverity;
  blocking: FindingBlocking;
  title: string;
  description: string;
  impact: string;
  evidence: EvidenceRef[];
  recommended_fix: string;
  state: FindingState;
  dismissed_reason: string | null;
  dismissed_by_user_id: string | null;
  dismissed_by_name: string | null;
  dismissed_at: Date | null;
  fix_cycle_id: string | null;
  issue_requested_at: Date | null;
}

export interface CycleRow {
  id: string;
  cycle_number: number;
  findings_count: number;
  fixed_count: number;
  remaining_count: number;
  iteration: number;
  max_iterations: number;
  state: ReviewCycleState;
  requested_by_user_id: string | null;
  requested_by_name: string | null;
  requested_by_agent: string | null;
  started_at: Date;
  finished_at: Date | null;
}

/** Columns of one finding plus the dismisser's display name; shared with the finding actions. */
export const FINDING_SELECT = `
  SELECT f.id, f.review_id, f.external_id, f.position, f.lane, f.severity, f.blocking, f.title, f.description, f.impact, f.evidence,
         f.recommended_fix, f.state, f.dismissed_reason, f.dismissed_by_user_id, du.display_name AS dismissed_by_name,
         f.dismissed_at, f.fix_cycle_id, f.issue_requested_at
    FROM review_findings f LEFT JOIN users du ON du.id = f.dismissed_by_user_id`;

export const CYCLE_SELECT = `
  SELECT c.id, c.cycle_number, c.findings_count, c.fixed_count, c.remaining_count, c.iteration, c.max_iterations, c.state,
         c.requested_by_user_id, ru.display_name AS requested_by_name, c.requested_by_agent, c.started_at, c.finished_at
    FROM review_cycles c LEFT JOIN users ru ON ru.id = c.requested_by_user_id`;

/** The pull request head joined to its project, workflow, requirement, latest review and that review's finding states. */
const HEAD_SELECT = `
  SELECT pr.id, pr.external_id, pr.number, pr.title, pr.href, pr.status, pr.updated_at,
         p.id AS project_id, p.key AS project_key, p.name AS project_name,
         w.id AS workflow_id, w.title AS workflow_title,
         rq.id AS requirement_id, rq.title AS requirement_title,
         lr.id AS review_id, lr.cycle_number AS review_cycle_number, lr.status AS review_status, lr.lanes AS review_lanes,
         lr.started_at AS review_started_at, lr.finished_at AS review_finished_at,
         COALESCE(fs.findings, '[]'::json) AS findings
    FROM pull_requests pr
    JOIN projects p ON p.id = pr.project_id
    JOIN workflows w ON w.id = pr.workflow_id
    LEFT JOIN requirements rq ON rq.id = pr.requirement_id
    LEFT JOIN LATERAL (SELECT r.id, r.cycle_number, r.status, r.lanes, r.started_at, r.finished_at
                         FROM reviews r WHERE r.pull_request_id = pr.id ORDER BY r.cycle_number DESC LIMIT 1) lr ON true
    LEFT JOIN LATERAL (SELECT json_agg(json_build_object('lane', f.lane, 'blocking', f.blocking, 'state', f.state)) AS findings
                         FROM review_findings f WHERE f.review_id = lr.id) fs ON true`;

export const toFindingView = (f: FindingRow): ReviewFindingView => ({
  id: f.id,
  externalId: f.external_id,
  position: f.position,
  lane: f.lane,
  severity: f.severity,
  blocking: f.blocking,
  title: f.title,
  description: f.description,
  impact: f.impact,
  evidence: f.evidence,
  recommendedFix: f.recommended_fix,
  state: f.state,
  dismissedReason: f.dismissed_reason,
  dismissedBy:
    f.dismissed_by_user_id && f.dismissed_by_name
      ? { id: f.dismissed_by_user_id, displayName: f.dismissed_by_name }
      : null,
  dismissedAt: f.dismissed_at?.toISOString() ?? null,
  fixCycleId: f.fix_cycle_id,
  issueRequestedAt: f.issue_requested_at?.toISOString() ?? null,
});

export const toCycleView = (c: CycleRow): ReviewCycleView => ({
  id: c.id,
  cycleNumber: c.cycle_number,
  findingsCount: c.findings_count,
  fixedCount: c.fixed_count,
  remainingCount: c.remaining_count,
  iteration: c.iteration,
  maxIterations: c.max_iterations,
  state: c.state,
  requestedBy:
    c.requested_by_user_id && c.requested_by_name
      ? { id: c.requested_by_user_id, displayName: c.requested_by_name }
      : null,
  requestedByAgent: c.requested_by_agent,
  startedAt: c.started_at.toISOString(),
  finishedAt: c.finished_at?.toISOString() ?? null,
});

const toListItem = (r: ListRow): ReviewListItem => ({
  id: r.id,
  externalId: r.external_id,
  number: r.number,
  title: r.title,
  href: r.href,
  status: r.status,
  project: { id: r.project_id, key: r.project_key, name: r.project_name },
  workflow: {
    id: r.workflow_id,
    name: r.workflow_title,
    href: requirementHrefs.workflow(r.workflow_id),
  },
  reviewStatus: r.review_status,
  openFindingsCount: r.findings.filter((f) => f.state === 'OPEN' || f.state === 'FIX_REQUESTED')
    .length,
  blockingOpenCount: blockingOpenCount(r.findings),
  readyForMerge: readyForMerge(r.findings),
  reviewHref: reviewHref(r.id),
  updatedAt: r.updated_at.toISOString(),
});

/** `GET /reviews` — throws InvalidCursorError (from review-model) on a malformed cursor. */
export async function listReviews(
  db: pg.Pool | pg.PoolClient,
  user: SessionUser,
  query: ReviewListQuery,
): Promise<ReviewListResponse> {
  const cursor = query.cursor ? decodeReviewCursor(query.cursor) : null;
  const visible = (await visibleProjects(db, user)).map((p) => p.id);
  const projectIds =
    query.project === 'all' ? visible : visible.filter((id) => id === query.project);
  if (projectIds.length === 0) return { items: [], nextCursor: null };

  const params: unknown[] = [user.organizationId, projectIds];
  const where = [`pr.organization_id = $1`, `pr.project_id = ANY($2::uuid[])`];
  if (query.state) {
    params.push(query.state);
    where.push(`pr.status = $${params.length}`);
  }
  if (cursor) {
    params.push(cursor.updatedAt, cursor.id);
    where.push(
      `(pr.updated_at, pr.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  params.push(REVIEWS_PAGE_SIZE + 1);
  const rows = (
    await db.query<ListRow>(
      `${HEAD_SELECT} WHERE ${where.join(' AND ')} ORDER BY pr.updated_at DESC, pr.id DESC LIMIT $${params.length}`,
      params,
    )
  ).rows;
  const page = rows.slice(0, REVIEWS_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(toListItem),
    nextCursor:
      rows.length > REVIEWS_PAGE_SIZE && last
        ? encodeReviewCursor({ updatedAt: last.updated_at.toISOString(), id: last.id })
        : null,
  };
}

/** `GET /reviews/{pullRequestId}` — call inside a REPEATABLE READ transaction. */
export async function getPullRequestReview(
  client: pg.PoolClient,
  user: SessionUser,
  pullRequestId: string,
): Promise<PullRequestReviewView | null> {
  const projectIds = (await visibleProjects(client, user)).map((p) => p.id);
  if (projectIds.length === 0) return null;
  const head = (
    await client.query<HeadRow>(
      `${HEAD_SELECT} WHERE pr.organization_id = $1 AND pr.id = $2 AND pr.project_id = ANY($3::uuid[])`,
      [user.organizationId, pullRequestId, projectIds],
    )
  ).rows[0];
  if (!head) return null;

  const findings = head.review_id
    ? (
        await client.query<FindingRow>(
          `${FINDING_SELECT} WHERE f.review_id = $1 ORDER BY f.position LIMIT ${FINDINGS_LIMIT}`,
          [head.review_id],
        )
      ).rows.map(toFindingView)
    : [];
  const cycles = (
    await client.query<CycleRow>(
      `${CYCLE_SELECT} WHERE c.pull_request_id = $1 ORDER BY c.cycle_number DESC LIMIT ${CYCLES_LIMIT}`,
      [head.id],
    )
  ).rows.map(toCycleView);

  return {
    pullRequest: {
      id: head.id,
      externalId: head.external_id,
      number: head.number,
      title: head.title,
      href: head.href,
      status: head.status,
    },
    workflow: {
      id: head.workflow_id,
      name: head.workflow_title,
      href: requirementHrefs.workflow(head.workflow_id),
    },
    requirement:
      head.requirement_id && head.requirement_title
        ? {
            id: head.requirement_id,
            title: head.requirement_title,
            href: requirementHrefs.requirement(head.requirement_id),
          }
        : null,
    latestReview:
      head.review_id &&
      head.review_cycle_number &&
      head.review_status &&
      head.review_lanes &&
      head.review_started_at
        ? {
            id: head.review_id,
            cycleNumber: head.review_cycle_number,
            status: head.review_status,
            lanes: head.review_lanes,
            startedAt: head.review_started_at.toISOString(),
            finishedAt: head.review_finished_at?.toISOString() ?? null,
          }
        : null,
    findings,
    cycles,
    readyForMerge: readyForMerge(findings),
    blockingOpenCount: blockingOpenCount(findings),
  };
}
