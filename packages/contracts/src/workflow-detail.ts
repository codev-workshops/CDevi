import { z } from 'zod';
import { DecisionLink, IsoDateTime, line, Uuid } from './common';
import { REVIEW_STATUSES } from './review-model';
import { RiskLevel, WorkflowState } from './vocabulary';

/** The six artifact kinds of specs/001 US1 scenario 2 (data-model.md §2.3). */
export const ARTIFACT_TYPES = [
  'requirement_spec',
  'impact_analysis',
  'implementation_plan',
  'test_results',
  'code_diff',
  'pull_request',
] as const;
export const ArtifactType = z.enum(ARTIFACT_TYPES);
export type ArtifactType = z.infer<typeof ArtifactType>;

export const TEST_RUN_STATUSES = ['RUNNING', 'PASSED', 'FAILED'] as const;
export const TestRunStatus = z.enum(TEST_RUN_STATUSES);
export type TestRunStatus = z.infer<typeof TestRunStatus>;

export const AGENT_RUN_EVENT_KINDS = ['tool', 'decision', 'note', 'error'] as const;
export const AgentRunEvent = z.object({
  at: IsoDateTime,
  kind: z.enum(AGENT_RUN_EVENT_KINDS),
  message: line(240),
});
export type AgentRunEvent = z.infer<typeof AgentRunEvent>;

export const WORKFLOW_ACTIONS = ['retry', 'escalate', 'cancel'] as const;
export const WorkflowAction = z.enum(WORKFLOW_ACTIONS);
export type WorkflowAction = z.infer<typeof WorkflowAction>;

export const WorkflowActionRequest = z.object({
  action: WorkflowAction,
  note: line(240).nullable().optional(),
});
export type WorkflowActionRequest = z.infer<typeof WorkflowActionRequest>;

export const WorkflowIdParams = z.object({ id: Uuid });
export type WorkflowIdParams = z.infer<typeof WorkflowIdParams>;

// ---- read model (data-model.md §7)

export const StageRef = z.object({ id: Uuid, position: z.number().int(), name: z.string() });
export type StageRef = z.infer<typeof StageRef>;

/** Drill-down entry to `/agents/runs/{id}` from a stage (specs/001 US5 AS-1). */
export const StageAgentRunRef = z.object({
  id: Uuid,
  agent: z.string(),
  state: WorkflowState,
  stagePosition: z.number().int().min(1),
});
export type StageAgentRunRef = z.infer<typeof StageAgentRunRef>;

export const WorkflowStageView = z.object({
  id: Uuid,
  position: z.number().int(),
  name: z.string(),
  state: WorkflowState,
  stateObservedAt: IsoDateTime,
  stateReason: z.string().nullable(),
  agent: z.string().nullable(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  elapsedMs: z.number().int().min(0).nullable(),
  errorSummary: z.string().nullable(),
  requiresApproval: z.boolean(),
  current: z.boolean(),
  agentRuns: z.array(StageAgentRunRef).max(20).default([]),
});
export type WorkflowStageView = z.infer<typeof WorkflowStageView>;

export const CurrentStageView = z.object({
  stage: StageRef,
  state: WorkflowState,
  agent: z.string().nullable(),
  model: z.string().nullable(),
  startedAt: IsoDateTime.nullable(),
  elapsedMs: z.number().int().min(0).nullable(),
  summary: z.string(),
});
export type CurrentStageView = z.infer<typeof CurrentStageView>;

export const ACTIVITY_SOURCES = ['workflow', 'stage', 'agent', 'human'] as const;
export const ActivityEvent = z.object({
  at: IsoDateTime,
  source: z.enum(ACTIVITY_SOURCES),
  message: z.string(),
  stage: StageRef.nullable(),
  state: WorkflowState.nullable(),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

export const ArtifactView = z.object({
  id: Uuid,
  externalId: z.string(),
  type: ArtifactType,
  title: z.string(),
  href: z.string().nullable(),
  summary: z.string().nullable(),
  producedAt: IsoDateTime,
  stage: StageRef,
});
export type ArtifactView = z.infer<typeof ArtifactView>;

export const TestRunView = z.object({
  id: Uuid,
  category: z.string(),
  status: TestRunStatus,
  total: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  href: z.string().nullable(),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  stage: StageRef,
});
export type TestRunView = z.infer<typeof TestRunView>;

export const AttentionView = z.object({
  state: z.enum(['WAITING_FOR_HUMAN', 'BLOCKED']),
  stage: StageRef,
  reason: z.string(),
  since: IsoDateTime,
  riskLevel: RiskLevel.nullable(),
  action: z.object({ label: z.string(), href: z.string() }),
});
export type AttentionView = z.infer<typeof AttentionView>;

export const FailureView = z.object({
  reason: z.string(),
  failedAt: IsoDateTime,
  failingStage: StageRef,
  lastSuccessfulStage: StageRef.nullable(),
});
export type FailureView = z.infer<typeof FailureView>;

export const ActionsView = z.object({
  retry: z.boolean(),
  escalate: z.boolean(),
  cancel: z.boolean(),
});
export type ActionsView = z.infer<typeof ActionsView>;

/**
 * US6 FR-022: the workflow's pull request and its derived merge readiness (declared here, not in ./reviews,
 * because ./agent-runs already imports this module). `href` is the PR in the git host, `reviewHref` the Review Center.
 */
export const WorkflowPullRequestView = z.object({
  id: Uuid,
  number: z.number().int().min(1),
  title: z.string(),
  href: z
    .string()
    .trim()
    .max(500)
    .refine((s) => /^https?:\/\//.test(s), { message: 'must be an http(s) URL' }),
  reviewStatus: z.enum(REVIEW_STATUSES).nullable(),
  readyForMerge: z.boolean(),
  blockingOpenCount: z.number().int().min(0),
  reviewHref: DecisionLink,
});
export type WorkflowPullRequestView = z.infer<typeof WorkflowPullRequestView>;

export const WorkflowDetail = z.object({
  generatedAt: IsoDateTime,
  workflow: z.object({
    id: Uuid,
    externalId: z.string(),
    title: z.string(),
    project: z.object({ id: Uuid, key: z.string(), name: z.string() }),
    state: WorkflowState,
    stateReason: z.string().nullable(),
    stateObservedAt: IsoDateTime,
    agent: z.string().nullable(),
    pullRequestRef: z.string().nullable(),
    startedAt: IsoDateTime.nullable(),
    finishedAt: IsoDateTime.nullable(),
    elapsedMs: z.number().int().min(0).nullable(),
    stage: z
      .object({ index: z.number().int(), count: z.number().int(), name: z.string().nullable() })
      .nullable(),
    riskLevel: RiskLevel.nullable(),
  }),
  stages: z.array(WorkflowStageView).max(20),
  currentStage: CurrentStageView.nullable(),
  nextStage: StageRef.nullable(),
  progress: z.object({ completed: z.number().int().min(0), total: z.number().int().min(0) }),
  activity: z.array(ActivityEvent).max(200),
  artifacts: z.array(ArtifactView).max(100),
  testRuns: z.array(TestRunView).max(50),
  attention: AttentionView.nullable(),
  failure: FailureView.nullable(),
  actions: ActionsView,
  /** US6 FR-022: the workflow's pull request and its merge readiness; `workflow.pullRequestRef` stays for older readers. */
  pullRequest: WorkflowPullRequestView.nullable().default(null),
});
export type WorkflowDetail = z.infer<typeof WorkflowDetail>;
