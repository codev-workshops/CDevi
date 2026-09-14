import { z } from 'zod';
import { IsoDateTime, line, Problem, Uuid } from './common';
import { ANSWER_TEXT_MAX, REJECTION_TARGETS } from './decision-rules';
import { WorkflowState } from './vocabulary';

/** Path parameter of every decision route (specs/001 US2, data-model.md §13). */
export const DecisionParams = z.object({ id: Uuid });
export type DecisionParams = z.infer<typeof DecisionParams>;

export const RejectionTarget = z.enum(REJECTION_TARGETS);
export type RejectionTarget = z.infer<typeof RejectionTarget>;

/** `confirmed` must be true for HIGH/CRITICAL approvals (FR-013). */
export const ApproveRequest = z.object({ confirmed: z.boolean().default(false) });
export type ApproveRequest = z.infer<typeof ApproveRequest>;

/** Rejection always carries a reason and the caller-chosen target state (scenario 5). */
export const RejectRequest = z.object({
  reason: z.string().trim().min(1).max(500),
  target: RejectionTarget,
});
export type RejectRequest = z.infer<typeof RejectRequest>;

/** Exactly one of `option` (a suggested option value) or `text` (free text) (FR-014). */
export const AnswerRequest = z
  .object({
    option: line(80).optional(),
    text: z.string().trim().min(1).max(ANSWER_TEXT_MAX).optional(),
  })
  .refine((a) => (a.option != null) !== (a.text != null), {
    message: 'Provide either option or text',
    path: ['answer'],
  });
export type AnswerRequest = z.infer<typeof AnswerRequest>;

/** `project=all` (default) or one visible project id (FR-025). */
export const ApprovalCenterQuery = z.object({
  project: z.union([z.literal('all'), Uuid]).default('all'),
});
export type ApprovalCenterQuery = z.infer<typeof ApprovalCenterQuery>;

export const DECISION_OUTCOMES = ['approved', 'rejected', 'answered'] as const;
export const DecisionOutcome = z.enum(DECISION_OUTCOMES);
export type DecisionOutcome = z.infer<typeof DecisionOutcome>;

/** The recorded outcome of a resolved item — also what a losing concurrent caller receives (FR-015). */
export const Resolution = z.object({
  outcome: DecisionOutcome,
  by: z.object({ id: Uuid.nullable(), name: z.string() }),
  at: IsoDateTime,
  answer: z.object({ option: z.string().nullable(), text: z.string() }).nullable(),
  reason: z.string().nullable(),
  target: RejectionTarget.nullable(),
  workflowState: WorkflowState,
});
export type Resolution = z.infer<typeof Resolution>;

/** 409 body when the item was already resolved by someone else. */
export const AlreadyResolvedProblem = Problem.extend({ resolution: Resolution });
export type AlreadyResolvedProblem = z.infer<typeof AlreadyResolvedProblem>;
