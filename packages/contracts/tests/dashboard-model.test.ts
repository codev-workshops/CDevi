import { describe, expect, it } from 'vitest';
import {
  ACTIVE_CARD_LIMIT,
  ACTIVE_STATES,
  buildDashboardSnapshot,
  dashboardHrefs,
  elapsedMs,
  FAILURE_STATES,
  isTerminal,
  orderActiveCards,
  pipelineFrom,
  ratePercent,
  RUNNING_AGENT_STATES,
  SDLC_STAGES,
  stageProgress,
  WINDOW_MS,
  windowFor,
  WORKFLOW_STATES,
  type ActiveCardRow,
  type ActiveWorkflowCard,
  type DashboardRows,
} from '../src/index';

const NOW = new Date('2026-09-14T09:00:00Z');
const m = 60_000;
const h = 60 * m;
const d = 24 * h;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const cardRow = (n: number, over: Partial<ActiveCardRow> = {}): ActiveCardRow => ({
  workflowId: uuid(n),
  externalId: `s500-d${String(n).padStart(2, '0')}`,
  title: `Workflow ${n}`,
  agent: 'devin',
  state: 'RUNNING',
  stageIndex: 4,
  stageCount: 7,
  stageName: 'Implementation',
  startedAt: ago(2 * h),
  stateObservedAt: ago(n * m),
  ...over,
});

/** The dashboard-demo figures of quickstart §4.2 (research R30). */
const demoRows = (): DashboardRows => ({
  workflows: {
    active: 18,
    running: 7,
    failures: 2,
    failed: 1,
    blocked: 1,
    stages: [3, 2, 1, 4, 3, 3, 2],
    unstaged: 0,
    prsGenerated: 6,
  },
  approvals: { pending: 4, highCritical: 2 },
  clarifications: { pending: 2 },
  testRuns: { passed: 974, total: 1000 },
  agentRuns: { completed: 35, finished: 37 },
  intervention: { numerator: 8, denominator: 24 },
  auditHighCritical: 0,
  cards: Array.from({ length: 12 }, (_, i) => cardRow(i + 1)),
});

