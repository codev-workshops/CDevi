/**
 * `GET /workflows` (specs/001 US4 scope decision 3; FR-003 shape; data-model §27; research R39).
 * Bounded to WORKFLOWS_PAGE_SIZE rows, keyset over (state_observed_at DESC, id DESC) on workflows_list_idx,
 * scoped to the caller's visible projects — an invisible project or requirement yields an empty page.
 */
import type {
  PullRequestRef,
  WorkflowListItem,
  WorkflowListPage,
  WorkflowListQuery,
  WorkflowState,
} from '@cdevi/contracts';
import {
  decodeWorkflowCursor,
  encodeWorkflowCursor,
  requirementHrefs,
  WORKFLOWS_PAGE_SIZE,
} from '@cdevi/contracts/requirement-rules';
import type pg from 'pg';

export interface WorkflowListScope {
  organizationId: string;
  projectIds: string[];
}

interface ListRow {
  id: string;
  external_id: string;
  title: string;
  project_id: string;
  project_key: string;
  project_name: string;
  agent: string | null;
  state: WorkflowState;
  state_observed_at: Date;
  stage_index: number | null;
  stage_count: number | null;
  stage_name: string | null;
  pull_request_ref: string | null;
  requirement_id: string | null;
  requirement_title: string | null;
  started_at: Date | null;
  finished_at: Date | null;
}

/** `pull_request_ref` is free text ("PR #512", "#512", or a URL); the number is whatever digits it carries. */
export function pullRequestRef(ref: string | null): PullRequestRef | null {
  if (!ref) return null;
  const digits = /(\d+)\D*$/.exec(ref)?.[1];
  return { url: ref, number: digits ? Number(digits) : null, state: null };
}

const toItem = (r: ListRow): WorkflowListItem => ({
  id: r.id,
  externalId: r.external_id,
  title: r.title,
  project: { id: r.project_id, key: r.project_key, name: r.project_name },
  state: r.state,
  stateObservedAt: r.state_observed_at.toISOString(),
  stage:
    r.stage_index !== null
      ? { index: r.stage_index, count: r.stage_count ?? 7, name: r.stage_name }
      : null,
  agent: r.agent,
  pullRequest: pullRequestRef(r.pull_request_ref),
  requirement:
    r.requirement_id && r.requirement_title !== null
      ? {
          id: r.requirement_id,
          title: r.requirement_title,
          href: requirementHrefs.requirement(r.requirement_id),
        }
      : null,
  startedAt: r.started_at?.toISOString() ?? null,
  finishedAt: r.finished_at?.toISOString() ?? null,
  href: requirementHrefs.workflow(r.id),
});

export async function listWorkflows(
  client: pg.PoolClient,
  scope: WorkflowListScope,
  query: WorkflowListQuery,
  now: Date,
): Promise<WorkflowListPage> {
  const states = query.state ?? [];
  const page: WorkflowListPage = {
    generatedAt: now.toISOString(),
    project: query.project,
    filters: { requirement: query.requirement ?? null, state: states, stage: query.stage ?? null },
    items: [],
    nextCursor: null,
    total: 0,
  };
  const cursor = query.cursor ? decodeWorkflowCursor(query.cursor) : null;

  const projectIds =
    query.project === 'all'
      ? scope.projectIds
      : scope.projectIds.filter((id) => id === query.project);
  if (projectIds.length === 0) return page;

  const params: unknown[] = [scope.organizationId, projectIds];
  const where = [`w.organization_id = $1`, `w.project_id = ANY($2::uuid[])`];
  if (query.requirement) {
    params.push(query.requirement);
    where.push(`w.requirement_id = $${params.length}`);
  }
  if (states.length) {
    params.push(states);
    where.push(`w.state = ANY($${params.length}::workflow_state[])`);
  }
  if (query.stage) {
    params.push(query.stage);
    where.push(`w.stage_index = $${params.length}`);
  }
  const total = Number(
    (
      await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM workflows w WHERE ${where.join(' AND ')}`,
        params,
      )
    ).rows[0]!.n,
  );
  if (cursor) {
    params.push(cursor.stateObservedAt, cursor.id);
    where.push(
      `(w.state_observed_at, w.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
    );
  }
  const rows = await client.query<ListRow>(
    `SELECT w.id, w.external_id, w.title, w.project_id, p.key AS project_key, p.name AS project_name,
            w.agent, w.state, w.state_observed_at, w.stage_index, w.stage_count, w.stage_name,
            w.pull_request_ref, w.requirement_id, r.title AS requirement_title, w.started_at, w.finished_at
       FROM workflows w
       JOIN projects p ON p.id = w.project_id
       LEFT JOIN requirements r ON r.id = w.requirement_id
      WHERE ${where.join(' AND ')}
      ORDER BY w.state_observed_at DESC, w.id DESC
      LIMIT ${WORKFLOWS_PAGE_SIZE + 1}`,
    params,
  );
  const items = rows.rows.slice(0, WORKFLOWS_PAGE_SIZE);
  const last = items.at(-1);
  return {
    ...page,
    items: items.map(toItem),
    nextCursor:
      rows.rows.length > WORKFLOWS_PAGE_SIZE && last
        ? encodeWorkflowCursor({ stateObservedAt: last.state_observed_at.toISOString(), id: last.id })
        : null,
    total,
  };
}
