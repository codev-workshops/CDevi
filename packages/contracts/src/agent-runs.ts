/**
 * specs/001 US5 "Inspect an agent run and its decisions" — read model of `GET /agent-runs/{id}`
 * (FR-016 metadata + timeline, FR-017 decisions with policy outcome and evidence, FR-018 bounded
 * summaries only: `reason` is a ≤ 600-char line, never chain-of-thought).
 */
import { z } from 'zod';
import {
  CONFIDENCE_LEVELS,
  EVIDENCE_KINDS,
  POLICY_OUTCOMES,
  RUN_STEP_STATUSES,
} from './agent-run-model';
import { DecisionLink, ExternalId, IsoDateTime, line, Uuid } from './common';
import { RiskLevel, WorkflowState } from './vocabulary';
import { AgentRunEvent } from './workflow-detail';

export const ConfidenceLevel = z.enum(CONFIDENCE_LEVELS);
export type ConfidenceLevel = z.infer<typeof ConfidenceLevel>;

export const PolicyOutcome = z.enum(POLICY_OUTCOMES);
export type PolicyOutcome = z.infer<typeof PolicyOutcome>;

export const EvidenceKind = z.enum(EVIDENCE_KINDS);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

/**
 * Typed evidence behind a decision; `accessible:false` or no `href` renders "access restricted", never a broken link.
 * Strict (FR-018): an evidence item is a pointer, never a place to smuggle free-form reasoning.
 */
export const EvidenceRef = z
  .object({
    kind: EvidenceKind,
    label: line(200),
    href: DecisionLink.nullable().optional(),
    locator: line(200).nullable().optional(),
    accessible: z.boolean(),
  })
  .strict();
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const RunStepStatus = z.enum(RUN_STEP_STATUSES);
export type RunStepStatus = z.infer<typeof RunStepStatus>;

/** Runtime-provided structured progress (AS-3); rendered with `Stepper`, never a spinner. */
export const RunStep = z.object({
  label: line(120),
  status: RunStepStatus,
});
export type RunStep = z.infer<typeof RunStep>;

export const AgentDecision = z.object({
  id: Uuid,
  position: z.number().int().min(1).max(50),
  decidedAt: IsoDateTime,
  action: line(200),
  reason: line(600),
  confidence: ConfidenceLevel,
  policyOutcome: PolicyOutcome,
  policyRef: line(120).nullable().optional(),
  /** Optional in US5; mandatory from US8. */
  riskLevel: RiskLevel.nullable().optional(),
  evidence: z.array(EvidenceRef).max(20),
});
export type AgentDecision = z.infer<typeof AgentDecision>;

export const AgentRunDetail = z.object({
  id: Uuid,
  externalId: ExternalId,
  agent: z.string(),
  model: z.string().nullable(),
  state: WorkflowState,
  startedAt: IsoDateTime,
  finishedAt: IsoDateTime.nullable(),
  durationMs: z.number().int().min(0),
  summary: z.string().nullable(),
  workflow: z.object({ id: Uuid, externalId: ExternalId, title: z.string() }),
  stage: z.object({ position: z.number().int().min(1), name: z.string() }),
  steps: z.array(RunStep).max(20),
  timeline: z.array(AgentRunEvent).max(50),
  decisions: z.array(AgentDecision).max(50),
});
export type AgentRunDetail = z.infer<typeof AgentRunDetail>;

export const AgentRunIdParams = z.object({ id: Uuid });
export type AgentRunIdParams = z.infer<typeof AgentRunIdParams>;
