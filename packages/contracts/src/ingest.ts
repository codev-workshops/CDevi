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

/** http(s) URL or app-relative path, ≤ 500 chars (data-model.md §13). */
export const DecisionLink = z
  .string()
  .trim()
  .max(500)
  .refine((s) => /^https?:\/\//.test(s) || s.startsWith('/'), {
    message: 'must be an http(s) URL or an app-relative path',
  });
export const DECISION_LINK_KEYS = [
  'requirement',
  'pullRequest',
  'externalTicket',
  'workflow',
] as const;
export const DecisionLinks = z
  .object({
    requirement: DecisionLink.optional(),
    pullRequest: DecisionLink.optional(),
    externalTicket: DecisionLink.optional(),
    workflow: DecisionLink.optional(),
  })
  .strict();
export type DecisionLinks = z.infer<typeof DecisionLinks>;

export const ClarificationOption = z.object({
  value: line(80),
  label: line(120),
  recommended: z.boolean().default(false),
});
export type ClarificationOption = z.infer<typeof ClarificationOption>;

export const ApprovalUpsert = z
  .object({
    workflowExternalId: ExternalId,
    ask: line(240),
    riskLevel: RiskLevel,
    context: z.string().trim().min(1).max(2000).nullable().optional(),
    links: DecisionLinks.default({}),
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

export const ClarificationUpsert = z
  .object({
    workflowExternalId: ExternalId,
    question: line(240),
    requestedByAgent: line(80).nullable().optional(),
    requestedAt: IsoDateTime,
    hasRecommendedAnswer: z.boolean().default(false),
    whyItMatters: z.string().trim().min(1).max(1000).nullable().optional(),
    options: z
      .array(ClarificationOption)
      .max(8)
      .default([])
      .refine((o) => o.filter((x) => x.recommended).length <= 1, {
        message: 'at most one option may be recommended',
      })
      .refine((o) => new Set(o.map((x) => x.value)).size === o.length, {
        message: 'option values must be unique',
      }),
    links: DecisionLinks.default({}),
    answer: z
      .object({ answeredAt: IsoDateTime, answeredBy: line(120).nullable().optional() })
      .nullable()
      .optional(),
  })
  .transform((c) => ({
    ...c,
    hasRecommendedAnswer: c.hasRecommendedAnswer || c.options.some((o) => o.recommended),
  }));
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
