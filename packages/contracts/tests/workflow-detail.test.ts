import { describe, expect, it } from 'vitest';
import {
  AgentRunUpsert,
  allowedActions,
  ArtifactUpsert,
  deriveAttention,
  deriveCurrentStage,
  deriveFailure,
  deriveProgress,
  describeStage,
  groupArtifactsByStage,
  nextStage,
  orderActivity,
  orderStages,
  ROLES,
  StageUpsert,
  stageElapsed,
  TestRunUpsert,
  WORKFLOW_STATES,
  WorkflowActionRequest,
  WorkflowDetail,
  type ArtifactRow,
  type RunRow,
  type StageRow,
  type TransitionRow,
} from '../src/index';

const NOW = new Date('2026-09-14T09:00:00Z');
const at = (min: number) => new Date(NOW.getTime() - min * 60_000);
const uuid = (n: number) => `00000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const stage = (
  position: number,
  state: StageRow['state'],
  over: Partial<StageRow> = {},
): StageRow => ({
  id: uuid(position),
  position,
  name: [
    'Requirement Analysis',
    'Impact Analysis',
    'Planning',
    'Implementation',
    'Testing',
    'Review',
    'PR',
  ][position - 1]!,
  state,
  stateObservedAt: at(60 - position * 5),
  stateReason: null,
  agent: 'coder',
  startedAt: at(70 - position * 5),
  finishedAt: state === 'COMPLETED' ? at(60 - position * 5) : null,
  errorSummary: null,
  requiresApproval: false,
  approvalId: null,
  clarificationId: null,
  ...over,
});

const pipeline = (states: StageRow['state'][]) => states.map((s, i) => stage(i + 1, s));

describe('workflow-detail read model (data-model.md §6)', () => {
  it('FR-001 orderStages sorts by position regardless of input order', () => {
    const shuffled = [stage(3, 'QUEUED'), stage(1, 'COMPLETED'), stage(2, 'RUNNING')];
    expect(orderStages(shuffled).map((s) => s.position)).toEqual([1, 2, 3]);
  });

  it('FR-001 deriveCurrentStage picks the first active stage, else first queued, else last, else null', () => {
    expect(
      deriveCurrentStage(pipeline(['COMPLETED', 'COMPLETED', 'RUNNING', 'QUEUED']))?.position,
    ).toBe(3);
    expect(
      deriveCurrentStage(pipeline(['COMPLETED', 'WAITING_FOR_HUMAN', 'QUEUED']))?.position,
    ).toBe(2);
    expect(deriveCurrentStage(pipeline(['COMPLETED', 'FAILED', 'QUEUED']))?.position).toBe(2);
    expect(deriveCurrentStage(pipeline(['COMPLETED', 'QUEUED', 'QUEUED']))?.position).toBe(2);
    expect(deriveCurrentStage(pipeline(['COMPLETED', 'COMPLETED']))?.position).toBe(2);
    expect(deriveCurrentStage([])).toBeNull();
  });

  it('FR-001 nextStage returns the following stage or null at the end', () => {
    const stages = pipeline(['COMPLETED', 'RUNNING', 'QUEUED']);
    expect(nextStage(stages, stages[1]!)?.position).toBe(3);
    expect(nextStage(stages, stages[2]!)).toBeNull();
    expect(nextStage(stages, null)).toBeNull();
  });

  it('FR-001 deriveProgress counts COMPLETED stages over the total', () => {
    expect(deriveProgress(pipeline(['COMPLETED', 'COMPLETED', 'FAILED', 'QUEUED']))).toEqual({
      completed: 2,
      total: 4,
    });
    expect(deriveProgress([])).toEqual({ completed: 0, total: 0 });
  });

  it('FR-001 stageElapsed uses finishedAt when present, now otherwise, and null before start', () => {
    expect(stageElapsed({ startedAt: at(30), finishedAt: at(10) }, NOW)).toBe(20 * 60_000);
    expect(stageElapsed({ startedAt: at(30), finishedAt: null }, NOW)).toBe(30 * 60_000);
    expect(stageElapsed({ startedAt: null, finishedAt: null }, NOW)).toBeNull();
    expect(stageElapsed({ startedAt: new Date(NOW.getTime() + 1000), finishedAt: null }, NOW)).toBe(
      0,
    );
  });

  it('FR-001 describeStage is plain language naming the agent, stage, state and summary', () => {
    const s = stage(5, 'RUNNING', { agent: 'tester' });
    const run: RunRow = {
      id: uuid(50),
      stageId: s.id,
      agent: 'tester',
      model: 'm',
      state: 'RUNNING',
      startedAt: at(5),
      finishedAt: null,
      summary: 'Running 120 unit tests.',
      timeline: [],
    };
    expect(describeStage(s, run)).toBe(
      'tester — Testing is being worked on. Running 120 unit tests.',
    );
    expect(describeStage(stage(6, 'WAITING_FOR_HUMAN', { agent: null }), null)).toBe(
      'Review is waiting for a human decision.',
    );
  });

  it('FR-004 orderActivity merges transitions, run start/finish and timeline ascending and bounds to the limit', () => {
    const stages = pipeline(['COMPLETED', 'RUNNING']);
    const transitions: TransitionRow[] = [
      {
        stageId: stages[1]!.id,
        fromState: 'QUEUED',
        toState: 'RUNNING',
        observedAt: at(20),
        reason: null,
        byUser: null,
      },
      {
        stageId: null,
        fromState: null,
        toState: 'RUNNING',
        observedAt: at(60),
        reason: 'created',
        byUser: null,
      },
      {
        stageId: stages[0]!.id,
        fromState: 'RUNNING',
        toState: 'COMPLETED',
        observedAt: at(30),
        reason: null,
        byUser: null,
      },
    ];
    const runs: RunRow[] = [
      {
        id: uuid(90),
        stageId: stages[1]!.id,
        agent: 'coder',
        model: 'm',
        state: 'RUNNING',
        startedAt: at(19),
        finishedAt: null,
        summary: null,
        timeline: [{ at: at(15).toISOString(), kind: 'tool', message: 'ran tests' }],
      },
      {
        id: uuid(91),
        stageId: stages[0]!.id,
        agent: 'analyst',
        model: null,
        state: 'COMPLETED',
        startedAt: at(55),
        finishedAt: at(31),
        summary: 'Spec written',
        timeline: [],
      },
    ];
    const events = orderActivity(stages, transitions, runs);
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort());
    expect(events.map((e) => e.message)).toEqual([
      'Workflow running — created',
      'analyst started',
      'analyst finished — completed: Spec written',
      'Requirement Analysis completed',
      'Impact Analysis running',
      'coder started (m)',
      'coder: ran tests',
    ]);
    expect(events.map((e) => e.source)).toEqual([
      'workflow',
      'agent',
      'agent',
      'stage',
      'stage',
      'agent',
      'agent',
    ]);
    expect(events[4]!.stage?.position).toBe(2);
    const many: TransitionRow[] = Array.from({ length: 250 }, (_, i) => ({
      stageId: null,
      fromState: null,
      toState: 'RUNNING',
      observedAt: at(300 - i),
      reason: `#${i}`,
      byUser: null,
    }));
    const bounded = orderActivity(stages, many, [], 200);
    expect(bounded).toHaveLength(200);
    expect(bounded[199]!.message).toContain('#249');
  });

  it('FR-004 orderActivity marks human transitions with the actor', () => {
    const stages = pipeline(['FAILED']);
    const events = orderActivity(
      stages,
      [
        {
          stageId: stages[0]!.id,
          fromState: 'FAILED',
          toState: 'RETRYING',
          observedAt: at(1),
          reason: 'Retry requested by Eng',
          byUser: 'Eng',
        },
      ],
      [],
    );
    expect(events[0]).toMatchObject({
      source: 'human',
      message: 'Requirement Analysis retrying — Retry requested by Eng',
    });
  });

  it('FR-004 groupArtifactsByStage orders by stage position then producedAt and tags each with its stage', () => {
    const stages = pipeline(['COMPLETED', 'COMPLETED', 'RUNNING']);
    const artifacts: ArtifactRow[] = [
      {
        id: uuid(3),
        stageId: stages[2]!.id,
        type: 'code_diff',
        title: 'diff',
        href: null,
        summary: null,
        producedAt: at(1),
      },
      {
        id: uuid(1),
        stageId: stages[0]!.id,
        type: 'requirement_spec',
        title: 'spec',
        href: null,
        summary: null,
        producedAt: at(50),
      },
      {
        id: uuid(2),
        stageId: stages[0]!.id,
        type: 'impact_analysis',
        title: 'impact',
        href: null,
        summary: null,
        producedAt: at(40),
      },
      {
        id: uuid(4),
        stageId: 'orphan',
        type: 'pull_request',
        title: 'x',
        href: null,
        summary: null,
        producedAt: at(0),
      },
    ];
    const grouped = groupArtifactsByStage(artifacts, stages);
    expect(grouped.map((a) => a.title)).toEqual(['spec', 'impact', 'diff']);
    expect(grouped.map((a) => a.stage.position)).toEqual([1, 1, 3]);
    expect(grouped[2]!.stage.name).toBe('Planning');
  });

  it('FR-005 deriveAttention returns the first WAITING_FOR_HUMAN/BLOCKED stage with reason and a direct action', () => {
    const waiting = pipeline(['COMPLETED', 'WAITING_FOR_HUMAN', 'QUEUED']);
    const approval = {
      id: uuid(700),
      ask: 'Approve deploy',
      riskLevel: 'HIGH' as const,
      requestedAt: at(3),
    };
    expect(deriveAttention(waiting, { approval, clarification: null })).toEqual({
      state: 'WAITING_FOR_HUMAN',
      stage: { id: waiting[1]!.id, position: 2, name: 'Impact Analysis' },
      reason: 'Approve deploy',
      since: at(3).toISOString(),
      riskLevel: 'HIGH',
      action: { label: 'Review approval', href: `/approvals/${uuid(700)}` },
    });
    const clarification = { id: uuid(701), question: 'Which region?', requestedAt: at(2) };
    expect(deriveAttention(waiting, { approval: null, clarification })).toMatchObject({
      reason: 'Which region?',
      action: { label: 'Answer clarification', href: `/approvals/${uuid(701)}` },
    });
    const blocked = pipeline(['COMPLETED', 'BLOCKED']);
    blocked[1]!.stateReason = 'GitHub token expired';
    expect(deriveAttention(blocked, { approval: null, clarification: null })).toMatchObject({
      state: 'BLOCKED',
      reason: 'GitHub token expired',
      action: { label: 'Open Integrations', href: '/integrations' },
    });
    expect(
      deriveAttention(pipeline(['COMPLETED', 'RUNNING']), { approval: null, clarification: null }),
    ).toBeNull();
  });

  it('FR-006 deriveFailure returns reason, failing stage and last successful stage (or null)', () => {
    const stages = pipeline([
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'COMPLETED',
      'FAILED',
      'QUEUED',
      'QUEUED',
    ]);
    stages[4]!.errorSummary = '3 unit tests failing';
    const wf = { state: 'FAILED' as const, stateReason: 'other', stateObservedAt: at(9) };
    expect(deriveFailure(wf, stages)).toEqual({
      reason: '3 unit tests failing',
      failedAt: stages[4]!.stateObservedAt.toISOString(),
      failingStage: { id: stages[4]!.id, position: 5, name: 'Testing' },
      lastSuccessfulStage: { id: stages[3]!.id, position: 4, name: 'Implementation' },
    });
    const first = pipeline(['FAILED', 'QUEUED']);
    expect(deriveFailure(wf, first)?.lastSuccessfulStage).toBeNull();
    expect(deriveFailure(wf, first)?.reason).toBe('other');
    expect(deriveFailure({ ...wf, state: 'RUNNING' }, pipeline(['RUNNING']))).toBeNull();

    // Workflow still FAILED while the failing stage was already moved to RETRYING: anchor on the active stage, not the last one.
    const retrying = pipeline(['COMPLETED', 'COMPLETED', 'RETRYING', 'QUEUED', 'QUEUED']);
    const f = deriveFailure(wf, retrying);
    expect(f?.failingStage.position).toBe(3);
    expect(f?.lastSuccessfulStage?.position).toBe(2);
    expect(f?.reason).toBe('other');
  });

  it('FR-006 allowedActions gates retry/cancel to engineer+administrator and escalate to engineer+approver+administrator by state', () => {
    expect(allowedActions('engineer', 'FAILED')).toEqual({
      retry: true,
      escalate: true,
      cancel: true,
    });
    expect(allowedActions('administrator', 'FAILED')).toEqual({
      retry: true,
      escalate: true,
      cancel: true,
    });
    expect(allowedActions('approver', 'FAILED')).toEqual({
      retry: false,
      escalate: true,
      cancel: false,
    });
    expect(allowedActions('viewer', 'FAILED')).toEqual({
      retry: false,
      escalate: false,
      cancel: false,
    });
    expect(allowedActions('engineer', 'RUNNING')).toEqual({
      retry: false,
      escalate: false,
      cancel: true,
    });
    expect(allowedActions('engineer', 'BLOCKED')).toEqual({
      retry: false,
      escalate: true,
      cancel: true,
    });
    expect(allowedActions('engineer', 'COMPLETED')).toEqual({
      retry: false,
      escalate: false,
      cancel: false,
    });
    for (const role of ROLES)
      for (const state of WORKFLOW_STATES) expect(allowedActions(role, state)).toBeDefined();
  });
});

