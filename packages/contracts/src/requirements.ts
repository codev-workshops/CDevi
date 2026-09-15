/**
 * User Story 4 — Requirements (specs/001 data-model.md §23–§26, research R31–R42).
 * Zod schemas for the requirement list, detail, create/submit/approve/reject routes.
 */
import { z } from 'zod';
import { ProjectRef } from './auth';
import { IsoDateTime, line, splitCsv, Uuid } from './common';
import { Href } from './dashboard';
import { REQUIREMENT_STATES } from './requirement-rules';
import { WorkflowState } from './vocabulary';

export const RequirementState = z.enum(REQUIREMENT_STATES);
export type RequirementState = z.infer<typeof RequirementState>;

export const RequirementSource = z.enum(['manual', 'jira']);
export type RequirementSource = z.infer<typeof RequirementSource>;

export const ExternalFlag = z.enum(['deleted', 'closed']);
export type ExternalFlag = z.infer<typeof ExternalFlag>;

export const AnalysisItemKind = z.enum(['acceptance_criterion', 'rule', 'open_question']);
export type AnalysisItemKind = z.infer<typeof AnalysisItemKind>;

export const TransitionActorType = z.enum(['user', 'agent', 'system']);
export type TransitionActorType = z.infer<typeof TransitionActorType>;

/** Jira issue keys: PROJECT-123 (upper-case project key). */
export const JiraIssueKey = z.string().regex(/^[A-Z][A-Z0-9_]+-\d+$/);

export const HttpsUrl = z.url().max(2000).startsWith('https://');

/** Link to the issue-tracker item a requirement came from (FR-008). */
export const ExternalRef = z.object({
  provider: z.literal('jira'),
  key: JiraIssueKey,
  url: HttpsUrl,
  updatedAt: IsoDateTime,
});
export type ExternalRef = z.infer<typeof ExternalRef>;

export const UserRef = z.object({ id: Uuid, name: z.string() });
export type UserRef = z.infer<typeof UserRef>;

export const StageProgress = z.object({
  index: z.number().int().min(1),
  count: z.number().int().min(1),
  name: z.string().nullable(),
});
export type StageProgress = z.infer<typeof StageProgress>;

/** The workflow created by approving the requirement (FR-010). */
export const LinkedWorkflow = z.object({
  id: Uuid,
  externalId: z.string(),
  state: WorkflowState,
  stage: StageProgress.nullable(),
  href: Href,
});
export type LinkedWorkflow = z.infer<typeof LinkedWorkflow>;

/** One row of the Requirements list (FR-007, FR-009). */
export const Requirement = z.object({
  id: Uuid,
  externalId: z.string(),
  project: ProjectRef,
  title: z.string(),
  state: RequirementState,
  source: RequirementSource,
  externalRef: ExternalRef.nullable(),
  externalFlag: ExternalFlag.nullable(),
  externalFlaggedAt: IsoDateTime.nullable(),
  assignee: UserRef.nullable(),
  createdBy: UserRef.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  openQuestionCount: z.number().int().min(0),
  workflow: LinkedWorkflow.nullable(),
  href: Href,
});
export type Requirement = z.infer<typeof Requirement>;

/** One analysis line; `aiGenerated` drives the visible AI label (FR-009). */
export const AnalysisItem = z.object({
  id: Uuid,
  kind: AnalysisItemKind,
  position: z.number().int().min(1).max(50),
  text: z.string(),
  aiGenerated: z.boolean(),
  source: z.string(),
});
export type AnalysisItem = z.infer<typeof AnalysisItem>;

export const RequirementAnalysis = z.object({
  observedAt: IsoDateTime,
  summary: z.string().nullable(),
  acceptanceCriteria: z.array(AnalysisItem).max(50),
  rules: z.array(AnalysisItem).max(50),
  openQuestions: z.array(AnalysisItem).max(20),
});
export type RequirementAnalysis = z.infer<typeof RequirementAnalysis>;

export const SubmitLabel = z.enum(['Submit for analysis', 'Resubmit for analysis']);

/** Role- and state-gated affordances computed by `requirementActions` (FR-032). */
export const RequirementActions = z.object({
  canSubmit: z.boolean(),
  canApprove: z.boolean(),
  canReject: z.boolean(),
  submitLabel: SubmitLabel,
  reasons: z.array(z.string()).max(8),
});
export type RequirementActions = z.infer<typeof RequirementActions>;

export const RequirementTransitionView = z.object({
  fromState: RequirementState.nullable(),
  toState: RequirementState,
  actorType: TransitionActorType,
  actorName: z.string().nullable(),
  reason: z.string().nullable(),
  occurredAt: IsoDateTime,
});
export type RequirementTransitionView = z.infer<typeof RequirementTransitionView>;

export const RequirementAuditRow = z.object({
  id: Uuid,
  action: z.string(),
  actorName: z.string().nullable(),
  reason: z.string().nullable(),
  riskLevel: z.string().nullable(),
  occurredAt: IsoDateTime,
});
export type RequirementAuditRow = z.infer<typeof RequirementAuditRow>;

export const RequirementDetail = z.object({
  requirement: Requirement,
  businessObjective: z.string(),
  analysis: RequirementAnalysis.nullable(),
  submittedBy: UserRef.nullable(),
  submittedAt: IsoDateTime.nullable(),
  decidedBy: UserRef.nullable(),
  decidedAt: IsoDateTime.nullable(),
  decisionReason: z.string().nullable(),
  actions: RequirementActions,
  transitions: z.array(RequirementTransitionView).max(50),
  audit: z.array(RequirementAuditRow).max(20),
  generatedAt: IsoDateTime,
});
export type RequirementDetail = z.infer<typeof RequirementDetail>;

const ProjectFilter = z.union([z.literal('all'), Uuid]).default('all');
export const AssigneeFilter = z.union([z.literal('me'), z.literal('unassigned'), Uuid]);
export type AssigneeFilter = z.infer<typeof AssigneeFilter>;

/** `GET /requirements?project=&state=&assignee=&cursor=` — page size is fixed at 50 (R38). */
export const RequirementListQuery = z.object({
  project: ProjectFilter,
  state: z.preprocess(splitCsv, z.array(RequirementState).max(8)).optional(),
  assignee: AssigneeFilter.optional(),
  cursor: z.string().max(200).optional(),
});
export type RequirementListQuery = z.infer<typeof RequirementListQuery>;

export const RequirementListPage = z.object({
  generatedAt: IsoDateTime,
  project: z.union([z.literal('all'), Uuid]),
  filters: z.object({
    state: z.array(RequirementState).max(8),
    assignee: AssigneeFilter.nullable(),
  }),
  items: z.array(Requirement).max(50),
  nextCursor: z.string().nullable(),
  total: z.number().int().min(0),
});
export type RequirementListPage = z.infer<typeof RequirementListPage>;

/** `POST /requirements` body (FR-007). */
export const CreateRequirementRequest = z.object({
  projectId: Uuid,
  title: line(200).min(3),
  businessObjective: z.string().trim().min(10).max(4000),
  acceptanceCriteria: z.array(line(1000)).max(20).default([]),
  assigneeUserId: Uuid.optional(),
});
export type CreateRequirementRequest = z.infer<typeof CreateRequirementRequest>;

/** `POST /requirements/{id}/reject` body (FR-032). */
export const RejectRequirementRequest = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectRequirementRequest = z.infer<typeof RejectRequirementRequest>;

export const RequirementIdParams = z.object({ id: Uuid });
export type RequirementIdParams = z.infer<typeof RequirementIdParams>;
