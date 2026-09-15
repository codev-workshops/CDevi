import type {
  ActiveWorkflowCard,
  DashboardSnapshot,
  WindowKey,
  WorkflowState,
} from '@cdevi/contracts';
import { dashboardHrefs, pipelineFrom, windowFor } from '@cdevi/contracts/dashboard-model';
import { me } from './snapshot';

/** Fixed clock shared with the other fixtures (quickstart §4.2 figures are relative to it). */
export const NOW = '2026-09-14T09:00:00.000Z';
const MIN = 60_000;
const HOUR = 60 * MIN;
const ago = (ms: number) => new Date(new Date(NOW).getTime() - ms).toISOString();

/** The `dashboard-demo` project as it would appear in `me.projects` for an administrator. */
export const DASHBOARD_DEMO = {
  id: '00000000-0000-7000-8000-0000000000dd',
  key: 'dashboard-demo',
  name: 'Dashboard Demo',
};

/** `me` with the Dashboard Demo project appended (administrator visibility rule). */
export const adminMe = { ...me, projects: [...me.projects, DASHBOARD_DEMO] };

let n = 0;
const uuid = () => `00000000-0000-7000-9d00-${(++n).toString(16).padStart(12, '0')}`;

interface CardSeed {
  externalId: string;
  title: string;
  state: WorkflowState;
  stageIndex: number | null;
  agent: string | null;
  startedAgoMs: number | null;
  observedAgoMs: number;
}

const STAGE_NAMES = [
  'Requirement',
  'Analysis',
  'Architecture',
  'Implementation',
  'Testing',
  'Review',
  'PR',
] as const;

const hrefs7d = dashboardHrefs('7d');

function card(seed: CardSeed): ActiveWorkflowCard {
  const workflowId = uuid();
  const index = seed.stageIndex;
  return {
    workflowId,
    externalId: seed.externalId,
    title: seed.title,
    stage: {
      index,
      count: STAGE_NAMES.length,
      name: index == null ? null : (STAGE_NAMES[index - 1] ?? null),
    },
    progress: { done: index == null ? 0 : index - 1, total: STAGE_NAMES.length },
    agent: seed.agent,
    elapsedMs: seed.startedAgoMs,
    state: seed.state,
    stateObservedAt: ago(seed.observedAgoMs),
    href: hrefs7d.workflow(workflowId),
  };
}

/** Twelve of the eighteen active `dashboard-demo` workflows, newest state change first (API order). */
export const cards: ActiveWorkflowCard[] = [
  card({
    externalId: 's500-d05',
    title: 'Add idempotency keys to payment intents',
    state: 'RUNNING',
    stageIndex: 4,
    agent: 'Implementation Agent',
    startedAgoMs: 2 * HOUR + 5 * MIN,
    observedAgoMs: 3 * MIN,
  }),
  card({
    externalId: 's500-d07',
    title: 'Rotate signing keys',
    state: 'WAITING_FOR_HUMAN',
    stageIndex: 6,
    agent: 'Review Agent',
    startedAgoMs: 5 * HOUR,
    observedAgoMs: 12 * MIN,
  }),
  card({
    externalId: 's500-d11',
    title: 'Retry webhook delivery with back-off',
    state: 'RETRYING',
    stageIndex: 5,
    agent: 'Test Agent',
    startedAgoMs: 40 * MIN,
    observedAgoMs: 15 * MIN,
  }),
  card({
    externalId: 's500-d02',
    title: 'Rate limiting for /login',
    state: 'BLOCKED',
    stageIndex: 3,
    agent: 'Architecture Agent',
    startedAgoMs: 26 * HOUR,
    observedAgoMs: 30 * MIN,
  }),
  card({
    externalId: 's500-d09',
    title: 'Migrate sessions to Redis',
    state: 'FAILED',
    stageIndex: 5,
    agent: 'Test Agent',
    startedAgoMs: 3 * HOUR,
    observedAgoMs: 45 * MIN,
  }),
  card({
    externalId: 's500-d13',
    title: 'Audit export as CSV',
    state: 'WAITING_FOR_HUMAN',
    stageIndex: 1,
    agent: 'Requirement Agent',
    startedAgoMs: 50 * MIN,
    observedAgoMs: 1 * HOUR,
  }),
  card({
    externalId: 's500-d14',
    title: 'Refund flow for partial captures',
    state: 'RUNNING',
    stageIndex: 2,
    agent: 'Analysis Agent',
    startedAgoMs: 70 * MIN,
    observedAgoMs: 65 * MIN,
  }),
  card({
    externalId: 's500-d16',
    title: 'Dark mode for the merchant portal',
    state: 'WAITING',
    stageIndex: 4,
    agent: null,
    startedAgoMs: 4 * HOUR,
    observedAgoMs: 90 * MIN,
  }),
  card({
    externalId: 's500-d17',
    title: 'Deprecate v1 checkout endpoints',
    state: 'WAITING_FOR_HUMAN',
    stageIndex: 7,
    agent: 'PR Agent',
    startedAgoMs: 9 * HOUR,
    observedAgoMs: 2 * HOUR,
  }),
  card({
    externalId: 's500-d19',
    title: 'Structured logging for the gateway',
    state: 'RUNNING',
    stageIndex: 6,
    agent: 'Review Agent',
    startedAgoMs: 6 * HOUR,
    observedAgoMs: 3 * HOUR,
  }),
  card({
    externalId: 's500-d21',
    title: 'Feature flags for regional pricing',
    state: 'QUEUED',
    stageIndex: null,
    agent: null,
    startedAgoMs: null,
    observedAgoMs: 4 * HOUR,
  }),
  card({
    externalId: 's500-d23',
    title: 'Contract tests for the ledger service',
    state: 'RUNNING',
    stageIndex: 5,
    agent: 'Test Agent',
    startedAgoMs: 8 * HOUR,
    observedAgoMs: 5 * HOUR,
  }),
];

