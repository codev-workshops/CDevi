/**
 * Pure Dashboard derivation rules (specs/001 data-model.md §20, research R21–R25). No zod, no I/O, no
 * Date.now — the API shapes its eight aggregate statements into a DashboardSnapshot with
 * `buildDashboardSnapshot`; the browser reuses the hrefs, percentages and progress rules.
 */
import type {
  ActiveWorkflowCard,
  DashboardPipeline,
  DashboardSnapshot,
  PipelineStage,
  Rate,
  SdlcStageName,
  Window,
  WindowKey,
} from './dashboard';
import { isTerminal } from './read-model';
import { WORKFLOW_STATES, type WorkflowState } from './vocabulary';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ---- R24 state sets
/** The seven non-terminal states — WORKFLOW_STATES minus COMPLETED and CANCELLED. */
export const ACTIVE_STATES: readonly WorkflowState[] = WORKFLOW_STATES.filter((s) => !isTerminal(s));
export const RUNNING_AGENT_STATES: readonly WorkflowState[] = ['RUNNING', 'RETRYING'];
export const FAILURE_STATES: readonly WorkflowState[] = ['FAILED', 'BLOCKED'];

/** The seven SDLC stages of the pipeline view, in order (stage n = index n − 1). */
export const SDLC_STAGES = [
  'Requirement',
  'Analysis',
  'Architecture',
  'Implementation',
  'Testing',
  'Review',
  'PR',
] as const;

export const ACTIVE_CARD_LIMIT = 12;

// ---- R21 window
export const WINDOW_KEYS = ['24h', '7d', '30d'] as const;
export const WINDOW_MS: Readonly<Record<WindowKey, number>> = {
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
};

export function windowFor(key: WindowKey, now: Date): Window {
  return {
    key,
    from: new Date(now.getTime() - WINDOW_MS[key]).toISOString(),
    to: now.toISOString(),
  };
}

// ---- R25 hrefs
export interface DashboardHrefs {
  activeWorkflows: string;
  runningAgents: string;
  prsGenerated: string;
  openFailures: string;
  stage: (n: number) => string;
  unstaged: string;
  approvals: string;
  clarifications: string;
  failed: string;
  blocked: string;
  testPassRate: string;
  agentSuccessRate: string;
  humanInterventionRate: string;
  pendingHighCritical: string;
  auditHighCritical: string;
  securityFindings: string;
  workflow: (id: string) => string;
}

const HIGH_CRITICAL = 'HIGH,CRITICAL';

/** Every figure links to the filtered list behind it (FR-023); the project scope travels in the shared cookie. */
export function dashboardHrefs(window: WindowKey): DashboardHrefs {
  return {
    activeWorkflows: `/workflows?state=${ACTIVE_STATES.join(',')}`,
    runningAgents: `/workflows?state=${RUNNING_AGENT_STATES.join(',')}`,
    prsGenerated: `/workflows?hasPr=true&window=${window}`,
    openFailures: `/workflows?state=${FAILURE_STATES.join(',')}`,
    stage: (n) => `/workflows?stage=${n}`,
    unstaged: '/workflows?stage=none',
    approvals: '/approvals',
    clarifications: '/approvals?kind=clarification',
    failed: '/workflows?state=FAILED',
    blocked: '/workflows?state=BLOCKED',
    testPassRate: `/testing?window=${window}`,
    agentSuccessRate: `/agents?window=${window}`,
    humanInterventionRate: `/workflows?intervention=human&window=${window}`,
    pendingHighCritical: `/approvals?risk=${HIGH_CRITICAL}`,
    auditHighCritical: `/audit?risk=${HIGH_CRITICAL}&window=${window}`,
    securityFindings: '/reviews',
    workflow: (id) => `/workflows/${id}`,
  };
}

// ---- R24 display rules
/** Percent with one decimal; null when there is no evidence (the UI renders "—", never 0 % or NaN). */
export function ratePercent(rate: Pick<Rate, 'numerator' | 'denominator'> & { href?: string }): number | null {
  if (rate.denominator === 0) return null;
  return Math.round((1000 * rate.numerator) / rate.denominator) / 10;
}

export function stageProgress(
  index: number | null,
  count: number | null,
): { done: number; total: number } {
  return {
    done: index == null ? 0 : Math.max(index - 1, 0),
    total: Math.max(count ?? SDLC_STAGES.length, 1),
  };
}

