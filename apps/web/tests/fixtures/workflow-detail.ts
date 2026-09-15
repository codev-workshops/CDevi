import type { WorkflowDetail, WorkflowState } from '@cdevi/contracts';

export const NOW = '2026-09-14T09:00:00.000Z';
const at = (minsAgo: number) => new Date(new Date(NOW).getTime() - minsAgo * 60_000).toISOString();
let n = 0;
const uuid = () => `00000000-0000-7000-8000-${(++n).toString(16).padStart(12, '0')}`;

const NAMES = ['Specify', 'Plan', 'Implement', 'Test', 'Review', 'Approve', 'Merge'];

type Stage = WorkflowDetail['stages'][number];
const stage = (position: number, state: WorkflowState, current = false): Stage => {
  const start = 200 - position * 20;
  const done = state === 'COMPLETED' || state === 'FAILED' || state === 'CANCELLED';
  return {
    id: uuid(),
    position,
    name: NAMES[position - 1]!,
    state,
    stateObservedAt: at(done ? start - 15 : start),
    stateReason: state === 'WAITING_FOR_HUMAN' ? 'Approval required before merge' : null,
    agent: state === 'QUEUED' ? null : `${NAMES[position - 1]} Agent`,
    startedAt: state === 'QUEUED' ? null : at(start),
    finishedAt: done ? at(start - 15) : null,
    elapsedMs: state === 'QUEUED' ? null : (done ? 15 : start) * 60_000,
    errorSummary: state === 'FAILED' ? 'Unit tests failed: 3 of 120' : null,
    requiresApproval: position === 6,
    current,
    agentRuns: [],
  };
};
const ref = (s: Stage) => ({ id: s.id, position: s.position, name: s.name });

export function detail(over: Partial<WorkflowDetail> = {}): WorkflowDetail {
  const stages = [
    stage(1, 'COMPLETED'),
    stage(2, 'COMPLETED'),
    stage(3, 'COMPLETED'),
    stage(4, 'COMPLETED'),
    stage(5, 'COMPLETED'),
    stage(6, 'WAITING_FOR_HUMAN', true),
    stage(7, 'QUEUED'),
  ];
  const cur = stages[5]!;
  return {
    generatedAt: NOW,
    workflow: {
      id: uuid(),
      externalId: 's500-001',
      title: 'Add rate limiting to /api/auth',
      project: { id: uuid(), key: 'payments-api', name: 'Payments API' },
      state: 'WAITING_FOR_HUMAN',
      stateReason: 'Approval required before merge',
      stateObservedAt: at(80),
      agent: 'Approve Agent',
      pullRequestRef: 'payments-api#412',
      startedAt: at(180),
      finishedAt: null,
      elapsedMs: 180 * 60_000,
      stage: { index: 6, count: 7, name: 'Approve' },
      riskLevel: 'HIGH',
    },
    stages,
    currentStage: {
      stage: ref(cur),
      state: 'WAITING_FOR_HUMAN',
      agent: 'Approve Agent',
      model: 'fable-5.1',
      startedAt: cur.startedAt,
      elapsedMs: 80 * 60_000,
      summary: 'Waiting for a human: Approval required before merge',
    },
    nextStage: ref(stages[6]!),
    progress: { completed: 5, total: 7 },
    activity: [
      {
        at: at(180),
        source: 'workflow',
        message: 'Workflow started',
        stage: null,
        state: 'RUNNING',
      },
      {
        at: at(180),
        source: 'stage',
        message: 'Specify → running',
        stage: ref(stages[0]!),
        state: 'RUNNING',
      },
      {
        at: at(165),
        source: 'agent',
        message: 'Specify Agent: drafted the requirement spec',
        stage: ref(stages[0]!),
        state: null,
      },
      {
        at: at(120),
        source: 'stage',
        message: 'Test → failed: 3 unit tests failed',
        stage: ref(stages[3]!),
        state: 'FAILED',
      },
      {
        at: at(110),
        source: 'stage',
        message: 'Test → retrying',
        stage: ref(stages[3]!),
        state: 'RETRYING',
      },
      {
        at: at(80),
        source: 'stage',
        message: 'Approve → needs you: Approval required before merge',
        stage: ref(cur),
        state: 'WAITING_FOR_HUMAN',
      },
    ],
    artifacts: [
      {
        id: uuid(),
        type: 'requirement_spec',
        title: 'Requirement spec',
        href: 'https://example.test/spec',
        summary: null,
        producedAt: at(165),
        stage: ref(stages[0]!),
      },
      {
        id: uuid(),
        type: 'impact_analysis',
        title: 'Impact analysis',
        href: null,
        summary: 'Touches auth middleware only',
        producedAt: at(150),
        stage: ref(stages[1]!),
      },
      {
        id: uuid(),
        type: 'implementation_plan',
        title: 'Implementation plan',
        href: null,
        summary: null,
        producedAt: at(145),
        stage: ref(stages[1]!),
      },
      {
        id: uuid(),
        type: 'code_diff',
        title: 'Code diff',
        href: 'https://example.test/diff',
        summary: null,
        producedAt: at(130),
        stage: ref(stages[2]!),
      },
      {
        id: uuid(),
        type: 'test_results',
        title: 'Test results',
        href: 'https://example.test/tests',
        summary: null,
        producedAt: at(100),
        stage: ref(stages[3]!),
      },
      {
        id: uuid(),
        type: 'pull_request',
        title: 'PR #412',
        href: 'https://example.test/pr/412',
        summary: null,
        producedAt: at(90),
        stage: ref(stages[4]!),
      },
    ],
    testRuns: [
      {
        id: uuid(),
        category: 'unit',
        status: 'FAILED',
        total: 120,
        passed: 117,
        failed: 3,
        skipped: 0,
        href: null,
        startedAt: at(125),
        finishedAt: at(120),
        stage: ref(stages[3]!),
      },
      {
        id: uuid(),
        category: 'unit',
        status: 'PASSED',
        total: 120,
        passed: 120,
        failed: 0,
        skipped: 0,
        href: 'https://example.test/tests',
        startedAt: at(108),
        finishedAt: at(100),
        stage: ref(stages[3]!),
      },
    ],
    attention: {
      state: 'WAITING_FOR_HUMAN',
      stage: ref(cur),
      reason: 'Approval required before merge',
      since: at(80),
      riskLevel: 'HIGH',
      action: { label: 'Open approval', href: '/approvals/00000000-0000-7000-8000-0000000000aa' },
    },
    failure: null,
    actions: { retry: false, escalate: true, cancel: true },
    ...over,
  };
}

