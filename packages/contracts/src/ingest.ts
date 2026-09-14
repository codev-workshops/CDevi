import { z } from 'zod';
import { ExternalId, IsoDateTime, line, StageInput, Uuid } from './common';
import { RiskLevel, WorkflowState } from './vocabulary';

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