export function elapsedMs(startedAt: Date | null, now: Date): number | null {
  return startedAt == null ? null : Math.max(now.getTime() - startedAt.getTime(), 0);
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** stateObservedAt desc, then workflowId asc — mirrors the Q8 `ORDER BY`. */
export function orderActiveCards(a: ActiveWorkflowCard, b: ActiveWorkflowCard): number {
  const byTime = cmpStr(b.stateObservedAt, a.stateObservedAt);
  return byTime !== 0 ? byTime : cmpStr(a.workflowId, b.workflowId);
}

export function pipelineFrom(
  stageCounts: readonly number[],
  unstaged: number,
  hrefs: DashboardHrefs = dashboardHrefs('7d'),
): DashboardPipeline {
  const stages: PipelineStage[] = SDLC_STAGES.map((name: SdlcStageName, i) => ({
    stage: i + 1,
    name,
    count: stageCounts[i] ?? 0,
    href: hrefs.stage(i + 1),
  }));
  return { stages, unstaged: { value: unstaged, href: hrefs.unstaged } };
}

// ---- R22 row shapes (the eight statements) and the snapshot builder
export interface ActiveCardRow {
  workflowId: string;
  externalId: string;
  title: string;
  agent: string | null;
  state: WorkflowState;
  stageIndex: number | null;
  stageCount: number | null;
  stageName: string | null;
  startedAt: Date | null;
  stateObservedAt: Date;
}

export interface DashboardRows {
  /** Q1 — workflows: point-in-time counts, per-stage counts (index 0 = stage 1) and windowed PRs. */
  workflows: {
    active: number;
    running: number;
    failures: number;
    failed: number;
    blocked: number;
    stages: readonly number[];
    unstaged: number;
    prsGenerated: number;
  };
  /** Q2 — pending approvals on WAITING_FOR_HUMAN workflows, and how many are HIGH/CRITICAL. */
  approvals: { pending: number; highCritical: number };
  /** Q3 — pending clarifications on WAITING_FOR_HUMAN workflows. */
  clarifications: { pending: number };
  /** Q4 — Σ passed and Σ (passed + failed) of test runs finished in the window. */
  testRuns: { passed: number; total: number };
  /** Q5 — COMPLETED and COMPLETED + FAILED agent runs finished in the window. */
  agentRuns: { completed: number; finished: number };
  /** Q6 — workflows with ≥ 1 human touch over workflows active or finished in the window. */
  intervention: { numerator: number; denominator: number };
  /** Q7 — HIGH/CRITICAL audit events in the window. */
  auditHighCritical: number;
  /** Q8 — ≤ 12 active workflows ordered stateObservedAt desc, id asc. */
  cards: readonly ActiveCardRow[];
}

const figure = (value: number, href: string) => ({ value, href });
const rate = (numerator: number, denominator: number, href: string): Rate => ({
  numerator: Math.min(numerator, denominator),
  denominator,
  href,
});

export function toActiveCard(row: ActiveCardRow, now: Date, hrefs: DashboardHrefs): ActiveWorkflowCard {
  const progress = stageProgress(row.stageIndex, row.stageCount);
  return {
    workflowId: row.workflowId,
    externalId: row.externalId,
    title: row.title,
    stage: { index: row.stageIndex, count: progress.total, name: row.stageName },
    progress,
    agent: row.agent,
    elapsedMs: elapsedMs(row.startedAt, now),
    state: row.state,
    stateObservedAt: row.stateObservedAt.toISOString(),
    href: hrefs.workflow(row.workflowId),
  };
}

export function buildDashboardSnapshot(
  rows: DashboardRows,
  now: Date,
  windowKey: WindowKey,
  project: DashboardSnapshot['project'],
): DashboardSnapshot {
  const hrefs = dashboardHrefs(windowKey);
  const w = rows.workflows;
  const cards = rows.cards
    .map((r) => toActiveCard(r, now, hrefs))
    .sort(orderActiveCards)
    .slice(0, ACTIVE_CARD_LIMIT);
  return {
    generatedAt: now.toISOString(),
    project,
    window: windowFor(windowKey, now),
    counts: {
      activeWorkflows: figure(w.active, hrefs.activeWorkflows),
      runningAgents: figure(w.running, hrefs.runningAgents),
      prsGenerated: figure(w.prsGenerated, hrefs.prsGenerated),
      openFailures: figure(w.failures, hrefs.openFailures),
    },
    pipeline: pipelineFrom(w.stages, w.unstaged, hrefs),
    needsMe: {
      approvals: figure(rows.approvals.pending, hrefs.approvals),
      clarifications: figure(rows.clarifications.pending, hrefs.clarifications),
      failed: figure(w.failed, hrefs.failed),
      blocked: figure(w.blocked, hrefs.blocked),
    },
    health: {
      testPassRate: rate(rows.testRuns.passed, rows.testRuns.total, hrefs.testPassRate),
      agentSuccessRate: rate(
        rows.agentRuns.completed,
        rows.agentRuns.finished,
        hrefs.agentSuccessRate,
      ),
      humanInterventionRate: rate(
        rows.intervention.numerator,
        rows.intervention.denominator,
        hrefs.humanInterventionRate,
      ),
    },
    risk: {
      pendingHighCritical: figure(rows.approvals.highCritical, hrefs.pendingHighCritical),
      auditHighCritical: figure(rows.auditHighCritical, hrefs.auditHighCritical),
      securityFindings: { connected: false, count: null, href: hrefs.securityFindings },
    },
    activeWorkflows: cards,
    activeWorkflowsTotal: w.active,
  };
}
