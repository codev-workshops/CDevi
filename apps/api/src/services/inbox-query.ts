/**
 * Inbox read services (contracts/inbox-read-model.md). Ordering and classification are done in SQL and mirror the
 * pure functions in @cdevi/contracts; `apps/api/tests/inbox.test.ts` asserts both agree over the seed.
 */
import {
  decodeCursor,
  deriveAsk,
  deriveKind,
  encodeCursor,
  InvalidCursorError,
  isStale,
  PAGE_SIZE,
  raisedAt as raisedAtOf,
  riskLevelOf,
  riskRank,
  TAB_STATES,
  type InboxCounts,
  type InboxItem,
  type InboxRowSource,
  type InboxSnapshot,
  type RecordView,
  type RiskLevel,
  type Tab,
  type TodaySummary,
  type WorkflowState,
} from '@cdevi/contracts';
import type pg from 'pg';
import { problems } from '../lib/problem';

export interface Scope {
  organizationId: string;
  /** Visible projects intersected with the selector; never empty when a query runs. */
  projectIds: string[];
  /** `all` or the selected project id (echoed in hrefs). */
  project: string;
}

interface Row {
  id: string;
  title: string;
  project_id: string;
  project_key: string;
  agent: string | null;
  state: WorkflowState;
  state_observed_at: Date;
  state_reason: string | null;
  stage_index: number | null;
  stage_count: number | null;
  stage_name: string | null;
  pull_request_ref: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  a_id: string | null;
  a_ask: string | null;
  a_risk: RiskLevel | null;
  a_requested_at: Date | null;
  a_expires_at: Date | null;
  c_id: string | null;
  c_question: string | null;
  c_requested_at: Date | null;
  c_recommended: boolean | null;
  risk_rank: number;
  raised_at: Date;
}

const ROW_SELECT = `
  SELECT w.id, w.title, w.project_id, p.key AS project_key, w.agent, w.state, w.state_observed_at, w.state_reason,
         w.stage_index, w.stage_count, w.stage_name, w.pull_request_ref, w.started_at, w.finished_at,
         a.id AS a_id, a.ask AS a_ask, a.risk_level AS a_risk, a.requested_at AS a_requested_at, a.expires_at AS a_expires_at,
         c.id AS c_id, c.question AS c_question, c.requested_at AS c_requested_at, c.has_recommended_answer AS c_recommended,
         CASE WHEN w.state = 'WAITING_FOR_HUMAN' AND a.id IS NOT NULL THEN
           CASE a.risk_level WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 END
         ELSE 4 END AS risk_rank,
         CASE WHEN w.state = 'WAITING_FOR_HUMAN' AND a.id IS NOT NULL THEN a.requested_at
              WHEN w.state = 'WAITING_FOR_HUMAN' AND c.id IS NOT NULL THEN c.requested_at
              ELSE w.state_observed_at END AS raised_at
    FROM workflows w
    JOIN projects p ON p.id = w.project_id
    LEFT JOIN LATERAL (SELECT id, ask, risk_level, requested_at, expires_at FROM approvals
                        WHERE workflow_id = w.id AND decision IS NULL ORDER BY requested_at, id LIMIT 1) a ON true
    LEFT JOIN LATERAL (SELECT id, question, requested_at, has_recommended_answer FROM clarifications
                        WHERE workflow_id = w.id AND answered_at IS NULL ORDER BY requested_at, id LIMIT 1) c ON true`;

function toSource(r: Row): InboxRowSource {
  return {
    workflowId: r.id,
    state: r.state,
    stateObservedAt: r.state_observed_at,
    stateReason: r.state_reason,
    stageIndex: r.stage_index,
    stageName: r.stage_name,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    approval: r.a_id
      ? {
          id: r.a_id,
          ask: r.a_ask!,
          riskLevel: r.a_risk!,
          requestedAt: r.a_requested_at!,
          expiresAt: r.a_expires_at,
          hasRecommendedAnswer: false,
        }
      : null,
    clarification: r.c_id
      ? {
          id: r.c_id,
          question: r.c_question!,
          requestedAt: r.c_requested_at!,
          hasRecommendedAnswer: Boolean(r.c_recommended),
        }
      : null,
  };
}

/** Tab for a record view: window-less so resolved / old records still get a tab. */
function looseTab(state: WorkflowState): Tab {
  return (Object.keys(TAB_STATES) as Tab[]).find((t) => TAB_STATES[t].includes(state))!;
}

