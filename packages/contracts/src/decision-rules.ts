/**
 * Pure human-decision rules for the Approval Center (specs/001 US2, contracts/decision-rules.md).
 * No zod, no I/O, no Date.now — shared by the API (enforcement) and the browser (affordances).
 */
import { riskRank } from './read-model';
import type { RiskLevel, Role, WorkflowState } from './vocabulary';

// ---- §1 who may decide (FR-032)
export const DECIDER_ROLES: readonly Role[] = ['administrator', 'approver'];
export const canDecide = (role: Role): boolean => DECIDER_ROLES.includes(role);

// ---- §4 explicit confirmation (FR-013)
export const CONFIRM_RISKS: readonly RiskLevel[] = ['HIGH', 'CRITICAL'];
export const requiresConfirmation = (risk: RiskLevel | null): boolean =>
  risk != null && CONFIRM_RISKS.includes(risk);

// ---- §5 resulting workflow state (FR-012, FR-013, FR-014)
export const REJECTION_TARGETS = ['BLOCKED', 'CANCELLED'] as const;
export type RejectionTargetValue = (typeof REJECTION_TARGETS)[number];
export type Decision =
  { kind: 'approve' } | { kind: 'answer' } | { kind: 'reject'; target: RejectionTargetValue };

export function resultingState(decision: Decision): WorkflowState {
  return decision.kind === 'reject' ? decision.target : 'RUNNING';
}

// ---- §7 exactly once (FR-015)
export const decisionAllowed = (
  workflowState: WorkflowState | null,
  itemPending: boolean,
): boolean => itemPending && workflowState === 'WAITING_FOR_HUMAN';

// ---- §3 ordering (FR-011): highest risk first, oldest first, id; clarifications (no risk) last
export type ApprovalCenterOrderSource = {
  id: string;
  riskLevel: RiskLevel | null;
  requestedAt: Date;
};

const cmp = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);

export function orderApprovalCenter(
  a: ApprovalCenterOrderSource,
  b: ApprovalCenterOrderSource,
): number {
  return (
    cmp(riskRank(a.riskLevel), riskRank(b.riskLevel)) ||
    cmp(a.requestedAt.getTime(), b.requestedAt.getTime()) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// ---- §6 clarification answers (FR-014)
export const ANSWER_TEXT_MAX = 2000;

export type AnswerOption = { value: string; label: string; recommended: boolean };
export type AnswerInput = { option?: string | null | undefined; text?: string | null | undefined };
export type AnswerValidation =
  | { ok: true; option: string | null; text: string }
  | { ok: false; path: 'answer' | 'option' | 'text'; message: string };

export function answerIsValid(
  body: AnswerInput,
  options: readonly AnswerOption[],
): AnswerValidation {
  const hasOption = body.option != null && body.option !== '';
  const hasText = body.text != null && body.text !== '';
  if (hasOption === hasText) {
    return { ok: false, path: 'answer', message: 'Choose an option or write an answer, not both' };
  }
  if (hasOption) {
    const match = options.find((o) => o.value === body.option);
    if (!match) return { ok: false, path: 'option', message: 'Unknown option' };
    return { ok: true, option: match.value, text: match.label };
  }
  const text = (body.text ?? '').trim();
  if (text.length === 0) return { ok: false, path: 'text', message: 'Write an answer' };
  if (text.length > ANSWER_TEXT_MAX) {
    return {
      ok: false,
      path: 'text',
      message: `Answer must be at most ${ANSWER_TEXT_MAX} characters`,
    };
  }
  return { ok: true, option: null, text };
}