describe('dashboard-model (specs/001 data-model.md §20, research R24/R25)', () => {
  it('FR-023 ACTIVE_STATES equals WORKFLOW_STATES minus terminal states and SDLC_STAGES has the seven stage names in order', () => {
    expect([...ACTIVE_STATES]).toEqual(WORKFLOW_STATES.filter((s) => !isTerminal(s)));
    expect([...ACTIVE_STATES]).toEqual([
      'QUEUED',
      'RUNNING',
      'RETRYING',
      'WAITING',
      'WAITING_FOR_HUMAN',
      'BLOCKED',
      'FAILED',
    ]);
    expect([...RUNNING_AGENT_STATES]).toEqual(['RUNNING', 'RETRYING']);
    expect([...FAILURE_STATES]).toEqual(['FAILED', 'BLOCKED']);
    expect([...SDLC_STAGES]).toEqual([
      'Requirement',
      'Analysis',
      'Architecture',
      'Implementation',
      'Testing',
      'Review',
      'PR',
    ]);
    expect(ACTIVE_CARD_LIMIT).toBe(12);
  });

  it('FR-023 windowFor returns from = now − 24h|7d|30d and to = now', () => {
    expect(WINDOW_MS).toEqual({ '24h': d, '7d': 7 * d, '30d': 30 * d });
    for (const key of ['24h', '7d', '30d'] as const) {
      const w = windowFor(key, NOW);
      expect(w.key).toBe(key);
      expect(w.to).toBe(NOW.toISOString());
      expect(new Date(w.from).getTime()).toBe(NOW.getTime() - WINDOW_MS[key]);
    }
  });

  it('FR-023 dashboardHrefs(\'7d\') returns the R25 table (stage n → /workflows?stage=n, /approvals, /approvals?kind=clarification, /workflows?state=FAILED, /approvals?risk=HIGH,CRITICAL, /audit?risk=HIGH,CRITICAL&window=7d, /reviews)', () => {
    const hrefs = dashboardHrefs('7d');
    expect(hrefs).toEqual({
      activeWorkflows: '/workflows?state=QUEUED,RUNNING,RETRYING,WAITING,WAITING_FOR_HUMAN,BLOCKED,FAILED',
      runningAgents: '/workflows?state=RUNNING,RETRYING',
      prsGenerated: '/workflows?hasPr=true&window=7d',
      openFailures: '/workflows?state=FAILED,BLOCKED',
      stage: expect.any(Function),
      unstaged: '/workflows?stage=none',
      approvals: '/approvals',
      clarifications: '/approvals?kind=clarification',
      failed: '/workflows?state=FAILED',
      blocked: '/workflows?state=BLOCKED',
      testPassRate: '/testing?window=7d',
      agentSuccessRate: '/agents?window=7d',
      humanInterventionRate: '/workflows?intervention=human&window=7d',
      pendingHighCritical: '/approvals?risk=HIGH,CRITICAL',
      auditHighCritical: '/audit?risk=HIGH,CRITICAL&window=7d',
      securityFindings: '/reviews',
      workflow: expect.any(Function),
    });
    for (let n = 1; n <= 7; n++) expect(hrefs.stage(n)).toBe(`/workflows?stage=${n}`);
    expect(hrefs.workflow(uuid(1))).toBe(`/workflows/${uuid(1)}`);
    expect(dashboardHrefs('24h').auditHighCritical).toBe('/audit?risk=HIGH,CRITICAL&window=24h');
    expect(dashboardHrefs('30d').prsGenerated).toBe('/workflows?hasPr=true&window=30d');
    for (const [k, v] of Object.entries(hrefs)) {
      if (typeof v === 'string') expect(v, k).toMatch(/^\//);
    }
  });

  it('FR-023 ratePercent returns null for denominator 0 and 97.4 for 974/1000', () => {
    expect(ratePercent({ numerator: 0, denominator: 0, href: '/testing' })).toBeNull();
    expect(ratePercent({ numerator: 974, denominator: 1000, href: '/testing' })).toBe(97.4);
    expect(ratePercent({ numerator: 35, denominator: 37, href: '/agents' })).toBe(94.6);
    expect(ratePercent({ numerator: 8, denominator: 24, href: '/workflows' })).toBe(33.3);
    expect(ratePercent({ numerator: 5, denominator: 5, href: '/testing' })).toBe(100);
  });

  it('FR-023 stageProgress maps index 4 of 7 to 3/7 and null index to 0/7', () => {
    expect(stageProgress(4, 7)).toEqual({ done: 3, total: 7 });
    expect(stageProgress(null, null)).toEqual({ done: 0, total: 7 });
    expect(stageProgress(1, 5)).toEqual({ done: 0, total: 5 });
    expect(stageProgress(null, 0)).toEqual({ done: 0, total: 1 });
    expect(stageProgress(7, 7)).toEqual({ done: 6, total: 7 });
  });

  it('FR-023 elapsedMs is null without startedAt and never negative', () => {
    expect(elapsedMs(null, NOW)).toBeNull();
    expect(elapsedMs(ago(2 * h), NOW)).toBe(2 * h);
    expect(elapsedMs(new Date(NOW.getTime() + h), NOW)).toBe(0);
  });

  it('FR-023 orderActiveCards sorts stateObservedAt desc then workflowId asc', () => {
    const card = (id: number, observed: Date): ActiveWorkflowCard => ({
      workflowId: uuid(id),
      externalId: `w-${id}`,
      title: 't',
      stage: { index: 1, count: 7, name: 'Requirement' },
      progress: { done: 0, total: 7 },
      agent: null,
      elapsedMs: null,
      state: 'RUNNING',
      stateObservedAt: observed.toISOString(),
      href: `/workflows/${uuid(id)}`,
    });
    const cards = [card(3, ago(m)), card(2, ago(5 * m)), card(1, ago(m)), card(4, ago(0))];
    expect([...cards].sort(orderActiveCards).map((c) => c.workflowId)).toEqual([
      uuid(4),
      uuid(1),
      uuid(3),
      uuid(2),
    ]);
  });

  it('FR-023 pipelineFrom returns exactly seven ascending stages with names plus unstaged', () => {
    const p = pipelineFrom([3, 2, 1, 4, 3, 3, 2], 1);
    expect(p.stages).toHaveLength(7);
    expect(p.stages.map((s) => s.stage)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(p.stages.map((s) => s.name)).toEqual([...SDLC_STAGES]);
    expect(p.stages.map((s) => s.count)).toEqual([3, 2, 1, 4, 3, 3, 2]);
    for (const s of p.stages) expect(s.href).toBe(`/workflows?stage=${s.stage}`);
    expect(p.unstaged).toEqual({ value: 1, href: '/workflows?stage=none' });
  });

  it('FR-023 buildDashboardSnapshot keeps Σ pipeline + unstaged = activeWorkflows, failed + blocked = openFailures, pendingHighCritical ≤ approvals, numerator ≤ denominator, ≤ 12 cards with href /workflows/{id}', () => {
    const rows = demoRows();
    rows.cards = Array.from({ length: 18 }, (_, i) => cardRow(i + 1));
    const snap = buildDashboardSnapshot(rows, NOW, '7d', 'all');

    expect(snap.generatedAt).toBe(NOW.toISOString());
    expect(snap.project).toBe('all');
    expect(snap.window).toEqual(windowFor('7d', NOW));

    expect(snap.counts.activeWorkflows.value).toBe(18);
    expect(snap.counts.runningAgents.value).toBe(7);
    expect(snap.counts.prsGenerated.value).toBe(6);
    expect(snap.counts.openFailures.value).toBe(2);
    const stageSum = snap.pipeline.stages.reduce((acc, s) => acc + s.count, 0);
    expect(stageSum + snap.pipeline.unstaged.value).toBe(snap.counts.activeWorkflows.value);
    expect(snap.needsMe.failed.value + snap.needsMe.blocked.value).toBe(
      snap.counts.openFailures.value,
    );
    expect(snap.needsMe).toMatchObject({
      approvals: { value: 4, href: '/approvals' },
      clarifications: { value: 2, href: '/approvals?kind=clarification' },
      failed: { value: 1, href: '/workflows?state=FAILED' },
      blocked: { value: 1, href: '/workflows?state=BLOCKED' },
    });
    expect(snap.risk.pendingHighCritical.value).toBeLessThanOrEqual(snap.needsMe.approvals.value);
    expect(snap.risk.pendingHighCritical).toEqual({ value: 2, href: '/approvals?risk=HIGH,CRITICAL' });
    expect(snap.risk.auditHighCritical).toEqual({
      value: 0,
      href: '/audit?risk=HIGH,CRITICAL&window=7d',
    });

    expect(snap.health.testPassRate).toEqual({
      numerator: 974,
      denominator: 1000,
      href: '/testing?window=7d',
    });
    expect(snap.health.agentSuccessRate).toEqual({
      numerator: 35,
      denominator: 37,
      href: '/agents?window=7d',
    });
    expect(snap.health.humanInterventionRate).toEqual({
      numerator: 8,
      denominator: 24,
      href: '/workflows?intervention=human&window=7d',
    });
    for (const rate of Object.values(snap.health)) {
      expect(rate.numerator).toBeLessThanOrEqual(rate.denominator);
    }

    expect(snap.activeWorkflows).toHaveLength(ACTIVE_CARD_LIMIT);
    expect(snap.activeWorkflowsTotal).toBe(18);
    expect(snap.activeWorkflows.length).toBeLessThanOrEqual(snap.activeWorkflowsTotal);
    expect(snap.activeWorkflows.map((c) => c.workflowId)).toEqual(
      Array.from({ length: 12 }, (_, i) => uuid(i + 1)),
    );
    for (const c of snap.activeWorkflows) {
      expect(c.href).toBe(`/workflows/${c.workflowId}`);
      expect(c.stage).toEqual({ index: 4, count: 7, name: 'Implementation' });
      expect(c.progress).toEqual({ done: 3, total: 7 });
      expect(c.elapsedMs).toBe(2 * h);
      expect(c.agent).toBe('devin');
      expect(c.state).toBe('RUNNING');
    }

    const everyHref = [
      ...Object.values(snap.counts).map((f) => f.href),
      ...snap.pipeline.stages.map((s) => s.href),
      snap.pipeline.unstaged.href,
      ...Object.values(snap.needsMe).map((f) => f.href),
      ...Object.values(snap.health).map((r) => r.href),
      snap.risk.pendingHighCritical.href,
      snap.risk.auditHighCritical.href,
      snap.risk.securityFindings.href,
      ...snap.activeWorkflows.map((c) => c.href),
    ];
    for (const href of everyHref) expect(href).toMatch(/^\//);
    snap.pipeline.stages.forEach((s, i) => {
      expect(s.stage).toBe(i + 1);
      expect(s.href).toBe(`/workflows?stage=${s.stage}`);
    });
  });

  it('FR-023 buildDashboardSnapshot echoes the project, handles null stage rows and zero denominators', () => {
    const rows = demoRows();
    rows.testRuns = { passed: 0, total: 0 };
    rows.cards = [cardRow(1, { stageIndex: null, stageCount: null, stageName: null, startedAt: null, agent: null })];
    const snap = buildDashboardSnapshot(rows, NOW, '24h', uuid(9));
    expect(snap.project).toBe(uuid(9));
    expect(snap.window.key).toBe('24h');
    expect(ratePercent(snap.health.testPassRate)).toBeNull();
    expect(snap.activeWorkflows[0]).toMatchObject({
      stage: { index: null, count: 7, name: null },
      progress: { done: 0, total: 7 },
      agent: null,
      elapsedMs: null,
    });
  });

  it('FR-026 securityFindings is { connected: false, count: null, href: \'/reviews\' }', () => {
    const snap = buildDashboardSnapshot(demoRows(), NOW, '7d', 'all');
    expect(snap.risk.securityFindings).toEqual({ connected: false, count: null, href: '/reviews' });
  });
});