interface SnapshotOptions {
  project?: DashboardSnapshot['project'];
  window?: WindowKey;
}

function base(
  { project = DASHBOARD_DEMO.id, window = '7d' }: SnapshotOptions,
  over: Partial<Omit<DashboardSnapshot, 'project' | 'window' | 'generatedAt'>> = {},
): DashboardSnapshot {
  const h = dashboardHrefs(window);
  return {
    generatedAt: NOW,
    project,
    window: windowFor(window, new Date(NOW)),
    counts: {
      activeWorkflows: { value: 18, href: h.activeWorkflows },
      runningAgents: { value: 7, href: h.runningAgents },
      prsGenerated: { value: 6, href: h.prsGenerated },
      openFailures: { value: 2, href: h.openFailures },
    },
    pipeline: pipelineFrom([3, 2, 1, 4, 3, 3, 2], 1, h),
    needsMe: {
      approvals: { value: 4, href: h.approvals },
      clarifications: { value: 2, href: h.clarifications },
      failed: { value: 1, href: h.failed },
      blocked: { value: 1, href: h.blocked },
    },
    health: {
      testPassRate: { numerator: 974, denominator: 1000, href: h.testPassRate },
      agentSuccessRate: { numerator: 35, denominator: 37, href: h.agentSuccessRate },
      humanInterventionRate: { numerator: 8, denominator: 24, href: h.humanInterventionRate },
    },
    risk: {
      pendingHighCritical: { value: 2, href: h.pendingHighCritical },
      auditHighCritical: { value: 0, href: h.auditHighCritical },
      securityFindings: { connected: false, count: null, href: h.securityFindings },
    },
    activeWorkflows: cards,
    activeWorkflowsTotal: 18,
    ...over,
  };
}

/** quickstart §4.2: Dashboard Demo, Last 7 days — every Independent Test figure. */
export const populated: DashboardSnapshot = base({});

/** quickstart §4.2 step 4: Last 24 hours — nothing finished in the window, PRs drop to 1. */
export const zeroDenominators: DashboardSnapshot = (() => {
  const h = dashboardHrefs('24h');
  return base(
    { window: '24h' },
    {
      counts: { ...populated.counts, prsGenerated: { value: 1, href: h.prsGenerated } },
      health: {
        testPassRate: { numerator: 0, denominator: 0, href: h.testPassRate },
        agentSuccessRate: { numerator: 0, denominator: 0, href: h.agentSuccessRate },
        humanInterventionRate: { numerator: 0, denominator: 0, href: h.humanInterventionRate },
      },
      risk: {
        ...populated.risk,
        auditHighCritical: { value: 0, href: h.auditHighCritical },
      },
    },
  );
})();

/** A single project with nothing in it: zeros everywhere, no cards. */
export const empty: DashboardSnapshot = (() => {
  const h = dashboardHrefs('7d');
  const zero = (href: string) => ({ value: 0, href });
  return base(
    { project: me.projects[1]!.id },
    {
      counts: {
        activeWorkflows: zero(h.activeWorkflows),
        runningAgents: zero(h.runningAgents),
        prsGenerated: zero(h.prsGenerated),
        openFailures: zero(h.openFailures),
      },
      pipeline: pipelineFrom([0, 0, 0, 0, 0, 0, 0], 0, h),
      needsMe: {
        approvals: zero(h.approvals),
        clarifications: zero(h.clarifications),
        failed: zero(h.failed),
        blocked: zero(h.blocked),
      },
      health: {
        testPassRate: { numerator: 0, denominator: 0, href: h.testPassRate },
        agentSuccessRate: { numerator: 0, denominator: 0, href: h.agentSuccessRate },
        humanInterventionRate: { numerator: 0, denominator: 0, href: h.humanInterventionRate },
      },
      risk: {
        pendingHighCritical: zero(h.pendingHighCritical),
        auditHighCritical: zero(h.auditHighCritical),
        securityFindings: { connected: false, count: null, href: h.securityFindings },
      },
      activeWorkflows: [],
      activeWorkflowsTotal: 0,
    },
  );
})();

/** `all` for the administrator: S-500 + dashboard-demo (quickstart §4.2 step 6). */
export const allProjects: DashboardSnapshot = (() => {
  const h = dashboardHrefs('7d');
  return base(
    { project: 'all' },
    {
      counts: {
        activeWorkflows: { value: 118, href: h.activeWorkflows },
        runningAgents: { value: 107, href: h.runningAgents },
        prsGenerated: { value: 16, href: h.prsGenerated },
        openFailures: { value: 4, href: h.openFailures },
      },
      pipeline: pipelineFrom([19, 15, 11, 30, 17, 15, 10], 1, h),
      needsMe: {
        approvals: { value: 28, href: h.approvals },
        clarifications: { value: 14, href: h.clarifications },
        failed: { value: 2, href: h.failed },
        blocked: { value: 2, href: h.blocked },
      },
      health: {
        testPassRate: { numerator: 1974, denominator: 2020, href: h.testPassRate },
        agentSuccessRate: { numerator: 135, denominator: 142, href: h.agentSuccessRate },
        humanInterventionRate: { numerator: 68, denominator: 524, href: h.humanInterventionRate },
      },
      risk: {
        pendingHighCritical: { value: 12, href: h.pendingHighCritical },
        auditHighCritical: { value: 3, href: h.auditHighCritical },
        securityFindings: { connected: false, count: null, href: h.securityFindings },
      },
      activeWorkflowsTotal: 118,
    },
  );
})();
