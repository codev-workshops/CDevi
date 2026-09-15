/**
 * Normative Workflow Detail derivations (specs/001 data-model.md §6). Pure functions over row-shaped
 * inputs; the API composes the response from them and the web never re-derives.
 */
import { canTransition, isTerminal } from './read-model';
import type { RiskLevel, Role, WorkflowState } from './vocabulary';
import type {
  ActionsView,
  ActivityEvent,
  AgentRunEvent,
  ArtifactType,
  ArtifactView,
  AttentionView,
  FailureView,
  StageRef,
  TestRunStatus,
  TestRunView,
  WorkflowStageView,
} from './workflow-detail';

export const ACTIVITY_LIMIT = 200;
export const ARTIFACT_LIMIT = 100;
export const TEST_RUN_LIMIT = 50;

export interface StageRow {
  id: string;
  position: number;
  name: string;
  state: WorkflowState;
  stateObservedAt: Date;
  stateReason: string | null;
  agent: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorSummary: string | null;
  requiresApproval: boolean;
  approvalId: string | null;
  clarificationId: string | null;
}

export interface RunRow {
  id: string;
  stageId: string;
  agent: string;
  model: string | null;
  state: WorkflowState;
  startedAt: Date;
  finishedAt: Date | null;
  summary: string | null;
  timeline: AgentRunEvent[];
}

export interface ArtifactRow {
  id: string;
  externalId: string;
  stageId: string;
  type: ArtifactType;
  title: string;
  href: string | null;
  summary: string | null;
  producedAt: Date;
}

export interface TestRunRow {
  id: string;
  stageId: string;
  category: string;
  status: TestRunStatus;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  href: string | null;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface TransitionRow {
  stageId: string | null;
  fromState: WorkflowState | null;
  toState: WorkflowState;
  observedAt: Date;
  reason: string | null;
  byUser: string | null;
}

export interface AttentionSourceRow {
  approval: { id: string; ask: string; riskLevel: RiskLevel; requestedAt: Date } | null;
  clarification: { id: string; question: string; requestedAt: Date } | null;
}

const cmp = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);
const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

export const stageRef = (s: StageRow): StageRef => ({
  id: s.id,
  position: s.position,
  name: s.name,
});

// ---- §6.1 ordering, current, next, progress
export function orderStages<T extends { position: number }>(stages: readonly T[]): T[] {
  return [...stages].sort((a, b) => cmp(a.position, b.position));
}

const ACTIVE: ReadonlySet<WorkflowState> = new Set([
  'RUNNING',
  'RETRYING',
  'WAITING',
  'WAITING_FOR_HUMAN',
  'BLOCKED',
  'FAILED',
]);

/** First stage that is active (not QUEUED, not terminal); else first QUEUED; else the last stage. */
export function deriveCurrentStage(stages: readonly StageRow[]): StageRow | null {
  const ordered = orderStages(stages);
  if (ordered.length === 0) return null;
  return (
    ordered.find((s) => ACTIVE.has(s.state)) ??
    ordered.find((s) => s.state === 'QUEUED') ??
    ordered[ordered.length - 1] ??
    null
  );
}

export function nextStage(stages: readonly StageRow[], current: StageRow | null): StageRef | null {
  if (!current) return null;
  const following = orderStages(stages).find((s) => s.position > current.position);
  return following ? stageRef(following) : null;
}

export function deriveProgress(stages: readonly StageRow[]): { completed: number; total: number } {
  return {
    completed: stages.filter((s) => s.state === 'COMPLETED').length,
    total: stages.length,
  };
}

// ---- §6.2 elapsed
export function stageElapsed(
  stage: { startedAt: Date | null; finishedAt: Date | null },
  now: Date,
): number | null {
  if (!stage.startedAt) return null;
  const end = stage.finishedAt ?? now;
  return Math.max(0, end.getTime() - stage.startedAt.getTime());
}

export const workflowElapsed = stageElapsed;

/** `runs` are the stage's agent runs (US5 drill-down), bounded to 20; omitted by callers that predate US5. */
export function toStageView(
  stage: StageRow,
  current: StageRow | null,
  now: Date,
  runs: ReadonlyArray<Pick<RunRow, 'id' | 'stageId' | 'agent' | 'state'>> = [],
): WorkflowStageView {
  return {
    id: stage.id,
    position: stage.position,
    name: stage.name,
    state: stage.state,
    stateObservedAt: iso(stage.stateObservedAt),
    stateReason: stage.stateReason,
    agent: stage.agent,
    startedAt: isoOrNull(stage.startedAt),
    finishedAt: isoOrNull(stage.finishedAt),
    elapsedMs: stageElapsed(stage, now),
    errorSummary: stage.errorSummary,
    requiresApproval: stage.requiresApproval,
    current: current?.id === stage.id,
    agentRuns: runs
      .filter((r) => r.stageId === stage.id)
      .slice(0, 20)
      .map((r) => ({ id: r.id, agent: r.agent, state: r.state, stagePosition: stage.position })),
  };
}

