import type { PillVariant } from './components/Pill/Pill';

export { cssVar, semanticColor, tokenVersion } from './tokens.generated';
export type { TokenName } from './tokens.generated';

/** Workflow / stage states from specs/001-sdlc-control-plane-mvp FR-002. */
export type WorkflowState =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING'
  | 'WAITING_FOR_HUMAN'
  | 'BLOCKED'
  | 'FAILED'
  | 'RETRYING'
  | 'COMPLETED'
  | 'CANCELLED';

export const WORKFLOW_STATES: readonly WorkflowState[] = [
  'QUEUED',
  'RUNNING',
  'WAITING',
  'WAITING_FOR_HUMAN',
  'BLOCKED',
  'FAILED',
  'RETRYING',
  'COMPLETED',
  'CANCELLED',
];

export interface StatePresentation {
  variant: PillVariant;
  /** The word shown in the pill; also its accessible name. */
  word: string;
  pulse: boolean;
  /** Extra class, e.g. strike-through for cancelled. */
  modifier?: string;
}

/**
 * Normative mapping — specs/002-adopt-design-system/contracts/state-risk-mapping.md.
 * Changing it here requires the same change in DESIGN.md §4 and the skill in one commit.
 */
export const stateToPill: Record<WorkflowState, StatePresentation> = {
  QUEUED: { variant: 'neutral', word: 'queued', pulse: false },
  RUNNING: { variant: 'run', word: 'running', pulse: true },
  RETRYING: { variant: 'run', word: 'retrying', pulse: true },
  WAITING: { variant: 'wait', word: 'waiting', pulse: false },
  WAITING_FOR_HUMAN: { variant: 'needs-you', word: 'needs you', pulse: false },
  BLOCKED: { variant: 'blocked', word: 'blocked', pulse: false },
  FAILED: { variant: 'fail', word: 'failed', pulse: false },
  COMPLETED: { variant: 'done', word: 'completed', pulse: false },
  CANCELLED: { variant: 'neutral', word: 'cancelled', pulse: false, modifier: 'cd-cancelled' },
};

/** Risk levels from specs/001 FR-026. */
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type RiskVariant = 'low' | 'medium' | 'high' | 'critical';

export const RISK_LEVELS: readonly RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export interface RiskPresentation {
  variant: RiskVariant;
  word: string;
  prominent: boolean;
}

export const riskToVariant: Record<RiskLevel, RiskPresentation> = {
  LOW: { variant: 'low', word: 'low risk', prominent: false },
  MEDIUM: { variant: 'medium', word: 'medium risk', prominent: false },
  HIGH: { variant: 'high', word: 'high risk', prominent: true },
  CRITICAL: { variant: 'critical', word: 'critical risk', prominent: true },
};

/** Review finding severity and blocking class (specs/001 FR-020). */
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type FindingBlocking = 'BLOCKING' | 'NON-BLOCKING' | 'SUGGESTION';

export const severityToPill: Record<FindingSeverity, PillVariant> = {
  CRITICAL: 'blocked',
  HIGH: 'fail',
  MEDIUM: 'wait',
  LOW: 'neutral',
  INFO: 'neutral',
};

export const blockingToPill: Record<FindingBlocking, PillVariant> = {
  BLOCKING: 'needs-you',
  'NON-BLOCKING': 'neutral',
  SUGGESTION: 'neutral',
};

/** Policy outcome of an agent decision (specs/001 FR-017). */
export type PolicyOutcome = 'allowed' | 'approval_required' | 'denied';

export const policyOutcomeToPill: Record<PolicyOutcome, { variant: PillVariant; word: string }> = {
  allowed: { variant: 'done', word: 'allowed' },
  approval_required: { variant: 'needs-you', word: 'approval required' },
  denied: { variant: 'blocked', word: 'denied' },
};
