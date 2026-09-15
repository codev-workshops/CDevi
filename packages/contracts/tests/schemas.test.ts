import { describe, expect, it } from 'vitest';
import {
  AlreadyResolvedProblem,
  AnswerRequest,
  ApprovalCenterQuery,
  ApprovalUpsert,
  ApproveRequest,
  ClarificationUpsert,
  RejectRequest,
  ExternalId,
  InboxQuery,
  SignInRequest,
  Transition,
  WorkflowUpsert,
  DashboardQuery,
  DashboardSnapshot,
  SecurityFindings,
  Rate,
  Href,
  buildDashboardSnapshot,
  type DashboardRows,
} from '../src/index';

const T = '2026-09-14T09:00:00Z';

describe('ingestion schemas (data-model.md §6)', () => {
  it('externalId matches ^[A-Za-z0-9._:-]{1,128}$', () => {
    expect(ExternalId.safeParse('demo-live_1.a:b').success).toBe(true);
    expect(ExternalId.safeParse('has space').success).toBe(false);
    expect(ExternalId.safeParse('x'.repeat(129)).success).toBe(false);
    expect(ExternalId.safeParse('').success).toBe(false);
  });

  it('WorkflowUpsert: title ≤ 200 single-line trimmed, state enum, stage bounds, observedAt ISO', () => {
    const ok = { projectKey: 'payments-api', title: '  Add limiter  ', observedAt: T };
    const parsed = WorkflowUpsert.parse(ok);
    expect(parsed.title).toBe('Add limiter');
    expect(WorkflowUpsert.safeParse({ ...ok, title: 'x'.repeat(201) }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, title: 'two\nlines' }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, title: '   ' }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, state: 'DONE' }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, state: 'RUNNING' }).success).toBe(true);
    expect(WorkflowUpsert.safeParse({ ...ok, stage: { index: 8, count: 7 } }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, stage: { index: 1, count: 21 } }).success).toBe(false);
    expect(
      WorkflowUpsert.safeParse({ ...ok, stage: { index: 3, count: 7, name: 'Impl' } }).success,
    ).toBe(true);
    expect(WorkflowUpsert.safeParse({ ...ok, observedAt: 'yesterday' }).success).toBe(false);
    expect(WorkflowUpsert.safeParse({ ...ok, reason: 'x'.repeat(241) }).success).toBe(false);
  });

  it('Transition: toState enum, observedAt required', () => {
    expect(
      Transition.safeParse({ toState: 'FAILED', observedAt: T, reason: '3 tests failing' }).success,
    ).toBe(true);
    expect(Transition.safeParse({ toState: 'PAUSED', observedAt: T }).success).toBe(false);
    expect(Transition.safeParse({ toState: 'FAILED' }).success).toBe(false);
  });

  it('ApprovalUpsert: ask ≤ 240, riskLevel enum, expiresAt after requestedAt', () => {
    const ok = {
      workflowExternalId: 'w1',
      ask: 'Approve: open a PR',
      riskLevel: 'HIGH',
      requestedAt: T,
    };
    expect(ApprovalUpsert.safeParse(ok).success).toBe(true);
    expect(ApprovalUpsert.safeParse({ ...ok, ask: 'x'.repeat(241) }).success).toBe(false);
    expect(ApprovalUpsert.safeParse({ ...ok, riskLevel: 'SEVERE' }).success).toBe(false);
    expect(ApprovalUpsert.safeParse({ ...ok, expiresAt: '2026-09-14T08:00:00Z' }).success).toBe(
      false,
    );
    expect(ApprovalUpsert.safeParse({ ...ok, expiresAt: '2026-09-14T13:00:00Z' }).success).toBe(
      true,
    );
    expect(
      ApprovalUpsert.safeParse({ ...ok, decision: { outcome: 'maybe', decidedAt: T } }).success,
    ).toBe(false);
  });

  it('ClarificationUpsert: question ≤ 240 single line, hasRecommendedAnswer defaults false', () => {
    const ok = { workflowExternalId: 'w1', question: 'Keep /session/v1?', requestedAt: T };
    expect(ClarificationUpsert.parse(ok).hasRecommendedAnswer).toBe(false);
    expect(ClarificationUpsert.safeParse({ ...ok, question: 'a\nb' }).success).toBe(false);
  });
});

