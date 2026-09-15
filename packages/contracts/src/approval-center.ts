import { z } from 'zod';
import { IsoDateTime, Uuid } from './common';
import { Resolution } from './decisions';
import { ClarificationOption, DecisionLinks } from './ingest';
import { RiskLevel, WorkflowState } from './vocabulary';

export const APPROVAL_CENTER_LIMIT = 200;
export const AUDIT_LIMIT = 20;

export const ApprovalCenterKind = z.enum(['approval', 'clarification']);
export type ApprovalCenterKind = z.infer<typeof ApprovalCenterKind>;

/** One row of the Approval Center list (specs/001 US2 scenario 1, data-model.md §14). */
export const ApprovalCenterItem = z.object({
  id: Uuid,
  kind: ApprovalCenterKind,
  workflowId: Uuid,
  workflowExternalId: z.string(),
  workflowTitle: z.string(),
  project: z.object({ id: Uuid, key: z.string(), name: z.string() }),
  ask: z.string(),
  riskLevel: RiskLevel.nullable(),
  requestedBy: z.string().nullable(),
  requestedAt: IsoDateTime,
  expiresAt: IsoDateTime.nullable(),
  hasRecommendedAnswer: z.boolean(),
  href: z.string(),
});
export type ApprovalCenterItem = z.infer<typeof ApprovalCenterItem>;

export const ApprovalCenterSnapshot = z.object({
  generatedAt: IsoDateTime,
  project: z.union([z.literal('all'), Uuid]),
  items: z.array(ApprovalCenterItem).max(APPROVAL_CENTER_LIMIT),
  counts: z.object({ approvals: z.number().int().min(0), clarifications: z.number().int().min(0) }),
});
export type ApprovalCenterSnapshot = z.infer<typeof ApprovalCenterSnapshot>;

export const AUDIT_ACTIONS = [
  'approval.approved',
  'approval.rejected',
  'clarification.answered',
] as const;
export const AuditAction = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditAction>;

/** Audit row as shown on the decision screen (FR-029). */
export const AuditEventView = z.object({
  id: Uuid,
  occurredAt: IsoDateTime,
  actor: z.object({
    type: z.enum(['user', 'agent', 'system']),
    id: z.string().nullable(),
    name: z.string(),
  }),
  action: z.string(),
  target: z.object({ type: z.string(), id: Uuid }),
  riskLevel: RiskLevel.nullable(),
  result: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type AuditEventView = z.infer<typeof AuditEventView>;

export const ApprovalCenterDetail = z.object({
  item: ApprovalCenterItem,
  workflowState: WorkflowState,
  canDecide: z.boolean(),
  approval: z
    .object({
      context: z.string().nullable(),
      links: DecisionLinks,
      requiresConfirmation: z.boolean(),
    })
    .nullable(),
  clarification: z
    .object({
      whyItMatters: z.string().nullable(),
      options: z.array(ClarificationOption),
      links: DecisionLinks,
    })
    .nullable(),
  resolution: Resolution.nullable(),
  audit: z.array(AuditEventView).max(AUDIT_LIMIT),
});
export type ApprovalCenterDetail = z.infer<typeof ApprovalCenterDetail>;

export const DecisionResult = z.object({ detail: ApprovalCenterDetail });
export type DecisionResult = z.infer<typeof DecisionResult>;
