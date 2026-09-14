import type { InboxItem, InboxSnapshot, Me } from '@cdevi/contracts';

export const NOW = '2026-09-14T09:00:00.000Z';
const ago = (ms: number) => new Date(new Date(NOW).getTime() - ms).toISOString();
const ahead = (ms: number) => new Date(new Date(NOW).getTime() + ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const P = { id: '00000000-0000-7000-8000-00000000000a', key: 'payments-api' };
const W = { id: '00000000-0000-7000-8000-00000000000b', key: 'web-app' };
let n = 0;
const uuid = () => `00000000-0000-7000-8000-${(++n).toString(16).padStart(12, '0')}`;

const base = (over: Partial<InboxItem>): InboxItem => ({
  workflowId: uuid(),
  title: 'Add rate limiting to /api/auth',
  project: P,
  agent: 'Implementation Agent',
  state: 'WAITING_FOR_HUMAN',
  tab: 'needsYou',
  kind: 'approval',
  ask: null,
  riskLevel: null,
  raisedAt: ago(4 * MIN),
  isStale: false,
  expiry: null,
  hasRecommendedAnswer: false,
  stage: { index: 6, count: 7, name: 'Review' },
  startedAt: ago(2 * HOUR),
  finishedAt: null,
  pullRequestRef: null,
  requestId: null,
  href: '',
  ...over,
});
const approval = (over: Partial<InboxItem>) => {
  const requestId = uuid();
  return base({ kind: 'approval', requestId, href: `/approvals/${requestId}`, ...over });
};

export const me: Me = {
  user: { id: uuid(), displayName: 'Approver 1', role: 'approver' },
  organization: { id: uuid(), name: 'Acme Engineering', isDemo: true },
  projects: [
    { ...P, name: 'Payments API' },
    { ...W, name: 'Web App' },
  ],
  canCreateRequirement: true,
};

export const needsYouItems: InboxItem[] = [
  approval({
    title: 'Rotate signing keys',
    ask: 'Approve: rotate production signing keys',
    riskLevel: 'CRITICAL',
    raisedAt: ago(40 * MIN),
    expiry: { expiresAt: ahead(3 * HOUR + 56 * MIN), isExpired: false },
  }),
  approval({
    title: 'Add rate limiting to /api/auth',
    ask: 'Approve: open a pull request against `main`',
    riskLevel: 'HIGH',
    raisedAt: ago(40 * MIN),
  }),
  approval({
    title: 'Webhook retry policy',
    ask: 'Approve: run the database migration on staging',
    riskLevel: 'MEDIUM',
    raisedAt: ago(30 * HOUR),
    isStale: true,
  }),
  approval({
    title: 'Bump dependencies (weekly)',
    ask: 'Approve: add a new dependency `ioredis`',
    riskLevel: 'LOW',
    raisedAt: ago(5 * HOUR),
    expiry: { expiresAt: ago(15 * MIN), isExpired: true },
  }),
  (() => {
    const requestId = uuid();
    return base({
      title: 'Migrate sessions to Redis',
      project: W,
      agent: 'Requirement Agent',
      kind: 'clarification',
      ask: 'Question: keep the legacy `/session/v1` endpoint during migration?',
      raisedAt: ago(2 * HOUR),
      hasRecommendedAnswer: true,
      requestId,
      href: `/approvals/${requestId}`,
    });
  })(),
  (() => {
    const id = uuid();
    return base({
      workflowId: id,
      title: 'Order status webhooks',
      state: 'BLOCKED',
      kind: 'blocked',
      ask: 'Blocked: issue tracker unreachable',
      raisedAt: ago(10 * MIN),
      agent: null,
      href: `/workflows/${id}`,
    });
  })(),
  (() => {
    const id = uuid();
    return base({
      workflowId: id,
      title: 'Fix flaky checkout test',
      state: 'FAILED',
      kind: 'failed',
      ask: 'Failed at Testing: 3 unit tests failing',
      raisedAt: ago(3 * DAY),
      isStale: true,
      stage: { index: 5, count: 7, name: 'Testing' },
      href: `/workflows/${id}`,
    });
  })(),
];

export const runningItems: InboxItem[] = [
  (() => {
    const id = uuid();
    return base({
      workflowId: id,
      title: 'Split payments ledger table',
      state: 'RUNNING',
      tab: 'running',
      kind: 'running',
      raisedAt: ago(12 * MIN),
      startedAt: ago(12 * MIN),
      stage: { index: 2, count: 7, name: 'Implementation' },
      href: `/workflows/${id}`,
    });
  })(),
  (() => {
    const id = uuid();
    return base({
      workflowId: id,
      title: 'Retry queue for emails',
      state: 'RETRYING',
      tab: 'running',
      kind: 'running',
      raisedAt: ago(2 * MIN),
      startedAt: ago(50 * MIN),
      stage: { index: 4, count: 7, name: 'Implementation' },
      href: `/workflows/${id}`,
    });
  })(),
  (() => {
    const id = uuid();
    return base({
      workflowId: id,
      title: 'Upgrade Node runtime',
      state: 'WAITING',
      tab: 'running',
      kind: 'running',
      raisedAt: ago(3 * MIN),
      startedAt: ago(70 * MIN),
      stage: { index: 5, count: 7, name: 'Testing' },
      href: `/workflows/${id}`,
    });
  })(),
  (() => {
    const id = uuid();
    return base({
      workflowId: id,
      title: 'Tenant-aware caching',
      state: 'QUEUED',
      tab: 'running',
      kind: 'running',
      raisedAt: ago(5 * MIN),
      startedAt: null,
      stage: null,
      href: `/workflows/${id}`,
    });
  })(),
];

export const doneItems: InboxItem[] = [
  (() => {
    const id = uuid();
    return base({
      workflowId: id,
      title: 'Audit log export',
      state: 'COMPLETED',
      tab: 'done',
      kind: 'done',
      raisedAt: ago(2 * HOUR),
      startedAt: ago(4 * HOUR),
      finishedAt: ago(2 * HOUR),
      stage: { index: 7, count: 7, name: 'PR' },
      pullRequestRef: 'PR #412',
      href: `/workflows/${id}`,
    });
  })(),
  (() => {
    const id = uuid();
    return base({
      workflowId: id,
      title: 'Improve search relevance',
      state: 'CANCELLED',
      tab: 'done',
      kind: 'done',
      raisedAt: ago(DAY),
      startedAt: ago(DAY + HOUR),
      finishedAt: ago(DAY),
      stage: { index: 3, count: 7, name: 'Architecture' },
      href: `/workflows/${id}`,
    });
  })(),
];

export function snapshot(over: Partial<InboxSnapshot> = {}): InboxSnapshot {
  return {
    generatedAt: NOW,
    project: 'all',
    tab: 'needsYou',
    counts: {
      needsYou: needsYouItems.length,
      running: runningItems.length + 96,
      done: doneItems.length + 303,
    },
    items: needsYouItems,
    nextCursor: null,
    today: {
      timezone: 'Asia/Colombo',
      windowStart: '2026-09-13T18:30:00.000Z',
      workflowsStarted: { value: 9, href: '/inbox?tab=running&project=all' },
      workflowsCompleted: { value: 5, href: '/inbox?tab=done&project=all' },
      approvalsDecided: { value: 3, href: '/approvals?decided=today&project=all' },
      needsYou: { value: needsYouItems.length, href: '/inbox?tab=needsYou&project=all' },
    },
    policySummary: {
      text: 'Pull request merges and all HIGH/CRITICAL actions require human approval.',
      href: '/policies',
    },
    ...over,
  };
}