describe('auth and query schemas', () => {
  it('SignInRequest: email ≤ 254, password 8..256', () => {
    expect(SignInRequest.safeParse({ email: 'a@b.co', password: 'longenough' }).success).toBe(true);
    expect(SignInRequest.safeParse({ email: 'not-an-email', password: 'longenough' }).success).toBe(
      false,
    );
    expect(SignInRequest.safeParse({ email: 'a@b.co', password: 'short' }).success).toBe(false);
    expect(SignInRequest.safeParse({ email: 'a@b.co', password: 'x'.repeat(257) }).success).toBe(
      false,
    );
  });

  it('InboxQuery: tab enum, project uuid|all, cursor ≤ 200; limit is not client-settable', () => {
    expect(InboxQuery.parse({})).toEqual({ tab: 'needsYou', project: 'all' });
    expect(InboxQuery.safeParse({ tab: 'archive' }).success).toBe(false);
    expect(InboxQuery.safeParse({ project: 'payments' }).success).toBe(false);
    expect(InboxQuery.safeParse({ project: '0190a8f0-1234-7abc-8def-0123456789ab' }).success).toBe(
      true,
    );
    expect(InboxQuery.safeParse({ cursor: 'x'.repeat(201) }).success).toBe(false);
    expect('limit' in InboxQuery.parse({ limit: 500 } as never)).toBe(false);
  });
});

