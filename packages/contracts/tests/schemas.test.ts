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
  AUDIT_ACTIONS,
  AnalysisItem,
  CreateRequirementRequest,
  JiraWebhookEvent,
  JiraWebhookResult,
  REQUIREMENT_STATES,
  RejectRequirementRequest,
  Requirement,
  RequirementAnalysisIngest,
  RequirementDetail,
  RequirementIdParams,
  RequirementIngestResult,
  RequirementListPage,
  RequirementListQuery,
  splitCsv,
  WORKFLOW_STATES,
  WorkflowListItem,
  WorkflowListPage,
  WorkflowListQuery,
  AgentDecision,
  AgentDecisionIngest,
  AgentDecisionsIngest,
  AgentDecisionsIngestResult,
  AgentRunDetail,
  AgentRunIdParams,
  AgentRunUpsert,
  ConfidenceLevel,
  EvidenceRef,
  PolicyOutcome,
  RunStep,
  WorkflowStageView,
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

    const sixStages = {
      ...ok,
      pipeline: { ...ok.pipeline, stages: ok.pipeline.stages.slice(0, 6) },
    };
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
    expect(
      SecurityFindings.safeParse({ connected: true, count: 3, href: '/reviews' }).success,
    ).toBe(true);
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

describe('US4 requirement schemas (specs/001 data-model.md §23–§27)', () => {
  const P = '00000000-0000-7000-8000-000000000010';
  const U = '00000000-0000-7000-8000-000000000001';
  const R = '00000000-0000-7000-8000-000000000100';

  it('FR-007 CreateRequirementRequest trims title (3..200) and businessObjective (10..4000), defaults acceptanceCriteria to [] and caps it at 20 trimmed lines of 1..1000', () => {
    const ok = CreateRequirementRequest.parse({
      projectId: P,
      title: '  Retry queue  ',
      businessObjective: '  Recover declined card payments automatically.  ',
    });
    expect(ok).toEqual({
      projectId: P,
      title: 'Retry queue',
      businessObjective: 'Recover declined card payments automatically.',
      acceptanceCriteria: [],
    });
    const base = { projectId: P, title: 'Retry queue', businessObjective: 'x'.repeat(10) };
    expect(CreateRequirementRequest.safeParse({ ...base, title: 'ab' }).success).toBe(false);
    expect(CreateRequirementRequest.safeParse({ ...base, title: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(CreateRequirementRequest.safeParse({ ...base, title: 'a\nb c' }).success).toBe(false);
    expect(
      CreateRequirementRequest.safeParse({ ...base, businessObjective: 'too short' }).success,
    ).toBe(false);
    expect(
      CreateRequirementRequest.safeParse({ ...base, businessObjective: 'x'.repeat(4001) }).success,
    ).toBe(false);
    expect(CreateRequirementRequest.safeParse({ ...base, projectId: 'payments-api' }).success).toBe(
      false,
    );
    expect(
      CreateRequirementRequest.parse({ ...base, acceptanceCriteria: ['  Retries twice  '] })
        .acceptanceCriteria,
    ).toEqual(['Retries twice']);
    expect(
      CreateRequirementRequest.safeParse({ ...base, acceptanceCriteria: ['   '] }).success,
    ).toBe(false);
    expect(
      CreateRequirementRequest.safeParse({ ...base, acceptanceCriteria: ['x'.repeat(1001)] })
        .success,
    ).toBe(false);
    expect(
      CreateRequirementRequest.safeParse({
        ...base,
        acceptanceCriteria: Array.from({ length: 20 }, (_, i) => `AC ${i}`),
      }).success,
    ).toBe(true);
    expect(
      CreateRequirementRequest.safeParse({
        ...base,
        acceptanceCriteria: Array.from({ length: 21 }, (_, i) => `AC ${i}`),
      }).success,
    ).toBe(false);
    expect(CreateRequirementRequest.parse({ ...base, assigneeUserId: U }).assigneeUserId).toBe(U);
    expect(CreateRequirementRequest.safeParse({ ...base, assigneeUserId: 'me' }).success).toBe(
      false,
    );
  });

  it('FR-007 RequirementListQuery defaults project to all, splits state CSV, accepts assignee me|unassigned|uuid, rejects state=FOO and 9 states, cursor ≤ 200', () => {
    expect(RequirementListQuery.parse({})).toEqual({ project: 'all' });
    expect(RequirementListQuery.parse({ state: 'READY, DRAFT' })).toEqual({
      project: 'all',
      state: ['READY', 'DRAFT'],
    });
    expect(RequirementListQuery.parse({ state: ['READY'] }).state).toEqual(['READY']);
    expect(RequirementListQuery.parse({ project: P, assignee: 'me' })).toEqual({
      project: P,
      assignee: 'me',
    });
    expect(RequirementListQuery.parse({ assignee: 'unassigned' }).assignee).toBe('unassigned');
    expect(RequirementListQuery.parse({ assignee: U }).assignee).toBe(U);
    expect(RequirementListQuery.safeParse({ assignee: 'ada' }).success).toBe(false);
    expect(RequirementListQuery.safeParse({ project: 'payments' }).success).toBe(false);
    expect(RequirementListQuery.safeParse({ state: 'FOO' }).success).toBe(false);
    expect(RequirementListQuery.safeParse({ state: 'READY,FOO' }).success).toBe(false);
    expect(
      RequirementListQuery.safeParse({ state: [...REQUIREMENT_STATES, 'DRAFT'].join(',') }).success,
    ).toBe(false);
    expect(RequirementListQuery.safeParse({ state: REQUIREMENT_STATES.join(',') }).success).toBe(
      true,
    );
    expect(RequirementListQuery.safeParse({ cursor: 'x'.repeat(201) }).success).toBe(false);
    expect('limit' in RequirementListQuery.parse({ limit: 500 } as never)).toBe(false);
  });

  const requirement = {
    id: R,
    externalId: 'req-seed-003',
    project: { id: P, key: 'payments-api', name: 'Payments API' },
    title: 'Retry queue for card declines',
    state: 'NEEDS_CLARIFICATION',
    source: 'jira',
    externalRef: {
      provider: 'jira',
      key: 'PAY-231',
      url: 'https://jira.example.invalid/browse/PAY-231',
      updatedAt: T,
    },
    externalFlag: null,
    externalFlaggedAt: null,
    assignee: { id: U, name: 'Ada Approver' },
    createdBy: { id: U, name: 'Ada Approver' },
    createdAt: T,
    updatedAt: T,
    openQuestionCount: 2,
    workflow: null,
    href: `/requirements/${R}`,
  };
  const item = (i: number, kind = 'acceptance_criterion') => ({
    id: `00000000-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
    kind,
    position: i + 1,
    text: `Item ${i + 1}`,
    aiGenerated: true,
    source: 'agent:devin',
  });
  const detail = {
    requirement,
    businessObjective: 'Recover declined card payments automatically.',
    analysis: {
      observedAt: T,
      summary: null,
      acceptanceCriteria: [item(0)],
      rules: [item(1, 'rule')],
      openQuestions: [item(2, 'open_question'), item(3, 'open_question')],
    },
    submittedBy: { id: U, name: 'Ada Approver' },
    submittedAt: T,
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    actions: {
      canSubmit: true,
      canApprove: false,
      canReject: true,
      submitLabel: 'Resubmit for analysis',
      reasons: ['Analysis has not finished'],
    },
    transitions: [
      {
        fromState: 'ANALYZING',
        toState: 'NEEDS_CLARIFICATION',
        actorType: 'agent',
        actorName: 'devin',
        reason: null,
        occurredAt: T,
      },
    ],
    audit: [],
    generatedAt: T,
  };

  it('FR-009 Requirement requires a lowercase-free jira key, https url, a workflow ref or null, and href; RequirementDetail bounds analysis items (≤50/≤50/≤20), transitions ≤ 50, audit ≤ 20 and needs aiGenerated + source on every item', () => {
    expect(Requirement.safeParse(requirement).success).toBe(true);
    expect(
      Requirement.safeParse({
        ...requirement,
        externalRef: { ...requirement.externalRef, key: 'pay-231' },
      }).success,
    ).toBe(false);
    expect(
      Requirement.safeParse({
        ...requirement,
        externalRef: {
          ...requirement.externalRef,
          url: 'http://jira.example.invalid/browse/PAY-231',
        },
      }).success,
    ).toBe(false);
    expect(Requirement.safeParse({ ...requirement, externalFlag: 'closed' }).success).toBe(true);
    expect(Requirement.safeParse({ ...requirement, externalFlag: 'archived' }).success).toBe(false);
    expect(Requirement.safeParse({ ...requirement, state: 'PAUSED' }).success).toBe(false);
    expect(Requirement.safeParse({ ...requirement, source: 'github' }).success).toBe(false);
    expect(Requirement.safeParse({ ...requirement, openQuestionCount: -1 }).success).toBe(false);
    expect(Requirement.safeParse({ ...requirement, href: 'requirements/1' }).success).toBe(false);
    expect(
      Requirement.safeParse({
        ...requirement,
        state: 'IN_IMPLEMENTATION',
        workflow: {
          id: U,
          externalId: 's500-d01',
          state: 'RUNNING',
          stage: { index: 4, count: 7, name: 'Implementation' },
          href: `/workflows/${U}`,
        },
      }).success,
    ).toBe(true);
    expect(
      Requirement.safeParse({
        ...requirement,
        workflow: { id: U, externalId: 's500-d01', state: 'DONE', stage: null, href: '/w' },
      }).success,
    ).toBe(false);

    expect(RequirementDetail.safeParse(detail).success).toBe(true);
    expect(AnalysisItem.safeParse(item(0)).success).toBe(true);
    expect(AnalysisItem.safeParse({ ...item(0), aiGenerated: undefined }).success).toBe(false);
    expect(AnalysisItem.safeParse({ ...item(0), source: undefined }).success).toBe(false);
    expect(AnalysisItem.safeParse({ ...item(0), source: 'user:Ada' }).success).toBe(true);
    expect(AnalysisItem.safeParse({ ...item(0), kind: 'note' }).success).toBe(false);
    expect(AnalysisItem.safeParse({ ...item(0), position: 0 }).success).toBe(false);
    expect(AnalysisItem.safeParse({ ...item(0), position: 51 }).success).toBe(false);
    const many = (n: number, kind: string) => Array.from({ length: n }, (_, i) => item(i, kind));
    expect(
      RequirementDetail.safeParse({
        ...detail,
        analysis: { ...detail.analysis, acceptanceCriteria: many(50, 'acceptance_criterion') },
      }).success,
    ).toBe(true);
    expect(
      RequirementDetail.safeParse({
        ...detail,
        analysis: { ...detail.analysis, acceptanceCriteria: many(51, 'acceptance_criterion') },
      }).success,
    ).toBe(false);
    expect(
      RequirementDetail.safeParse({
        ...detail,
        analysis: { ...detail.analysis, rules: many(51, 'rule') },
      }).success,
    ).toBe(false);
    expect(
      RequirementDetail.safeParse({
        ...detail,
        analysis: { ...detail.analysis, openQuestions: many(21, 'open_question') },
      }).success,
    ).toBe(false);
    expect(RequirementDetail.safeParse({ ...detail, analysis: null }).success).toBe(true);
    expect(
      RequirementDetail.safeParse({
        ...detail,
        transitions: Array.from({ length: 51 }, () => detail.transitions[0]),
      }).success,
    ).toBe(false);
    expect(
      RequirementDetail.safeParse({
        ...detail,
        transitions: [{ ...detail.transitions[0], actorType: 'robot' }],
      }).success,
    ).toBe(false);
    expect(
      RequirementDetail.safeParse({
        ...detail,
        actions: { ...detail.actions, submitLabel: 'Go' },
      }).success,
    ).toBe(false);
    expect(RequirementIdParams.safeParse({ id: R }).success).toBe(true);
    expect(RequirementIdParams.safeParse({ id: 'req-seed-003' }).success).toBe(false);
  });

  it('FR-009 RequirementListPage caps items at 50 and requires generatedAt/project/filters/nextCursor/total', () => {
    const page = {
      generatedAt: T,
      project: 'all',
      filters: { state: ['READY'], assignee: null },
      items: [requirement],
      nextCursor: null,
      total: 1,
    };
    expect(RequirementListPage.safeParse(page).success).toBe(true);
    expect(
      RequirementListPage.safeParse({
        ...page,
        items: Array.from({ length: 50 }, () => requirement),
      }).success,
    ).toBe(true);
    expect(
      RequirementListPage.safeParse({
        ...page,
        items: Array.from({ length: 51 }, () => requirement),
      }).success,
    ).toBe(false);
    expect(RequirementListPage.safeParse({ ...page, total: -1 }).success).toBe(false);
    expect(RequirementListPage.safeParse({ ...page, nextCursor: 'abc' }).success).toBe(true);
  });

  it('FR-032 RejectRequirementRequest trims reason 1..500 and rejects blank or 501', () => {
    expect(RejectRequirementRequest.parse({ reason: ' out of scope ' })).toEqual({
      reason: 'out of scope',
    });
    expect(RejectRequirementRequest.safeParse({ reason: '   ' }).success).toBe(false);
    expect(RejectRequirementRequest.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(RejectRequirementRequest.safeParse({}).success).toBe(false);
  });

  it('FR-003 WorkflowListQuery defaults project to all, requires a uuid requirement, splits state CSV of workflow states (≤ 9), coerces stage 1..7 and rejects stage 0/8', () => {
    expect(WorkflowListQuery.parse({})).toEqual({ project: 'all' });
    expect(WorkflowListQuery.parse({ requirement: R }).requirement).toBe(R);
    expect(WorkflowListQuery.safeParse({ requirement: 'req-seed-005' }).success).toBe(false);
    expect(WorkflowListQuery.parse({ state: 'RUNNING,BLOCKED' }).state).toEqual([
      'RUNNING',
      'BLOCKED',
    ]);
    expect(WorkflowListQuery.safeParse({ state: 'RUNNING,DONE' }).success).toBe(false);
    expect(WorkflowListQuery.safeParse({ state: 'READY' }).success).toBe(false);
    expect(
      WorkflowListQuery.safeParse({ state: [...WORKFLOW_STATES, 'RUNNING'].join(',') }).success,
    ).toBe(false);
    expect(WorkflowListQuery.parse({ stage: '4' }).stage).toBe(4);
    expect(WorkflowListQuery.safeParse({ stage: '0' }).success).toBe(false);
    expect(WorkflowListQuery.safeParse({ stage: '8' }).success).toBe(false);
    expect(WorkflowListQuery.safeParse({ stage: '2.5' }).success).toBe(false);
    expect(WorkflowListQuery.safeParse({ cursor: 'x'.repeat(201) }).success).toBe(false);
  });

  it('FR-003 WorkflowListItem carries the FR-003 shape and WorkflowListPage caps items at 50', () => {
    const wf = {
      id: U,
      externalId: 's500-d01',
      title: 'Workflow 1',
      project: { id: P, key: 'payments-api', name: 'Payments API' },
      state: 'RUNNING',
      stateObservedAt: T,
      stage: { index: 4, count: 7, name: 'Implementation' },
      agent: 'devin',
      pullRequest: { url: 'https://github.com/acme/api/pull/1', number: 1, state: 'open' },
      requirement: { id: R, title: 'Retry queue', href: `/requirements/${R}` },
      startedAt: T,
      finishedAt: null,
      href: `/workflows/${U}`,
    };
    expect(WorkflowListItem.safeParse(wf).success).toBe(true);
    expect(
      WorkflowListItem.safeParse({
        ...wf,
        stage: null,
        agent: null,
        pullRequest: null,
        requirement: null,
        startedAt: null,
      }).success,
    ).toBe(true);
    expect(WorkflowListItem.safeParse({ ...wf, state: 'DONE' }).success).toBe(false);
    expect(WorkflowListItem.safeParse({ ...wf, href: 'workflows/1' }).success).toBe(false);
    const page = {
      generatedAt: T,
      project: 'all',
      filters: { requirement: null, state: ['RUNNING'], stage: null },
      items: [wf],
      nextCursor: null,
      total: 1,
    };
    expect(WorkflowListPage.safeParse(page).success).toBe(true);
    expect(
      WorkflowListPage.safeParse({ ...page, items: Array.from({ length: 51 }, () => wf) }).success,
    ).toBe(false);
    expect(
      WorkflowListPage.safeParse({ ...page, items: Array.from({ length: 50 }, () => wf) }).success,
    ).toBe(true);
  });

  it('FR-036 RequirementAnalysisIngest requires agent/observedAt and the three arrays, bounds them at 50/50/20 lines of ≤ 1000, summary ≤ 400 optional', () => {
    const ok = {
      agent: 'devin',
      observedAt: T,
      acceptanceCriteria: ['Retries twice'],
      rules: ['Never retry a hard decline'],
      openQuestions: [],
    };
    expect(RequirementAnalysisIngest.parse(ok)).toEqual(ok);
    expect(RequirementAnalysisIngest.parse({ ...ok, summary: ' ok ' }).summary).toBe('ok');
    expect(RequirementAnalysisIngest.safeParse({ ...ok, summary: 'x'.repeat(401) }).success).toBe(
      false,
    );
    expect(RequirementAnalysisIngest.safeParse({ ...ok, agent: undefined }).success).toBe(false);
    expect(RequirementAnalysisIngest.safeParse({ ...ok, observedAt: 'now' }).success).toBe(false);
    expect(RequirementAnalysisIngest.safeParse({ ...ok, rules: undefined }).success).toBe(false);
    const n = (k: number) => Array.from({ length: k }, (_, i) => `line ${i}`);
    expect(RequirementAnalysisIngest.safeParse({ ...ok, acceptanceCriteria: n(50) }).success).toBe(
      true,
    );
    expect(RequirementAnalysisIngest.safeParse({ ...ok, acceptanceCriteria: n(51) }).success).toBe(
      false,
    );
    expect(RequirementAnalysisIngest.safeParse({ ...ok, rules: n(51) }).success).toBe(false);
    expect(RequirementAnalysisIngest.safeParse({ ...ok, openQuestions: n(20) }).success).toBe(true);
    expect(RequirementAnalysisIngest.safeParse({ ...ok, openQuestions: n(21) }).success).toBe(
      false,
    );
    expect(RequirementAnalysisIngest.safeParse({ ...ok, rules: ['x'.repeat(1001)] }).success).toBe(
      false,
    );
    expect(RequirementAnalysisIngest.safeParse({ ...ok, rules: ['a\nb'] }).success).toBe(false);
  });

  it('FR-036 RequirementIngestResult carries outcome accepted|stale and a requirement state', () => {
    expect(
      RequirementIngestResult.safeParse({ outcome: 'accepted', id: R, state: 'READY' }).success,
    ).toBe(true);
    expect(
      RequirementIngestResult.safeParse({ outcome: 'stale', id: R, state: 'NEEDS_CLARIFICATION' })
        .success,
    ).toBe(true);
    expect(
      RequirementIngestResult.safeParse({ outcome: 'accepted', id: R, state: 'RUNNING' }).success,
    ).toBe(false);
    expect(RequirementIngestResult.safeParse({ outcome: 'accepted', id: R }).success).toBe(false);
  });

  it('FR-008 JiraWebhookEvent accepts created/updated/deleted payloads with string or ADF description and unknown fields, rejects a lowercase issue key', () => {
    const issue = {
      id: '10001',
      key: 'PAY-241',
      self: 'https://jira.example.invalid/rest/api/2/issue/10001',
      fields: {
        summary: 'Retry queue',
        description: { type: 'doc', version: 1, content: [] },
        updated: '2026-09-14T09:00:00.000+0000',
        project: { key: 'PAY', name: 'Payments' },
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        assignee: { emailAddress: 'approver1@cdevi.demo', displayName: 'Ada' },
        customfield_10001: 'anything',
      },
    };
    for (const webhookEvent of ['jira:issue_created', 'jira:issue_updated', 'jira:issue_deleted'])
      expect(
        JiraWebhookEvent.safeParse({ webhookEvent, timestamp: 1_757_840_400_000, issue }).success,
      ).toBe(true);
    expect(
      JiraWebhookEvent.safeParse({
        webhookEvent: 'jira:issue_updated',
        issue: { ...issue, fields: { ...issue.fields, description: 'plain text' } },
        changelog: { items: [] },
      }).success,
    ).toBe(true);
    expect(
      JiraWebhookEvent.safeParse({
        webhookEvent: 'jira:issue_created',
        issue: { ...issue, fields: { ...issue.fields, description: null, assignee: null } },
      }).success,
    ).toBe(true);
    expect(
      JiraWebhookEvent.safeParse({
        webhookEvent: 'jira:issue_created',
        issue: { ...issue, key: 'pay-241' },
      }).success,
    ).toBe(false);
    expect(
      JiraWebhookEvent.safeParse({
        webhookEvent: 'jira:issue_created',
        issue: { ...issue, fields: { ...issue.fields, project: { name: 'Payments' } } },
      }).success,
    ).toBe(false);
    expect(JiraWebhookEvent.safeParse({ webhookEvent: 'jira:issue_created' }).success).toBe(false);
    expect(
      JiraWebhookEvent.safeParse({
        webhookEvent: 'jira:issue_created',
        issue: { ...issue, fields: { ...issue.fields, assignee: { emailAddress: 'nope' } } },
      }).success,
    ).toBe(false);
    expect(JiraWebhookResult.safeParse({ outcome: 'flagged', requirementId: R }).success).toBe(
      true,
    );
    expect(JiraWebhookResult.safeParse({ outcome: 'ignored', requirementId: null }).success).toBe(
      true,
    );
    expect(JiraWebhookResult.safeParse({ outcome: 'deleted', requirementId: R }).success).toBe(
      false,
    );
  });

  it('FR-009 AUDIT_ACTIONS gains the five requirement actions', () => {
    for (const a of [
      'requirement.submitted',
      'requirement.approved',
      'requirement.rejected',
      'requirement.flagged',
      'requirement.workflow_created',
    ])
      expect(AUDIT_ACTIONS).toContain(a);
    expect(splitCsv(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
    expect(splitCsv(['a'])).toEqual(['a']);
    expect(splitCsv(undefined)).toBeUndefined();
  });
});

describe('US5 agent-run schemas (specs/001 US5, FR-016–FR-018)', () => {
  const U = '00000000-0000-7000-8000-00000000000';
  const evidence = (over: Partial<EvidenceRef> = {}): EvidenceRef => ({
    kind: 'file',
    label: 'src/auth/limiter.ts',
    href: '/workflows/abc',
    locator: 'L12-L40',
    accessible: true,
    ...over,
  });
  const decision = (over: Record<string, unknown> = {}) => ({
    position: 1,
    decidedAt: T,
    action: 'Chose token-bucket limiter',
    reason: 'Matches the existing gateway implementation and the ticket constraints.',
    confidence: 'HIGH',
    policyOutcome: 'ALLOWED',
    evidence: [evidence()],
    ...over,
  });

  it('FR-017 ConfidenceLevel is LOW|MEDIUM|HIGH and PolicyOutcome is ALLOWED|APPROVAL_REQUIRED|DENIED', () => {
    expect(ConfidenceLevel.options).toEqual(['LOW', 'MEDIUM', 'HIGH']);
    expect(PolicyOutcome.options).toEqual(['ALLOWED', 'APPROVAL_REQUIRED', 'DENIED']);
    expect(ConfidenceLevel.safeParse('high').success).toBe(false);
    expect(PolicyOutcome.safeParse('BLOCKED').success).toBe(false);
  });

  it('FR-017 EvidenceRef: kind file|ticket|artifact|url|pullRequest, label ≤ 200, href is a DecisionLink or absent, locator ≤ 200, accessible required', () => {
    for (const kind of ['file', 'ticket', 'artifact', 'url', 'pullRequest'] as const)
      expect(EvidenceRef.safeParse(evidence({ kind })).success, kind).toBe(true);
    expect(EvidenceRef.safeParse(evidence({ kind: 'note' as never })).success).toBe(false);
    expect(EvidenceRef.safeParse(evidence({ label: 'x'.repeat(201) })).success).toBe(false);
    expect(EvidenceRef.safeParse(evidence({ href: 'javascript:alert(1)' })).success).toBe(false);
    expect(EvidenceRef.safeParse(evidence({ href: '//evil.example' })).success).toBe(false);
    expect(EvidenceRef.safeParse(evidence({ href: 'https://git.example/p/1' })).success).toBe(
      true,
    );
    expect(EvidenceRef.safeParse(evidence({ href: null, accessible: false })).success).toBe(true);
    const { href: _h, locator: _l, ...minimal } = evidence();
    expect(EvidenceRef.safeParse(minimal).success).toBe(true);
    expect(EvidenceRef.safeParse(evidence({ locator: 'x'.repeat(201) })).success).toBe(false);
    const { accessible: _a, ...noAccessible } = evidence();
    expect(EvidenceRef.safeParse(noAccessible).success).toBe(false);
  });

  it('AS-3 RunStep: label ≤ 120 single line, status completed|running|pending|failed', () => {
    expect(RunStep.safeParse({ label: 'Read ticket', status: 'completed' }).success).toBe(true);
    expect(RunStep.safeParse({ label: 'x'.repeat(121), status: 'pending' }).success).toBe(false);
    expect(RunStep.safeParse({ label: 'a\nb', status: 'pending' }).success).toBe(false);
    expect(RunStep.safeParse({ label: 'Lint', status: 'skipped' }).success).toBe(false);
  });

  it('FR-017 AgentDecision: position 1..50, action ≤ 200, reason ≤ 600, policyRef ≤ 120 optional, riskLevel optional (US5), evidence ≤ 20', () => {
    const ok = { id: `${U}1`, ...decision() };
    expect(AgentDecision.safeParse(ok).success).toBe(true);
    expect(AgentDecision.safeParse({ ...ok, position: 0 }).success).toBe(false);
    expect(AgentDecision.safeParse({ ...ok, position: 51 }).success).toBe(false);
    expect(AgentDecision.safeParse({ ...ok, position: 1.5 }).success).toBe(false);
    expect(AgentDecision.safeParse({ ...ok, action: 'x'.repeat(201) }).success).toBe(false);
    expect(AgentDecision.safeParse({ ...ok, reason: 'x'.repeat(600) }).success).toBe(true);
    expect(AgentDecision.safeParse({ ...ok, reason: 'x'.repeat(601) }).success).toBe(false);
    expect(AgentDecision.safeParse({ ...ok, policyRef: 'POL-7' }).success).toBe(true);
    expect(AgentDecision.safeParse({ ...ok, policyRef: 'x'.repeat(121) }).success).toBe(false);
    expect(AgentDecision.safeParse({ ...ok, riskLevel: 'MEDIUM' }).success).toBe(true);
    expect(AgentDecision.safeParse({ ...ok, riskLevel: null }).success).toBe(true);
    expect(AgentDecision.safeParse({ ...ok, riskLevel: 'SEVERE' }).success).toBe(false);
    expect(
      AgentDecision.safeParse({ ...ok, evidence: Array.from({ length: 20 }, () => evidence()) })
        .success,
    ).toBe(true);
    expect(
      AgentDecision.safeParse({ ...ok, evidence: Array.from({ length: 21 }, () => evidence()) })
        .success,
    ).toBe(false);
    expect(AgentDecision.safeParse({ ...ok, evidence: [] }).success).toBe(true);
  });

  it('FR-018 AgentDecisionIngest is the decision without id and strict: chainOfThought, reasoning, thoughts and any other unknown key are rejected', () => {
    expect(AgentDecisionIngest.safeParse(decision()).success).toBe(true);
    expect(AgentDecisionIngest.safeParse({ id: `${U}1`, ...decision() }).success).toBe(false);
    for (const key of ['chainOfThought', 'reasoning', 'thoughts', 'scratchpad'])
      expect(
        AgentDecisionIngest.safeParse(decision({ [key]: 'Let me think step by step…' })).success,
        key,
      ).toBe(false);
  });

  it('FR-018 FR-036 AgentDecisionsIngest requires observedAt, bounds decisions at 50 with unique positions and is strict at the top level too', () => {
    const body = (n: number, extra: Record<string, unknown> = {}) => ({
      observedAt: T,
      decisions: Array.from({ length: n }, (_, i) => decision({ position: i + 1 })),
      ...extra,
    });
    expect(AgentDecisionsIngest.safeParse(body(0)).success).toBe(true);
    expect(AgentDecisionsIngest.safeParse(body(50)).success).toBe(true);
    expect(AgentDecisionsIngest.safeParse(body(51)).success).toBe(false);
    expect(AgentDecisionsIngest.safeParse({ decisions: [] }).success).toBe(false);
    expect(AgentDecisionsIngest.safeParse(body(1, { chainOfThought: 'x' })).success).toBe(false);
    expect(AgentDecisionsIngest.safeParse(body(1, { reasoning: 'x' })).success).toBe(false);
    expect(AgentDecisionsIngest.safeParse(body(1, { thoughts: ['x'] })).success).toBe(false);
    expect(
      AgentDecisionsIngest.safeParse({
        observedAt: T,
        decisions: [decision({ position: 2 }), decision({ position: 2 })],
      }).success,
    ).toBe(false);
    expect(AgentDecisionsIngestResult.safeParse({ result: 'accepted', count: 3 }).success).toBe(
      true,
    );
    expect(AgentDecisionsIngestResult.safeParse({ result: 'stale', count: 0 }).success).toBe(true);
    expect(AgentDecisionsIngestResult.safeParse({ result: 'rejected', count: 0 }).success).toBe(
      false,
    );
    expect(AgentDecisionsIngestResult.safeParse({ result: 'accepted', count: 51 }).success).toBe(
      false,
    );
  });

  it('AS-3 AgentRunUpsert.steps is optional, defaults to [] and is bounded to 20', () => {
    const base = {
      workflowExternalId: 'wf-1',
      stagePosition: 3,
      agent: 'implementer',
      state: 'RUNNING',
      startedAt: T,
    };
    const parsed = AgentRunUpsert.parse(base);
    expect(parsed.steps).toEqual([]);
    expect(parsed.timeline).toEqual([]);
    const steps = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ label: `Step ${i + 1}`, status: 'pending' }));
    expect(AgentRunUpsert.safeParse({ ...base, steps: steps(20) }).success).toBe(true);
    expect(AgentRunUpsert.safeParse({ ...base, steps: steps(21) }).success).toBe(false);
  });

  it('FR-016 AgentRunDetail bounds steps ≤ 20, timeline ≤ 50 and decisions ≤ 50 and requires workflow/stage refs; AgentRunIdParams is a uuid', () => {
    const detail = {
      id: `${U}1`,
      externalId: 's500-001-r4',
      agent: 'implementer',
      model: 'gpt-x',
      state: 'COMPLETED',
      startedAt: T,
      finishedAt: T,
      durationMs: 0,
      summary: null,
      workflow: { id: `${U}2`, externalId: 's500-001', title: 'Add rate limiting' },
      stage: { position: 4, name: 'Implementation' },
      steps: [],
      timeline: [],
      decisions: [{ id: `${U}3`, ...decision() }],
    };
    expect(AgentRunDetail.safeParse(detail).success).toBe(true);
    expect(AgentRunDetail.safeParse({ ...detail, durationMs: -1 }).success).toBe(false);
    const many = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
    expect(
      AgentRunDetail.safeParse({
        ...detail,
        steps: many(21, () => ({ label: 'x', status: 'pending' })),
      }).success,
    ).toBe(false);
    expect(
      AgentRunDetail.safeParse({
        ...detail,
        timeline: many(51, () => ({ at: T, kind: 'tool', message: 'x' })),
      }).success,
    ).toBe(false);
    expect(
      AgentRunDetail.safeParse({
        ...detail,
        decisions: many(51, (i) => ({ id: `${U}3`, ...decision({ position: (i % 50) + 1 }) })),
      }).success,
    ).toBe(false);
    const { workflow: _w, ...noWorkflow } = detail;
    expect(AgentRunDetail.safeParse(noWorkflow).success).toBe(false);
    expect(AgentRunIdParams.safeParse({ id: `${U}1` }).success).toBe(true);
    expect(AgentRunIdParams.safeParse({ id: 's500-001-r4' }).success).toBe(false);
  });

  it('AS-1 WorkflowStageView.agentRuns is additive: defaults to [], carries {id, agent, state, stagePosition} and is bounded to 20', () => {
    const stage = {
      id: `${U}1`,
      position: 4,
      name: 'Implementation',
      state: 'RUNNING',
      stateObservedAt: T,
      stateReason: null,
      agent: 'implementer',
      startedAt: T,
      finishedAt: null,
      elapsedMs: 0,
      errorSummary: null,
      requiresApproval: false,
      current: true,
    };
    expect(WorkflowStageView.parse(stage).agentRuns).toEqual([]);
    const run = { id: `${U}2`, agent: 'implementer', state: 'RUNNING', stagePosition: 4 };
    expect(WorkflowStageView.parse({ ...stage, agentRuns: [run] }).agentRuns).toEqual([run]);
    expect(
      WorkflowStageView.safeParse({ ...stage, agentRuns: Array.from({ length: 21 }, () => run) })
        .success,
    ).toBe(false);
    expect(
      WorkflowStageView.safeParse({ ...stage, agentRuns: [{ ...run, stagePosition: 0 }] }).success,
    ).toBe(false);
  });
});
