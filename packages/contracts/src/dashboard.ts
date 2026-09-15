import { z } from 'zod';
import { IsoDateTime, Uuid } from './common';
import { ACTIVE_CARD_LIMIT, SDLC_STAGES, WINDOW_KEYS } from './dashboard-model';
import { WorkflowState } from './vocabulary';

/** Time window for rate and event figures (specs/001 research R21). */
export const WindowKey = z.enum(WINDOW_KEYS);
export type WindowKey = z.infer<typeof WindowKey>;

export const DashboardQuery = z.object({
  project: z.union([z.literal('all'), Uuid]).default('all'),
  window: WindowKey.default('7d'),
});
export type DashboardQuery = z.infer<typeof DashboardQuery>;

export const Window = z.object({ key: WindowKey, from: IsoDateTime, to: IsoDateTime });
export type Window = z.infer<typeof Window>;

/** Relative link to the filtered list behind a figure (FR-023, research R25). */
export const Href = z.string().max(200).regex(/^\/(?!\/)/, { message: 'must start with /' });
export type Href = z.infer<typeof Href>;

const count = z.number().int().min(0);

export const Figure = z.object({ value: count, href: Href });
export type Figure = z.infer<typeof Figure>;

export const Rate = z
  .object({ numerator: count, denominator: count, href: Href })
  .refine((r) => r.numerator <= r.denominator, {
    message: 'numerator must be ≤ denominator',
    path: ['numerator'],
  });
export type Rate = z.infer<typeof Rate>;

export const SdlcStageName = z.enum(SDLC_STAGES);
export type SdlcStageName = z.infer<typeof SdlcStageName>;

const PIPELINE_STAGE_COUNT = SDLC_STAGES.length;

export const PipelineStage = z.object({
  stage: z.number().int().min(1).max(PIPELINE_STAGE_COUNT),
  name: SdlcStageName,
  count,
  href: Href,
});
export type PipelineStage = z.infer<typeof PipelineStage>;

export const DashboardCounts = z.object({
  activeWorkflows: Figure,
  runningAgents: Figure,
  prsGenerated: Figure,
  openFailures: Figure,
});
export type DashboardCounts = z.infer<typeof DashboardCounts>;

export const DashboardPipeline = z.object({
  stages: z.array(PipelineStage).length(PIPELINE_STAGE_COUNT),
  unstaged: Figure,
});
export type DashboardPipeline = z.infer<typeof DashboardPipeline>;

export const DashboardNeedsMe = z.object({
  approvals: Figure,
  clarifications: Figure,
  failed: Figure,
  blocked: Figure,
});
export type DashboardNeedsMe = z.infer<typeof DashboardNeedsMe>;

export const DashboardHealth = z.object({
  testPassRate: Rate,
  agentSuccessRate: Rate,
  humanInterventionRate: Rate,
});
export type DashboardHealth = z.infer<typeof DashboardHealth>;

/** Review findings arrive with User Story 6; until then the figure is an explicit "not connected" state (research R29). */
export const SecurityFindings = z.discriminatedUnion('connected', [
  z.object({ connected: z.literal(false), count: z.null(), href: Href }),
  z.object({ connected: z.literal(true), count, href: Href }),
]);
export type SecurityFindings = z.infer<typeof SecurityFindings>;

export const DashboardRisk = z.object({
  pendingHighCritical: Figure,
  auditHighCritical: Figure,
  securityFindings: SecurityFindings,
});
export type DashboardRisk = z.infer<typeof DashboardRisk>;

export const ActiveWorkflowCard = z.object({
  workflowId: Uuid,
  externalId: z.string(),
  title: z.string(),
  stage: z.object({
    index: z.number().int().min(1).nullable(),
    count: z.number().int().min(1),
    name: z.string().nullable(),
  }),
  progress: z.object({ done: count, total: z.number().int().min(1) }),
  agent: z.string().nullable(),
  elapsedMs: count.nullable(),
  state: WorkflowState,
  stateObservedAt: IsoDateTime,
  href: Href,
});
export type ActiveWorkflowCard = z.infer<typeof ActiveWorkflowCard>;

/** `GET /api/dashboard` response (specs/001 data-model.md §19). */
export const DashboardSnapshot = z.object({
  generatedAt: IsoDateTime,
  project: z.union([z.literal('all'), Uuid]),
  window: Window,
  counts: DashboardCounts,
  pipeline: DashboardPipeline,
  needsMe: DashboardNeedsMe,
  health: DashboardHealth,
  risk: DashboardRisk,
  activeWorkflows: z.array(ActiveWorkflowCard).max(ACTIVE_CARD_LIMIT),
  activeWorkflowsTotal: count,
});
export type DashboardSnapshot = z.infer<typeof DashboardSnapshot>;