/** Failed at stage 5 (Review) after 4 completed stages. */
export function failedDetail(
  actions: WorkflowDetail['actions'] = { retry: true, escalate: true, cancel: true },
): WorkflowDetail {
  const stages = [
    stage(1, 'COMPLETED'),
    stage(2, 'COMPLETED'),
    stage(3, 'COMPLETED'),
    stage(4, 'COMPLETED'),
    stage(5, 'FAILED', true),
    stage(6, 'QUEUED'),
    stage(7, 'QUEUED'),
  ];
  const cur = stages[4]!;
  const d = detail({
    stages,
    currentStage: {
      stage: ref(cur),
      state: 'FAILED',
      agent: 'Review Agent',
      model: null,
      startedAt: cur.startedAt,
      elapsedMs: 15 * 60_000,
      summary: 'Failed: Unit tests failed: 3 of 120',
    },
    nextStage: ref(stages[5]!),
    progress: { completed: 4, total: 7 },
    attention: null,
    failure: {
      reason: 'Unit tests failed: 3 of 120',
      failedAt: cur.stateObservedAt,
      failingStage: ref(cur),
      lastSuccessfulStage: ref(stages[3]!),
    },
    actions,
  });
  d.workflow = {
    ...d.workflow,
    externalId: 's500-045',
    state: 'FAILED',
    stateReason: 'Unit tests failed: 3 of 120',
    riskLevel: null,
    stage: { index: 5, count: 7, name: 'Review' },
  };
  return d;
}

export function blockedDetail(): WorkflowDetail {
  const d = detail();
  const cur = d.stages[5]!;
  cur.state = 'BLOCKED';
  cur.stateReason = 'GitHub is unreachable';
  d.workflow = { ...d.workflow, state: 'BLOCKED', riskLevel: null };
  d.currentStage = {
    ...d.currentStage!,
    state: 'BLOCKED',
    summary: 'Blocked: GitHub is unreachable',
  };
  d.attention = {
    state: 'BLOCKED',
    stage: ref(cur),
    reason: 'GitHub is unreachable',
    since: at(30),
    riskLevel: null,
    action: { label: 'Open integrations', href: '/admin/integrations' },
  };
  d.actions = { retry: false, escalate: true, cancel: true };
  return d;
}

export function completedDetail(): WorkflowDetail {
  const stages = NAMES.map((_, i) => stage(i + 1, 'COMPLETED', i === 6));
  const last = stages[6]!;
  const d = detail({
    stages,
    currentStage: {
      stage: ref(last),
      state: 'COMPLETED',
      agent: 'Merge Agent',
      model: null,
      startedAt: last.startedAt,
      elapsedMs: 15 * 60_000,
      summary: 'Completed',
    },
    nextStage: null,
    progress: { completed: 7, total: 7 },
    attention: null,
    failure: null,
    actions: { retry: false, escalate: false, cancel: false },
  });
  d.workflow = { ...d.workflow, state: 'COMPLETED', riskLevel: null, finishedAt: at(5) };
  return d;
}

export function emptyDetail(): WorkflowDetail {
  const d = detail({
    stages: [],
    currentStage: null,
    nextStage: null,
    progress: { completed: 0, total: 0 },
    activity: [],
    artifacts: [],
    testRuns: [],
    attention: null,
    failure: null,
    actions: { retry: false, escalate: false, cancel: true },
  });
  d.workflow = { ...d.workflow, state: 'QUEUED', riskLevel: null, stage: null, elapsedMs: null };
  return d;
}
