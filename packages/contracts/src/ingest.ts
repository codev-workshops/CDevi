import { z } from 'zod';
import { ExternalId, IsoDateTime, line, StageInput, Uuid } from './common';
import { RiskLevel, WorkflowState } from './vocabulary';
import { AgentRunEvent, ArtifactType, TestRunStatus } from './workflow-detail';

export const WorkflowUpsert = z.object({
  projectKey: z.string().min(1).max(64),
  title: line(200),
  agent: line(80).nullable().optional(),
  state: WorkflowState.optional(),
  reason: line(240).nullable().optional(),
  stage: StageInput.nullable().optional(),
  pullRequestRef: line(200).nullable().optional(),
  observedAt: IsoDateTime,
});
export type WorkflowUpsert = z.infer<typeof WorkflowUpsert>;

export const Transition = z.object({
  toState: WorkflowState,
  observedAt: IsoDateTime,
  reason: line(240).nullable().optional(),
  stage: StageInput.nullable().optional(),
});
export type Transition = z.infer<typeof Transition>;

export const ApprovalUpsert = z
  .object({
    workflowExternalId: ExternalId,
    ask: line(240),
    riskLevel: RiskLevel,
    requestedByAgent: line(80).nullable().optional(),
    requestedAt: IsoDateTime,
    expiresAt: IsoDateTime.nullable().optional(),
    decision: z
      .object({
        outcome: z.enum(['approved', 'rejected']),
        decidedAt: IsoDateTime,
        decidedBy: line(120).nullable().optional(),
      })
      .nullable()
      .optional(),
  })
  .refine((a) => !a.expiresAt || new Date(a.expiresAt) > new Date(a.requestedAt), {
    message: 'expiresAt must be after requestedAt',
    path: ['expiresAt'],
  });
export type ApprovalUpsert = z.infer<typeof ApprovalUpsert>;

export const ClarificationUpsert = z.object({
  workflowExternalId: ExternalId,
  question: line(240),
  requestedByAgent: line(80).nullable().optional(),
  requestedAt: IsoDateTime,
  hasRecommendedAnswer: z.boolean().default(false),
  answer: z
    .object({ answeredAt: IsoDateTime, answeredBy: line(120).nullable().optional() })
    .nullable()
    .optional(),
});
export type ClarificationUpsert = z.infer<typeof ClarificationUpsert>;

export const IngestResult = z.object({
  outcome: z.enum(['accepted', 'stale']),
  id: Uuid,
  state: WorkflowState.optional(),
});
export type IngestResult = z.infer<typeof IngestResult>;

export const ExternalIdParams = z.object({ externalId: ExternalId });

// ---- specs/001 US1 ingestion extensions (data-model.md §5)

export const StagePositionParams = z.object({
  externalId: ExternalId,
  position: z.coerce.number().int().min(1).max(20),
});
export type StagePositionParams = z.infer<typeof StagePositionParams>;

export const StageUpsert = z.object({
  name: line(60),
  state: WorkflowState,
  observedAt: IsoDateTime,
  reason: line(240).nullable().optional(),
  agent: line(80).nullable().optional(),
  errorSummary: line(400).nullable().optional(),
  requiresApproval: z.boolean().default(false),
  approvalExternalId: ExternalId.nullable().optional(),
  clarificationExternalId: ExternalId.nullable().optional(),
  count: z.number().int().min(1).max(20).optional(),
});
export type StageUpsert = z.infer<typeof StageUpsert>;

export const AgentRunUpsert = z.object({
  workflowExternalId: ExternalId,
  stagePosition: z.number().int().min(1).max(20),
  agent: line(80),
  model: line(80).nullable().optional(),
  state: WorkflowState.exclude(['QUEUED']),
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable().optional(),
  summary: line(400).nullable().optional(),
  timeline: z.array(AgentRunEvent).max(50).default([]),
});
export type AgentRunUpsert = z.infer<typeof AgentRunUpsert>;

export const ArtifactUpsert = z.object({
  workflowExternalId: ExternalId,
  stagePosition: z.number().int().min(1).max(20),
  type: ArtifactType,
  title: line(200),
  href: z.url().max(500).nullable().optional(),
  summary: line(400).nullable().optional(),
  producedAt: IsoDateTime,
});
export type ArtifactUpsert = z.infer<typeof ArtifactUpsert>;

export const TestRunUpsert = z
  .object({
    workflowExternalId: ExternalId,
    stagePosition: z.number().int().min(1).max(20),
    category: line(40),
    status: TestRunStatus,
    total: z.number().int().min(0).default(0),
    passed: z.number().int().min(0).default(0),
    failed: z.number().int().min(0).default(0),
    skipped: z.number().int().min(0).default(0),
    href: z.url().max(500).nullable().optional(),
    startedAt: IsoDateTime,
    finishedAt: IsoDateTime.nullable().optional(),
  })
  .refine((t) => t.passed + t.failed + t.skipped <= t.total, {
    message: 'passed + failed + skipped must not exceed total',
    path: ['total'],
  });
export type TestRunUpsert = z.infer<typeof TestRunUpsert>;