describe('workflow-detail ingestion and action schemas (data-model.md §5)', () => {
  it('FR-002 StageUpsert accepts the nine states and rejects bad names and reasons', () => {
    for (const state of WORKFLOW_STATES) {
      expect(
        StageUpsert.safeParse({ name: 'Testing', state, observedAt: NOW.toISOString() }).success,
      ).toBe(true);
    }
    expect(
      StageUpsert.safeParse({
        name: 'x'.repeat(61),
        state: 'RUNNING',
        observedAt: NOW.toISOString(),
      }).success,
    ).toBe(false);
    expect(
      StageUpsert.safeParse({
        name: 'T',
        state: 'RUNNING',
        observedAt: NOW.toISOString(),
        reason: 'r'.repeat(241),
      }).success,
    ).toBe(false);
  });

  it('FR-001 AgentRunUpsert rejects QUEUED, > 50 timeline events and unknown event kinds', () => {
    const base = {
      workflowExternalId: 'w-1',
      stagePosition: 5,
      agent: 'tester',
      state: 'RUNNING',
      startedAt: NOW.toISOString(),
    };
    expect(AgentRunUpsert.safeParse(base).success).toBe(true);
    expect(AgentRunUpsert.parse(base).timeline).toEqual([]);
    expect(AgentRunUpsert.safeParse({ ...base, state: 'QUEUED' }).success).toBe(false);
    const ev = { at: NOW.toISOString(), kind: 'tool', message: 'x' };
    expect(AgentRunUpsert.safeParse({ ...base, timeline: Array(51).fill(ev) }).success).toBe(false);
    expect(
      AgentRunUpsert.safeParse({ ...base, timeline: [{ ...ev, kind: 'thought' }] }).success,
    ).toBe(false);
  });

  it('FR-004 ArtifactUpsert accepts the six artifact types and rejects others and long hrefs', () => {
    const base = {
      workflowExternalId: 'w-1',
      stagePosition: 1,
      title: 'Spec',
      producedAt: NOW.toISOString(),
    };
    for (const type of [
      'requirement_spec',
      'impact_analysis',
      'implementation_plan',
      'test_results',
      'code_diff',
      'pull_request',
    ]) {
      expect(ArtifactUpsert.safeParse({ ...base, type }).success).toBe(true);
    }
    expect(ArtifactUpsert.safeParse({ ...base, type: 'screenshot' }).success).toBe(false);
    expect(
      ArtifactUpsert.safeParse({
        ...base,
        type: 'code_diff',
        href: `https://x.test/${'a'.repeat(500)}`,
      }).success,
    ).toBe(false);
  });

  it('FR-004 TestRunUpsert rejects passed+failed+skipped > total', () => {
    const base = {
      workflowExternalId: 'w-1',
      stagePosition: 5,
      category: 'unit',
      status: 'PASSED',
      startedAt: NOW.toISOString(),
    };
    expect(
      TestRunUpsert.safeParse({ ...base, total: 10, passed: 8, failed: 1, skipped: 1 }).success,
    ).toBe(true);
    expect(TestRunUpsert.safeParse({ ...base, total: 10, passed: 8, failed: 3 }).success).toBe(
      false,
    );
  });

  it('FR-006 WorkflowActionRequest accepts retry|escalate|cancel with an optional note', () => {
    expect(WorkflowActionRequest.safeParse({ action: 'retry' }).success).toBe(true);
    expect(
      WorkflowActionRequest.safeParse({ action: 'escalate', note: 'Please look' }).success,
    ).toBe(true);
    expect(WorkflowActionRequest.safeParse({ action: 'approve' }).success).toBe(false);
    expect(
      WorkflowActionRequest.safeParse({ action: 'cancel', note: 'n'.repeat(241) }).success,
    ).toBe(false);
  });

  it('FR-004 WorkflowDetail parses a minimal response', () => {
    const detail = {
      generatedAt: NOW.toISOString(),
      workflow: {
        id: uuid(1),
        externalId: 's500-001',
        title: 'T',
        project: { id: uuid(2), key: 'PLAT', name: 'Platform' },
        state: 'RUNNING',
        stateReason: null,
        stateObservedAt: NOW.toISOString(),
        agent: 'coder',
        pullRequestRef: null,
        startedAt: null,
        finishedAt: null,
        elapsedMs: null,
        stage: null,
        riskLevel: null,
      },
      stages: [],
      currentStage: null,
      nextStage: null,
      progress: { completed: 0, total: 0 },
      activity: [],
      artifacts: [],
      testRuns: [],
      attention: null,
      failure: null,
      actions: { retry: false, escalate: false, cancel: false },
    };
    expect(WorkflowDetail.safeParse(detail).success).toBe(true);
  });
});