describe('US2 decision schemas (specs/001 data-model.md §13–§14)', () => {
  const opt = (value: string, recommended = false) => ({
    value,
    label: value.toUpperCase(),
    recommended,
  });

  it('FR-013 ApproveRequest defaults confirmed to false', () => {
    expect(ApproveRequest.parse({})).toEqual({ confirmed: false });
    expect(ApproveRequest.parse({ confirmed: true })).toEqual({ confirmed: true });
  });

  it('FR-013 RejectRequest rejects empty/whitespace reason, reason > 500 and target outside BLOCKED/CANCELLED', () => {
    expect(RejectRequest.parse({ reason: ' too risky ', target: 'BLOCKED' })).toEqual({
      reason: 'too risky',
      target: 'BLOCKED',
    });
    expect(RejectRequest.safeParse({ reason: '   ', target: 'BLOCKED' }).success).toBe(false);
    expect(RejectRequest.safeParse({ reason: 'x'.repeat(501), target: 'CANCELLED' }).success).toBe(
      false,
    );
    expect(RejectRequest.safeParse({ reason: 'no', target: 'FAILED' }).success).toBe(false);
    expect(RejectRequest.safeParse({ reason: 'no' }).success).toBe(false);
  });

  it('FR-014 AnswerRequest rejects both option and text, neither, text > 2000', () => {
    expect(AnswerRequest.parse({ option: 'oidc' })).toEqual({ option: 'oidc' });
    expect(AnswerRequest.parse({ text: ' free text ' })).toEqual({ text: 'free text' });
    expect(AnswerRequest.safeParse({ option: 'oidc', text: 'x' }).success).toBe(false);
    expect(AnswerRequest.safeParse({}).success).toBe(false);
    expect(AnswerRequest.safeParse({ text: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('FR-025 ApprovalCenterQuery accepts all|uuid and defaults to all', () => {
    expect(ApprovalCenterQuery.parse({})).toEqual({ project: 'all' });
    const u = '00000000-0000-7000-8000-000000000001';
    expect(ApprovalCenterQuery.parse({ project: u })).toEqual({ project: u });
    expect(ApprovalCenterQuery.safeParse({ project: 'mine' }).success).toBe(false);
  });

  it('FR-014 ClarificationUpsert accepts whyItMatters ≤ 1000, ≤ 8 options with one recommended, 5 link keys; rejects 9 options, two recommended, unknown link key', () => {
    const base = { workflowExternalId: 'wf-1', question: 'Which provider?', requestedAt: T };
    const ok = ClarificationUpsert.parse({
      ...base,
      whyItMatters: 'Determines the SDK.',
      options: [opt('oidc', true), opt('saml')],
      links: {
        requirement: '/requirements/1',
        pullRequest: 'https://github.com/acme/api/pull/1',
        externalTicket: 'https://jira.example/PLAT-42',
        workflow: '/workflows/1',
        agentRun: '/agent-runs/1',
      },
    });
    expect(ok.links.agentRun).toBe('/agent-runs/1');
    expect(ok.hasRecommendedAnswer).toBe(true);
    expect(ok.options).toHaveLength(2);
    expect(ClarificationUpsert.parse(base)).toMatchObject({ options: [], links: {} });
    expect(
      ClarificationUpsert.safeParse({
        ...base,
        options: Array.from({ length: 9 }, (_, i) => opt(`o${i}`)),
      }).success,
    ).toBe(false);
    expect(
      ClarificationUpsert.safeParse({ ...base, options: [opt('a', true), opt('b', true)] }).success,
    ).toBe(false);
    expect(ClarificationUpsert.safeParse({ ...base, options: [opt('a'), opt('a')] }).success).toBe(
      false,
    );
    expect(ClarificationUpsert.safeParse({ ...base, links: { wiki: 'https://x' } }).success).toBe(
      false,
    );
    expect(
      ClarificationUpsert.safeParse({ ...base, links: { requirement: 'ftp://x' } }).success,
    ).toBe(false);
    for (const hostile of ['//evil.example/x', '/\\evil.example', 'javascript:alert(1)'])
      expect(
        ClarificationUpsert.safeParse({ ...base, links: { requirement: hostile } }).success,
      ).toBe(false);
    expect(ClarificationUpsert.safeParse({ ...base, whyItMatters: 'x'.repeat(1001) }).success).toBe(
      false,
    );
  });

  it('FR-012 ApprovalUpsert accepts context ≤ 2000 and links', () => {
    const base = {
      workflowExternalId: 'wf-1',
      ask: 'Merge PR #212',
      riskLevel: 'MEDIUM',
      requestedAt: T,
    };
    expect(
      ApprovalUpsert.parse({
        ...base,
        context: 'Touches auth.',
        links: { pullRequest: 'https://g/h/pull/212' },
      }),
    ).toMatchObject({ context: 'Touches auth.', links: { pullRequest: 'https://g/h/pull/212' } });
    expect(ApprovalUpsert.parse(base)).toMatchObject({ links: {} });
    expect(ApprovalUpsert.safeParse({ ...base, context: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('FR-015 AlreadyResolvedProblem parses a 409 body with resolution', () => {
    const body = AlreadyResolvedProblem.parse({
      type: 'urn:cdevi:problem:already-resolved',
      title: 'Already resolved',
      status: 409,
      detail: 'approved by Ada Approver',
      resolution: {
        outcome: 'approved',
        by: { id: '00000000-0000-7000-8000-000000000001', name: 'Ada Approver' },
        at: T,
        answer: null,
        reason: null,
        target: null,
        workflowState: 'RUNNING',
      },
    });
    expect(body.resolution.outcome).toBe('approved');
  });
});

describe('US3 dashboard schemas (specs/001 data-model.md §19)', () => {
  const U = '00000000-0000-7000-8000-000000000001';
  const NOW = new Date(T);
  const rows: DashboardRows = {
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
    cards: Array.from({ length: 12 }, (_, i) => ({
      workflowId: `00000000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
      externalId: `s500-d${String(i + 1).padStart(2, '0')}`,
      title: `Workflow ${i + 1}`,
      agent: 'devin',
      state: 'RUNNING' as const,
      stageIndex: 4,
      stageCount: 7,
      stageName: 'Implementation',
      startedAt: new Date(NOW.getTime() - 3_600_000),
      stateObservedAt: new Date(NOW.getTime() - (i + 1) * 60_000),
    })),
  };
  const snapshot = () => buildDashboardSnapshot(rows, NOW, '7d', 'all');

  it('FR-025 DashboardQuery accepts all|uuid and defaults project to all and window to 7d', () => {
    expect(DashboardQuery.parse({})).toEqual({ project: 'all', window: '7d' });
    expect(DashboardQuery.parse({ project: U })).toEqual({ project: U, window: '7d' });
    expect(DashboardQuery.parse({ project: 'all', window: '24h' })).toEqual({
      project: 'all',
      window: '24h',
    });
    expect(DashboardQuery.parse({ window: '30d' })).toEqual({ project: 'all', window: '30d' });
  });

  it('FR-023 DashboardQuery rejects window=90d and project=foo', () => {
    expect(DashboardQuery.safeParse({ window: '90d' }).success).toBe(false);
    expect(DashboardQuery.safeParse({ project: 'foo' }).success).toBe(false);
    expect(DashboardQuery.safeParse({ window: '' }).success).toBe(false);
  });

  it('FR-023 DashboardSnapshot requires exactly seven pipeline stages, ≤ 12 activeWorkflows, hrefs starting with / and rates with numerator ≤ denominator', () => {
    const ok = snapshot();
    expect(DashboardSnapshot.safeParse(ok).success).toBe(true);

    const sixStages = { ...ok, pipeline: { ...ok.pipeline, stages: ok.pipeline.stages.slice(0, 6) } };
    expect(DashboardSnapshot.safeParse(sixStages).success).toBe(false);
    const eightStages = {
      ...ok,
      pipeline: { ...ok.pipeline, stages: [...ok.pipeline.stages, ok.pipeline.stages[6]] },
    };
    expect(DashboardSnapshot.safeParse(eightStages).success).toBe(false);

    const thirteen = { ...ok, activeWorkflows: [...ok.activeWorkflows, ok.activeWorkflows[0]] };
    expect(DashboardSnapshot.safeParse(thirteen).success).toBe(false);

    expect(Href.safeParse('/approvals').success).toBe(true);
    expect(Href.safeParse('approvals').success).toBe(false);
    expect(Href.safeParse('https://evil.example/').success).toBe(false);
    const badHref = {
      ...ok,
      counts: { ...ok.counts, activeWorkflows: { value: 1, href: 'workflows' } },
    };
    expect(DashboardSnapshot.safeParse(badHref).success).toBe(false);

    expect(Rate.safeParse({ numerator: 974, denominator: 1000, href: '/testing' }).success).toBe(
      true,
    );
    expect(Rate.safeParse({ numerator: 0, denominator: 0, href: '/testing' }).success).toBe(true);
    expect(Rate.safeParse({ numerator: 5, denominator: 4, href: '/testing' }).success).toBe(false);
    expect(Rate.safeParse({ numerator: -1, denominator: 4, href: '/testing' }).success).toBe(false);
    const badRate = {
      ...ok,
      health: { ...ok.health, testPassRate: { numerator: 2, denominator: 1, href: '/testing' } },
    };
    expect(DashboardSnapshot.safeParse(badRate).success).toBe(false);

    const badStageNumber = {
      ...ok,
      pipeline: {
        ...ok.pipeline,
        stages: ok.pipeline.stages.map((s, i) => (i === 0 ? { ...s, stage: 8 } : s)),
      },
    };
    expect(DashboardSnapshot.safeParse(badStageNumber).success).toBe(false);
  });

  it('FR-026 SecurityFindings accepts connected:false/count:null and connected:true/count:n and rejects connected:false with a count', () => {
    expect(
      SecurityFindings.safeParse({ connected: false, count: null, href: '/reviews' }).success,
    ).toBe(true);
    expect(SecurityFindings.safeParse({ connected: true, count: 3, href: '/reviews' }).success).toBe(
      true,
    );
    expect(
      SecurityFindings.safeParse({ connected: false, count: 1, href: '/reviews' }).success,
    ).toBe(false);
    expect(
      SecurityFindings.safeParse({ connected: true, count: null, href: '/reviews' }).success,
    ).toBe(false);
    expect(snapshot().risk.securityFindings).toEqual({
      connected: false,
      count: null,
      href: '/reviews',
    });
  });
});