// ---- §6.3 plain-language summary of the current stage
const STATE_SENTENCE: Record<WorkflowState, string> = {
  QUEUED: 'is queued and waiting for an agent to pick it up.',
  RUNNING: 'is being worked on.',
  RETRYING: 'is being retried after a failure.',
  WAITING: 'is waiting on an external system.',
  WAITING_FOR_HUMAN: 'is waiting for a human decision.',
  BLOCKED: 'is blocked.',
  FAILED: 'has failed.',
  COMPLETED: 'is complete.',
  CANCELLED: 'was cancelled.',
};

export function describeStage(stage: StageRow, run: RunRow | null): string {
  const who = run?.agent ?? stage.agent;
  const head = `${who ? `${who} — ` : ''}${stage.name} ${STATE_SENTENCE[stage.state]}`;
  const tail = run?.summary ?? stage.stateReason ?? stage.errorSummary;
  return tail ? `${head} ${tail}` : head;
}

export function latestRunFor(stage: StageRow | null, runs: readonly RunRow[]): RunRow | null {
  if (!stage) return null;
  return runs.reduce<RunRow | null>(
    (latest, r) =>
      r.stageId === stage.id && (!latest || r.startedAt.getTime() >= latest.startedAt.getTime())
        ? r
        : latest,
    null,
  );
}