export function toItem(r: Row, now: Date, tab?: Tab): InboxItem {
  const src = toSource(r);
  const kind = deriveKind(src);
  const resolvedTab = tab ?? looseTab(r.state);
  const raised = raisedAtOf(src);
  const requestId = kind === 'approval' ? r.a_id : kind === 'clarification' ? r.c_id : null;
  return {
    workflowId: r.id,
    title: r.title,
    project: { id: r.project_id, key: r.project_key },
    agent: r.agent,
    state: r.state,
    tab: resolvedTab,
    kind,
    ask: deriveAsk(src),
    riskLevel: riskLevelOf(src),
    raisedAt: raised.toISOString(),
    isStale: isStale(resolvedTab, raised, now),
    expiry:
      kind === 'approval' && r.a_expires_at
        ? {
            expiresAt: r.a_expires_at.toISOString(),
            isExpired: now.getTime() >= r.a_expires_at.getTime(),
          }
        : null,
    hasRecommendedAnswer: kind === 'clarification' ? Boolean(r.c_recommended) : false,
    stage:
      r.stage_index != null
        ? { index: r.stage_index, count: r.stage_count ?? 7, name: r.stage_name }
        : null,
    startedAt: r.started_at?.toISOString() ?? null,
    finishedAt: r.finished_at?.toISOString() ?? null,
    pullRequestRef: r.pull_request_ref,
    requestId,
    href: requestId ? `/approvals/${requestId}` : `/workflows/${r.id}`,
  };
}

const DONE_WINDOW = `AND w.finished_at >= $3::timestamptz - interval '7 days'`;

function tabWhere(tab: Tab): string {
  const states = TAB_STATES[tab].map((s) => `'${s}'`).join(',');
  // $3 (now) is always bound; only the done window reads it.
  return `w.organization_id = $1 AND w.project_id = ANY($2::uuid[]) AND $3::timestamptz IS NOT NULL AND w.state IN (${states}) ${tab === 'done' ? DONE_WINDOW : ''}`;
}

const ORDER: Record<Tab, string> = {
  needsYou: 'risk_rank ASC, raised_at ASC, id ASC',
  running: 'started_at DESC NULLS LAST, id ASC',
  done: 'finished_at DESC, id ASC',
};

function keysetWhere(tab: Tab, cursor: string | undefined, params: unknown[]): string {
  if (!cursor) return '';
  let keys;
  try {
    keys = decodeCursor(tab, cursor);
  } catch (e) {
    if (e instanceof InvalidCursorError) throw problems.invalidCursor();
    throw e;
  }
  const p = (v: unknown) => `$${params.push(v)}`;
  switch (tab) {
    case 'needsYou': {
      const [rank, raised, id] = keys as [number, string, string];
      return `WHERE (risk_rank, raised_at, id) > (${p(rank)}::int, ${p(raised)}::timestamptz, ${p(id)}::uuid)`;
    }
    case 'running': {
      const [started, id] = keys as [string | null, string];
      if (started === null) return `WHERE started_at IS NULL AND id > ${p(id)}::uuid`;
      return `WHERE (started_at < ${p(started)}::timestamptz) OR (started_at = ${p(started)}::timestamptz AND id > ${p(id)}::uuid) OR started_at IS NULL`;
    }
    case 'done': {
      const [finished, id] = keys as [string, string];
      return `WHERE (finished_at < ${p(finished)}::timestamptz) OR (finished_at = ${p(finished)}::timestamptz AND id > ${p(id)}::uuid)`;
    }
  }
}

function cursorFor(tab: Tab, last: Row): string {
  switch (tab) {
    case 'needsYou':
      return encodeCursor('needsYou', [last.risk_rank, last.raised_at.toISOString(), last.id]);
    case 'running':
      return encodeCursor('running', [last.started_at?.toISOString() ?? null, last.id]);
    case 'done':
      return encodeCursor('done', [last.finished_at!.toISOString(), last.id]);
  }
}

export async function queryPage(
  client: pg.PoolClient,
  scope: Scope,
  tab: Tab,
  cursor: string | undefined,
  now: Date,
): Promise<{ items: InboxItem[]; nextCursor: string | null }> {
  const params: unknown[] = [scope.organizationId, scope.projectIds, now];
  const keyset = keysetWhere(tab, cursor, params);
  const sql = `SELECT * FROM (${ROW_SELECT} WHERE ${tabWhere(tab)}) rows ${keyset} ORDER BY ${ORDER[tab]} LIMIT ${PAGE_SIZE + 1}`;
  const r = await client.query<Row>(sql, params);
  const page = r.rows.slice(0, PAGE_SIZE);
  const nextCursor = r.rows.length > PAGE_SIZE ? cursorFor(tab, page[page.length - 1]!) : null;
  return { items: page.map((row) => toItem(row, now, tab)), nextCursor };
}

export async function queryCounts(
  client: pg.PoolClient,
  scope: Scope,
  now: Date,
): Promise<InboxCounts> {
  const r = await client.query<{ needs_you: string; running: string; done: string }>(
    `SELECT COUNT(*) FILTER (WHERE state IN ('WAITING_FOR_HUMAN','BLOCKED','FAILED')) AS needs_you,
            COUNT(*) FILTER (WHERE state IN ('QUEUED','RUNNING','RETRYING','WAITING')) AS running,
            COUNT(*) FILTER (WHERE state IN ('COMPLETED','CANCELLED') AND finished_at >= $3::timestamptz - interval '7 days') AS done
       FROM workflows w WHERE w.organization_id = $1 AND w.project_id = ANY($2::uuid[])`,
    [scope.organizationId, scope.projectIds, now],
  );
  const row = r.rows[0]!;
  return { needsYou: Number(row.needs_you), running: Number(row.running), done: Number(row.done) };
}

