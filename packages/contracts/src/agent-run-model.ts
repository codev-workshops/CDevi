/**
 * Pure agent-run rules for specs/001 US5 "Inspect an agent run and its decisions" (FR-016…FR-018).
 * Zod-free and browser-safe (`@cdevi/contracts/agent-run-model`): the API composes the read model
 * from these and the web renders their results without re-deriving.
 */
import type { WorkflowState } from './vocabulary';

export const CONFIDENCE_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export const POLICY_OUTCOMES = ['ALLOWED', 'APPROVAL_REQUIRED', 'DENIED'] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

export const EVIDENCE_KINDS = ['file', 'ticket', 'artifact', 'url', 'pullRequest'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const RUN_STEP_STATUSES = ['completed', 'running', 'pending', 'failed'] as const;
export type RunStepStatus = (typeof RUN_STEP_STATUSES)[number];

/** A RUNNING or RETRYING run with no timeline activity for longer than this is shown as stale (edge case "run exceeds duration"). */
export const STALE_RUN_AFTER_MS = 30 * 60_000;

export const POLICY_OUTCOME_WORDS: Record<PolicyOutcome, string> = {
  ALLOWED: 'Allowed',
  APPROVAL_REQUIRED: 'Approval required',
  DENIED: 'Denied',
};

export const CONFIDENCE_WORDS: Record<ConfidenceLevel, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

export interface RunStepLike {
  label: string;
  status: RunStepStatus;
}

export interface EvidenceRefLike {
  kind: EvidenceKind;
  label: string;
  href?: string | null | undefined;
  locator?: string | null | undefined;
  accessible: boolean;
}

export interface RunFreshnessInput {
  state: WorkflowState;
  startedAt: Date | string;
  timeline: ReadonlyArray<{ at: Date | string }>;
}

export type RunFreshness = 'active' | 'stale';

export type StepsSummary = Record<RunStepStatus, number>;

const ms = (d: Date | string) => (typeof d === 'string' ? new Date(d) : d).getTime();

/** Elapsed run time: finished − started, or now − started while unfinished; never negative. */
export function runDuration(
  startedAt: Date | string,
  finishedAt: Date | string | null | undefined,
  now: Date,
): number {
  const end = finishedAt ? ms(finishedAt) : now.getTime();
  return Math.max(0, end - ms(startedAt));
}

/** `stale` when the run is RUNNING|RETRYING and its latest timeline event (or its start) is older than 30 minutes. */
export function runFreshness(run: RunFreshnessInput, now: Date): RunFreshness {
  if (run.state !== 'RUNNING' && run.state !== 'RETRYING') return 'active';
  let last = ms(run.startedAt);
  for (const e of run.timeline) last = Math.max(last, ms(e.at));
  return now.getTime() - last > STALE_RUN_AFTER_MS ? 'stale' : 'active';
}

export function stepsSummary(steps: ReadonlyArray<RunStepLike>): StepsSummary {
  const out: StepsSummary = { completed: 0, running: 0, pending: 0, failed: 0 };
  for (const s of steps) out[s.status]++;
  return out;
}

/** Link target for an evidence ref, or null when the viewer may not open it (rendered as "access restricted"). */
export function evidenceHref(ref: EvidenceRefLike): string | null {
  if (!ref.accessible || !ref.href) return null;
  return ref.href;
}

export const agentRunHref = (id: string): string => `/agents/runs/${id}`;

export const decisionAnchor = (position: number): string => `decision-${position}`;
