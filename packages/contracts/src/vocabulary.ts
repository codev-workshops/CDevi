import { z } from 'zod';

/** The nine workflow states of specs/001 FR-002. */
export const WORKFLOW_STATES = [
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'WAITING',
  'WAITING_FOR_HUMAN',
  'BLOCKED',
  'FAILED',
  'COMPLETED',
  'CANCELLED',
] as const;
export const WorkflowState = z.enum(WORKFLOW_STATES);
export type WorkflowState = z.infer<typeof WorkflowState>;

/** The four risk levels of specs/001 FR-026. */
export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const RiskLevel = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ROLES = ['administrator', 'approver', 'engineer', 'viewer'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const TABS = ['needsYou', 'running', 'done'] as const;
export const Tab = z.enum(TABS);
export type Tab = z.infer<typeof Tab>;

export const INBOX_KINDS = [
  'approval',
  'clarification',
  'blocked',
  'failed',
  'running',
  'done',
] as const;
export const InboxKind = z.enum(INBOX_KINDS);
export type InboxKind = z.infer<typeof InboxKind>;

/** Roles that may start new work (spec FR-002). */
export const ROLES_THAT_CREATE_REQUIREMENTS: readonly Role[] = [
  'engineer',
  'approver',
  'administrator',
];
export const canCreateRequirement = (role: Role): boolean =>
  ROLES_THAT_CREATE_REQUIREMENTS.includes(role);