// ---- §6.4 activity
const STATE_WORD: Record<WorkflowState, string> = {
  QUEUED: 'queued',
  RUNNING: 'running',
  RETRYING: 'retrying',
  WAITING: 'waiting',
  WAITING_FOR_HUMAN: 'needs you',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

export function orderActivity(
  stages: readonly StageRow[],
  transitions: readonly TransitionRow[],
  runs: readonly RunRow[],
  limit = ACTIVITY_LIMIT,
): ActivityEvent[] {
  const byId = new Map(stages.map((s) => [s.id, s] as const));
  const refOf = (stageId: string | null): StageRef | null => {
    const s = stageId ? byId.get(stageId) : undefined;
    return s ? stageRef(s) : null;
  };
  const events: ActivityEvent[] = [];
  for (const t of transitions) {
    const ref = refOf(t.stageId);
    const subject = ref ? ref.name : 'Workflow';
    const base = `${subject} ${STATE_WORD[t.toState]}`;
    const message = t.byUser
      ? `${base} — ${t.reason ?? `by ${t.byUser}`}`
      : t.reason
        ? `${base} — ${t.reason}`
        : base;
    events.push({
      at: iso(t.observedAt),
      source: t.byUser ? 'human' : ref ? 'stage' : 'workflow',
      message,
      stage: ref,
      state: t.toState,
    });
  }
  for (const r of runs) {
    const ref = refOf(r.stageId);
    events.push({
      at: iso(r.startedAt),
      source: 'agent',
      message: `${r.agent} started${r.model ? ` (${r.model})` : ''}`,
      stage: ref,
      state: null,
    });
    for (const e of r.timeline) {
      events.push({
        at: e.at,
        source: 'agent',
        message: `${r.agent}: ${e.message}`,
        stage: ref,
        state: null,
      });
    }
    if (r.finishedAt) {
      events.push({
        at: iso(r.finishedAt),
        source: 'agent',
        message: `${r.agent} finished — ${STATE_WORD[r.state]}${r.summary ? `: ${r.summary}` : ''}`,
        stage: ref,
        state: r.state,
      });
    }
  }
  events.sort((a, b) => cmpStr(a.at, b.at) || cmpStr(a.message, b.message));
  return events.length > limit ? events.slice(events.length - limit) : events;
}

// ---- §6.5 artifacts and test runs
export function groupArtifactsByStage(
  artifacts: readonly ArtifactRow[],
  stages: readonly StageRow[],
  limit = ARTIFACT_LIMIT,
): ArtifactView[] {
  const byId = new Map(stages.map((s) => [s.id, s] as const));
  const views: ArtifactView[] = [];
  for (const a of artifacts) {
    const s = byId.get(a.stageId);
    if (!s) continue;
    views.push({
      id: a.id,
      externalId: a.externalId,
      type: a.type,
      title: a.title,
      href: a.href,
      summary: a.summary,
      producedAt: iso(a.producedAt),
      stage: stageRef(s),
    });
  }
  views.sort(
    (a, b) =>
      cmp(a.stage.position, b.stage.position) ||
      cmpStr(a.producedAt, b.producedAt) ||
      cmpStr(a.id, b.id),
  );
  return views.slice(0, limit);
}

export function orderTestRuns(
  runs: readonly TestRunRow[],
  stages: readonly StageRow[],
  limit = TEST_RUN_LIMIT,
): TestRunView[] {
  const byId = new Map(stages.map((s) => [s.id, s] as const));
  const views: TestRunView[] = [];
  for (const r of runs) {
    const s = byId.get(r.stageId);
    if (!s) continue;
    views.push({
      id: r.id,
      category: r.category,
      status: r.status,
      total: r.total,
      passed: r.passed,
      failed: r.failed,
      skipped: r.skipped,
      href: r.href,
      startedAt: iso(r.startedAt),
      finishedAt: isoOrNull(r.finishedAt),
      stage: stageRef(s),
    });
  }
  views.sort((a, b) => cmpStr(a.startedAt, b.startedAt) || cmpStr(a.id, b.id));
  return views.slice(0, limit);
}

// ---- §6.6 attention (FR-005)
export const INTEGRATIONS_HREF = '/integrations';

export function deriveAttention(
  stages: readonly StageRow[],
  source: AttentionSourceRow,
): AttentionView | null {
  const stage = orderStages(stages).find(
    (s) => s.state === 'WAITING_FOR_HUMAN' || s.state === 'BLOCKED',
  );
  if (!stage) return null;
  const ref = stageRef(stage);
  if (stage.state === 'WAITING_FOR_HUMAN') {
    if (source.approval) {
      return {
        state: 'WAITING_FOR_HUMAN',
        stage: ref,
        reason: source.approval.ask,
        since: iso(source.approval.requestedAt),
        riskLevel: source.approval.riskLevel,
        action: { label: 'Review approval', href: `/approvals/${source.approval.id}` },
      };
    }
    if (source.clarification) {
      return {
        state: 'WAITING_FOR_HUMAN',
        stage: ref,
        reason: source.clarification.question,
        since: iso(source.clarification.requestedAt),
        riskLevel: null,
        action: { label: 'Answer clarification', href: `/approvals/${source.clarification.id}` },
      };
    }
    return {
      state: 'WAITING_FOR_HUMAN',
      stage: ref,
      reason: stage.stateReason ?? 'Waiting for a person — no request recorded',
      since: iso(stage.stateObservedAt),
      riskLevel: null,
      action: { label: 'Open Inbox', href: '/inbox' },
    };
  }
  return {
    state: 'BLOCKED',
    stage: ref,
    reason: stage.stateReason ?? 'Blocked — reason not provided',
    since: iso(stage.stateObservedAt),
    riskLevel: null,
    action: { label: 'Open Integrations', href: INTEGRATIONS_HREF },
  };
}

// ---- §6.7 failure (FR-006)
export function deriveFailure(
  workflow: { state: WorkflowState; stateReason: string | null; stateObservedAt: Date },
  stages: readonly StageRow[],
): FailureView | null {
  const ordered = orderStages(stages);
  const failing = ordered.find((s) => s.state === 'FAILED');
  if (!failing && workflow.state !== 'FAILED') return null;
  const anchor =
    failing ?? ordered.find((s) => s.errorSummary !== null) ?? deriveCurrentStage(ordered);
  if (!anchor) return null;
  const lastSuccess = [...ordered]
    .reverse()
    .find((s) => s.state === 'COMPLETED' && s.position < anchor.position);
  return {
    reason:
      failing?.errorSummary ??
      failing?.stateReason ??
      workflow.stateReason ??
      'Failure reason not recorded',
    failedAt: iso(failing?.stateObservedAt ?? workflow.stateObservedAt),
    failingStage: stageRef(anchor),
    lastSuccessfulStage: lastSuccess ? stageRef(lastSuccess) : null,
  };
}

// ---- §6.8 role-gated actions (FR-006, research R5)
const MAY_RETRY_CANCEL: ReadonlySet<Role> = new Set(['engineer', 'administrator']);
const MAY_ESCALATE: ReadonlySet<Role> = new Set(['engineer', 'approver', 'administrator']);
const ESCALATABLE: ReadonlySet<WorkflowState> = new Set(['FAILED', 'BLOCKED', 'WAITING_FOR_HUMAN']);

export function allowedActions(role: Role, state: WorkflowState): ActionsView {
  return {
    retry: MAY_RETRY_CANCEL.has(role) && state === 'FAILED' && canTransition(state, 'RETRYING'),
    escalate: MAY_ESCALATE.has(role) && ESCALATABLE.has(state),
    cancel: MAY_RETRY_CANCEL.has(role) && !isTerminal(state) && canTransition(state, 'CANCELLED'),
  };
}

/** Artifact type → the word shown in its Pill (contract §2.9). */
export const ARTIFACT_WORDS: Readonly<Record<ArtifactType, string>> = {
  requirement_spec: 'requirement spec',
  impact_analysis: 'impact analysis',
  implementation_plan: 'implementation plan',
  test_results: 'test results',
  code_diff: 'code diff',
  pull_request: 'pull request',
};