export async function queryToday(
  client: pg.PoolClient,
  scope: Scope,
  now: Date,
  needsYou: number,
): Promise<TodaySummary> {
  const r = await client.query<{
    timezone: string;
    window_start: Date;
    started: string;
    completed: string;
    decided: string;
  }>(
    `WITH org AS (SELECT timezone FROM organizations WHERE id = $1),
          win AS (SELECT timezone, (date_trunc('day', $3::timestamptz AT TIME ZONE timezone) AT TIME ZONE timezone) AS window_start FROM org)
     SELECT win.timezone, win.window_start,
            (SELECT COUNT(*) FROM workflows w WHERE w.organization_id = $1 AND w.project_id = ANY($2::uuid[]) AND w.started_at >= win.window_start AND w.started_at <= $3) AS started,
            (SELECT COUNT(*) FROM workflows w WHERE w.organization_id = $1 AND w.project_id = ANY($2::uuid[]) AND w.state = 'COMPLETED' AND w.finished_at >= win.window_start AND w.finished_at <= $3) AS completed,
            (SELECT COUNT(*) FROM approvals a WHERE a.organization_id = $1 AND a.project_id = ANY($2::uuid[]) AND a.decided_at >= win.window_start AND a.decided_at <= $3) AS decided
       FROM win`,
    [scope.organizationId, scope.projectIds, now],
  );
  const row = r.rows[0]!;
  const q = `project=${scope.project}`;
  return {
    timezone: row.timezone,
    windowStart: row.window_start.toISOString(),
    workflowsStarted: { value: Number(row.started), href: `/inbox?tab=running&${q}` },
    workflowsCompleted: { value: Number(row.completed), href: `/inbox?tab=done&${q}` },
    approvalsDecided: { value: Number(row.decided), href: `/approvals?decided=today&${q}` },
    needsYou: { value: needsYou, href: `/inbox?tab=needsYou&${q}` },
  };
}

export async function policySummary(
  client: pg.PoolClient,
  organizationId: string,
): Promise<InboxSnapshot['policySummary']> {
  const r = await client.query<{ policy_summary: string }>(
    `SELECT policy_summary FROM organizations WHERE id = $1`,
    [organizationId],
  );
  return { text: r.rows[0]?.policy_summary ?? '', href: '/policies' };
}

/** One REPEATABLE READ snapshot: counts, page, today and policy never disagree (SC-004). */
export async function inboxSnapshot(
  client: pg.PoolClient,
  scope: Scope,
  tab: Tab,
  cursor: string | undefined,
  now: Date,
): Promise<InboxSnapshot> {
  const counts = await queryCounts(client, scope, now);
  const { items, nextCursor } = await queryPage(client, scope, tab, cursor, now);
  const today = await queryToday(client, scope, now, counts.needsYou);
  return {
    generatedAt: now.toISOString(),
    project: scope.project,
    tab,
    counts,
    items,
    nextCursor,
    today,
    policySummary: await policySummary(client, scope.organizationId),
  };
}

/** Record behind a stub route. `approvals/{id}` accepts approval or clarification ids. */
export async function recordView(
  client: pg.PoolClient,
  scope: Scope,
  kind: 'approvals' | 'workflows',
  id: string,
  now: Date,
): Promise<RecordView | null> {
  let workflowId = id;
  let resolution: RecordView['resolution'] = null;
  if (kind === 'approvals') {
    const a = await client.query<{
      workflow_id: string;
      decision: 'approved' | 'rejected' | null;
      decided_at: Date | null;
      decided_by: string | null;
    }>(
      `SELECT workflow_id, decision, decided_at, decided_by FROM approvals WHERE id = $1 AND organization_id = $2`,
      [id, scope.organizationId],
    );
    if (a.rows[0]) {
      workflowId = a.rows[0].workflow_id;
      if (a.rows[0].decision)
        resolution = {
          outcome: a.rows[0].decision,
          at: a.rows[0].decided_at!.toISOString(),
          by: a.rows[0].decided_by,
        };
    } else {
      const c = await client.query<{
        workflow_id: string;
        answered_at: Date | null;
        answered_by: string | null;
      }>(
        `SELECT workflow_id, answered_at, answered_by FROM clarifications WHERE id = $1 AND organization_id = $2`,
        [id, scope.organizationId],
      );
      if (!c.rows[0]) return null;
      workflowId = c.rows[0].workflow_id;
      if (c.rows[0].answered_at)
        resolution = {
          outcome: 'answered',
          at: c.rows[0].answered_at.toISOString(),
          by: c.rows[0].answered_by,
        };
    }
  }
  const r = await client.query<Row>(
    `${ROW_SELECT} WHERE w.id = $3 AND w.organization_id = $1 AND w.project_id = ANY($2::uuid[])`,
    [scope.organizationId, scope.projectIds, workflowId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { item: toItem(row, now), resolution };
}

export { riskRank };
