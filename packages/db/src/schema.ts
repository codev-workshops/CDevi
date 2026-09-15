/**
 * Drizzle schema mirroring migrations/0001_init.sql, 0002_workflow_detail.sql, 0003_approval_center.sql,
 * 0004_dashboard.sql (indexes only), 0005_requirements.sql, 0006_agent_decisions.sql, 0007_reviews.sql and
 * 0008_review_findings_position_deferrable.sql (constraint attribute only). The SQL files are the source of truth
 * for triggers, partial indexes, RLS and grants, which Drizzle does not model; this file gives queries types.
 */
import type {
  AgentRunEvent,
  ClarificationOption,
  DecisionLinks,
  EvidenceRef,
  ExternalRef,
  LaneResult,
  RunStep,
} from '@cdevi/contracts';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const uuidArray = customType<{ data: string[] }>({ dataType: () => 'uuid[]' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const workflowState = pgEnum('workflow_state', [
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'WAITING',
  'WAITING_FOR_HUMAN',
  'BLOCKED',
  'FAILED',
  'COMPLETED',
  'CANCELLED',
]);
export const riskLevel = pgEnum('risk_level', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const userRole = pgEnum('user_role', ['administrator', 'approver', 'engineer', 'viewer']);
export const approvalDecision = pgEnum('approval_decision', ['approved', 'rejected']);
export const ingestionOutcome = pgEnum('ingestion_outcome', [
  'accepted',
  'stale',
  'rejected',
  'forbidden',
]);
export const artifactType = pgEnum('artifact_type', [
  'requirement_spec',
  'impact_analysis',
  'implementation_plan',
  'test_results',
  'code_diff',
  'pull_request',
]);
export const testRunStatus = pgEnum('test_run_status', ['RUNNING', 'PASSED', 'FAILED']);
export const requirementState = pgEnum('requirement_state', [
  'DRAFT',
  'ANALYZING',
  'NEEDS_CLARIFICATION',
  'READY',
  'APPROVED',
  'IN_IMPLEMENTATION',
  'COMPLETED',
  'REJECTED',
]);
export const requirementSource = pgEnum('requirement_source', ['manual', 'jira']);
export const analysisItemKind = pgEnum('analysis_item_kind', [
  'acceptance_criterion',
  'rule',
  'open_question',
]);
export const externalFlag = pgEnum('external_flag', ['deleted', 'closed']);
export const confidenceLevel = pgEnum('confidence_level', ['LOW', 'MEDIUM', 'HIGH']);
export const policyOutcome = pgEnum('policy_outcome', ['ALLOWED', 'APPROVAL_REQUIRED', 'DENIED']);
export const reviewLane = pgEnum('review_lane', [
  'correctness',
  'security',
  'dependencies',
  'edge_cases',
  'testing',
  'architecture',
  'general',
]);
export const laneStatus = pgEnum('lane_status', ['PASS', 'WARN', 'FAIL']);
export const reviewStatus = pgEnum('review_status', ['RUNNING', 'COMPLETE', 'FAILED']);
export const findingSeverity = pgEnum('finding_severity', [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO',
]);
export const findingBlocking = pgEnum('finding_blocking', [
  'BLOCKING',
  'NON_BLOCKING',
  'SUGGESTION',
]);
export const findingState = pgEnum('finding_state', [
  'OPEN',
  'FIX_REQUESTED',
  'FIXED',
  'DISMISSED',
  'ISSUE_REQUESTED',
]);
export const reviewCycleState = pgEnum('review_cycle_state', [
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);
export const pullRequestStatus = pgEnum('pull_request_status', ['OPEN', 'MERGED', 'CLOSED']);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
  policySummary: text('policy_summary').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  key: text('key').notNull(),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  email: citext('email').notNull(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRole('role').notNull(),
  disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const projectMemberships = pgTable(
  'project_memberships',
  {
    userId: uuid('user_id').notNull(),
    projectId: uuid('project_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })],
);

export const sessions = pgTable('sessions', {
  idHash: bytea('id_hash').primaryKey(),
  userId: uuid('user_id').notNull(),
  organizationId: uuid('organization_id').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
});

export const ingestionPrincipals = pgTable('ingestion_principals', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  name: text('name').notNull(),
  tokenHash: bytea('token_hash').notNull().unique(),
  projectIds: uuidArray('project_ids').notNull(),
  disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const workflows = pgTable(
  'workflows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    agent: text('agent'),
    state: workflowState('state').notNull(),
    stateObservedAt: ts('state_observed_at').notNull(),
    stateReason: text('state_reason'),
    stageIndex: smallint('stage_index'),
    stageCount: smallint('stage_count').default(7),
    stageName: text('stage_name'),
    pullRequestRef: text('pull_request_ref'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    /** 0005: the requirement this workflow implements (one workflow per requirement); ON DELETE SET NULL. */
    requirementId: uuid('requirement_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workflows_requirement_idx')
      .on(t.requirementId)
      .where(sql`${t.requirementId} IS NOT NULL`),
    index('workflows_list_idx').on(t.organizationId, t.stateObservedAt.desc(), t.id.desc()),
  ],
);

export const workflowTransitions = pgTable('workflow_transitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  workflowId: uuid('workflow_id').notNull(),
  fromState: workflowState('from_state'),
  toState: workflowState('to_state').notNull(),
  observedAt: ts('observed_at').notNull(),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
  reason: text('reason'),
  principalId: uuid('principal_id'),
  stageId: uuid('stage_id'),
  userId: uuid('user_id'),
});

export const workflowStages = pgTable('workflow_stages', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id').notNull(),
  workflowId: uuid('workflow_id').notNull(),
  position: smallint('position').notNull(),
  name: text('name').notNull(),
  state: workflowState('state').notNull(),
  stateObservedAt: ts('state_observed_at').notNull(),
  stateReason: text('state_reason'),
  agent: text('agent'),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
  errorSummary: text('error_summary'),
  requiresApproval: boolean('requires_approval').notNull().default(false),
  approvalId: uuid('approval_id'),
  clarificationId: uuid('clarification_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    externalId: text('external_id').notNull(),
    agent: text('agent').notNull(),
    model: text('model'),
    state: workflowState('state').notNull(),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    summary: text('summary'),
    timeline: jsonb('timeline').$type<AgentRunEvent[]>().notNull().default([]),
    /** 0006: runtime-provided structured progress, ≤ 20 steps (US5 AS-3). */
    steps: jsonb('steps').$type<RunStep[]>().notNull().default([]),
    /** 0006: observedAt watermark of the last accepted decisions replacement; NULL until the first batch. */
    decisionsObservedAt: ts('decisions_observed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('agent_runs_org_project_finished_idx')
      .on(t.organizationId, t.projectId, t.finishedAt)
      .where(sql`${t.finishedAt} IS NOT NULL`),
  ],
);

export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id').notNull(),
  workflowId: uuid('workflow_id').notNull(),
  stageId: uuid('stage_id').notNull(),
  externalId: text('external_id').notNull(),
  type: artifactType('type').notNull(),
  title: text('title').notNull(),
  href: text('href'),
  summary: text('summary'),
  producedAt: ts('produced_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const testRuns = pgTable(
  'test_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    externalId: text('external_id').notNull(),
    category: text('category').notNull(),
    status: testRunStatus('status').notNull(),
    total: integer('total').notNull().default(0),
    passed: integer('passed').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    href: text('href'),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('test_runs_org_project_finished_idx')
      .on(t.organizationId, t.projectId, t.finishedAt)
      .where(sql`${t.finishedAt} IS NOT NULL`),
  ],
);

export const approvals = pgTable(
  'approvals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    externalId: text('external_id').notNull(),
    ask: text('ask').notNull(),
    riskLevel: riskLevel('risk_level').notNull(),
    requestedByAgent: text('requested_by_agent'),
    requestedAt: ts('requested_at').notNull(),
    expiresAt: ts('expires_at'),
    decision: approvalDecision('decision'),
    decidedAt: ts('decided_at'),
    decidedBy: text('decided_by'),
    context: text('context'),
    links: jsonb('links').$type<DecisionLinks>().notNull().default({}),
    rejectionReason: text('rejection_reason'),
    rejectionTarget: workflowState('rejection_target'),
    decidedByUserId: uuid('decided_by_user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('approvals_workflow_idx').on(t.workflowId)],
);

export const clarifications = pgTable(
  'clarifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    externalId: text('external_id').notNull(),
    question: text('question').notNull(),
    requestedByAgent: text('requested_by_agent'),
    requestedAt: ts('requested_at').notNull(),
    hasRecommendedAnswer: boolean('has_recommended_answer').notNull().default(false),
    answeredAt: ts('answered_at'),
    answeredBy: text('answered_by'),
    whyItMatters: text('why_it_matters'),
    options: jsonb('options').$type<ClarificationOption[]>().notNull().default([]),
    links: jsonb('links').$type<DecisionLinks>().notNull().default({}),
    answerOption: text('answer_option'),
    answerText: text('answer_text'),
    answeredByUserId: uuid('answered_by_user_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('clarifications_workflow_idx').on(t.workflowId)],
);

export const ingestionLog = pgTable('ingestion_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  principalId: uuid('principal_id'),
  receivedAt: ts('received_at').notNull().defaultNow(),
  route: text('route').notNull(),
  targetExternalId: text('target_external_id'),
  outcome: ingestionOutcome('outcome').notNull(),
  detail: text('detail'),
});

/** One of workflowId / requirementId is set (inbox_change_log_target_check, 0005). */
export const inboxChangeLog = pgTable('inbox_change_log', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id').notNull(),
  workflowId: uuid('workflow_id'),
  requirementId: uuid('requirement_id'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});

/** Append-only audit trail of human decisions (0003_approval_center.sql; FR-029). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id'),
    workflowId: uuid('workflow_id'),
    actorType: text('actor_type').$type<'user' | 'agent' | 'system'>().notNull(),
    actorId: text('actor_id'),
    actorName: text('actor_name').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    riskLevel: riskLevel('risk_level'),
    policy: text('policy'),
    result: text('result').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_events_org_risk_time_idx')
      .on(t.organizationId, t.projectId, t.occurredAt.desc())
      .where(sql`${t.riskLevel} IN ('HIGH','CRITICAL')`),
  ],
);
export type AuditEvent = typeof auditEvents.$inferSelect;

/** Jira project key → CDevi project (0005_requirements.sql §22.1; app_user is SELECT-only). */
export const integrationProjectMappings = pgTable('integration_project_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id').notNull(),
  provider: text('provider').$type<'jira'>().notNull(),
  externalProjectKey: text('external_project_key').notNull(),
  externalBaseUrl: text('external_base_url').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Requirements (0005_requirements.sql §22.2; FR-007..FR-010). */
export const requirements = pgTable(
  'requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    businessObjective: text('business_objective').notNull(),
    state: requirementState('state').notNull().default('DRAFT'),
    source: requirementSource('source').notNull().default('manual'),
    externalRef: jsonb('external_ref').$type<ExternalRef>(),
    externalFlag: externalFlag('external_flag'),
    externalFlaggedAt: ts('external_flagged_at'),
    createdByUserId: uuid('created_by_user_id'),
    assigneeUserId: uuid('assignee_user_id'),
    submittedByUserId: uuid('submitted_by_user_id'),
    submittedAt: ts('submitted_at'),
    analysisObservedAt: ts('analysis_observed_at'),
    analysisAgent: text('analysis_agent'),
    analysisSummary: text('analysis_summary'),
    approvedByUserId: uuid('approved_by_user_id'),
    approvedAt: ts('approved_at'),
    rejectedByUserId: uuid('rejected_by_user_id'),
    rejectedAt: ts('rejected_at'),
    rejectionReason: text('rejection_reason'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('requirements_jira_key_idx')
      .on(t.organizationId, sql`(${t.externalRef}->>'key')`)
      .where(sql`${t.source} = 'jira'`),
    index('requirements_list_idx').on(
      t.organizationId,
      t.projectId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    index('requirements_state_idx').on(t.organizationId, t.state, t.createdAt.desc(), t.id.desc()),
    index('requirements_assignee_idx')
      .on(t.organizationId, t.assigneeUserId, t.createdAt.desc(), t.id.desc())
      .where(sql`${t.assigneeUserId} IS NOT NULL`),
  ],
);
export type RequirementRow = typeof requirements.$inferSelect;

/**
 * Acceptance criteria, AI-identified rules and open questions (0005 §22.3). Human-authored and AI-generated
 * items have disjoint position spaces: UNIQUE (requirement_id, kind, ai_generated, position).
 */
export const requirementAnalysisItems = pgTable(
  'requirement_analysis_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    requirementId: uuid('requirement_id').notNull(),
    kind: analysisItemKind('kind').notNull(),
    position: smallint('position').notNull(),
    text: text('text').notNull(),
    aiGenerated: boolean('ai_generated').notNull(),
    /** 'user:<display name>' | 'agent:<agent>' */
    source: text('source').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('requirement_analysis_items_req_idx').on(
      t.requirementId,
      t.kind,
      t.aiGenerated,
      t.position,
    ),
  ],
);
export type RequirementAnalysisItemRow = typeof requirementAnalysisItems.$inferSelect;

/** Append-only requirement state history (0005 §22.4); UPDATE/DELETE raise. */
export const requirementTransitions = pgTable(
  'requirement_transitions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    organizationId: uuid('organization_id').notNull(),
    requirementId: uuid('requirement_id').notNull(),
    fromState: requirementState('from_state'),
    toState: requirementState('to_state').notNull(),
    actorType: text('actor_type').$type<'user' | 'agent' | 'system'>().notNull(),
    actorId: text('actor_id'),
    actorName: text('actor_name').notNull(),
    reason: text('reason'),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [index('requirement_transitions_req_idx').on(t.requirementId, t.occurredAt)],
);
export type RequirementTransitionRow = typeof requirementTransitions.$inferSelect;

/**
 * Decisions reported by the runtime for one agent run (0006_agent_decisions.sql §33; FR-017, FR-018).
 * Replaced whole per ingest call (DELETE + INSERT, app_user has no UPDATE); `reason` is a bounded summary.
 * risk_level is optional in US5 (mandatory with US8).
 */
export const agentDecisions = pgTable(
  'agent_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    stageId: uuid('stage_id').notNull(),
    agentRunId: uuid('agent_run_id').notNull(),
    position: smallint('position').notNull(),
    decidedAt: ts('decided_at').notNull(),
    action: text('action').notNull(),
    reason: text('reason').notNull(),
    confidence: confidenceLevel('confidence').notNull(),
    policyOutcome: policyOutcome('policy_outcome').notNull(),
    policyRef: text('policy_ref'),
    riskLevel: riskLevel('risk_level'),
    evidence: jsonb('evidence').$type<EvidenceRef[]>().notNull().default([]),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_decisions_run_position_key').on(t.agentRunId, t.position),
    index('agent_decisions_run_idx').on(t.agentRunId, t.position),
  ],
);
export type AgentDecisionRow = typeof agentDecisions.$inferSelect;

/**
 * Pull request of a workflow (0007_reviews.sql; US6). One per workflow in the MVP (workflow_id UNIQUE);
 * observed_at is the ingest watermark. readyForMerge is derived from review_findings, never stored.
 */
export const pullRequests = pgTable(
  'pull_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    requirementId: uuid('requirement_id'),
    reviewStageId: uuid('review_stage_id'),
    externalId: text('external_id').notNull(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    href: text('href').notNull(),
    status: pullRequestStatus('status').notNull().default('OPEN'),
    observedAt: ts('observed_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pull_requests_workflow_id_key').on(t.workflowId),
    uniqueIndex('pull_requests_organization_id_external_id_key').on(t.organizationId, t.externalId),
    index('pull_requests_list_idx').on(t.organizationId, t.projectId, t.updatedAt, t.id),
    index('pull_requests_requirement_idx')
      .on(t.requirementId)
      .where(sql`${t.requirementId} IS NOT NULL`),
  ],
);
export type PullRequestRow = typeof pullRequests.$inferSelect;

/**
 * Fix-loop history of a pull request (0007; AS-4). Created by Apply Fix (RUNNING, iteration n+1) or reported by
 * the runtime; fixed_count + remaining_count ≤ findings_count and iteration ≤ max_iterations (default 5).
 */
export const reviewCycles = pgTable(
  'review_cycles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    pullRequestId: uuid('pull_request_id').notNull(),
    cycleNumber: integer('cycle_number').notNull(),
    findingsCount: integer('findings_count').notNull(),
    fixedCount: integer('fixed_count').notNull().default(0),
    remainingCount: integer('remaining_count').notNull(),
    iteration: integer('iteration').notNull(),
    maxIterations: integer('max_iterations').notNull().default(5),
    state: reviewCycleState('state').notNull().default('RUNNING'),
    requestedByUserId: uuid('requested_by_user_id'),
    requestedByAgent: text('requested_by_agent'),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    agentRunId: uuid('agent_run_id'),
    observedAt: ts('observed_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('review_cycles_pull_request_id_cycle_number_key').on(
      t.pullRequestId,
      t.cycleNumber,
    ),
    index('review_cycles_pr_idx').on(t.pullRequestId, t.cycleNumber),
    uniqueIndex('review_cycles_one_running_idx')
      .on(t.pullRequestId)
      .where(sql`${t.state} = 'RUNNING'`),
  ],
);
export type ReviewCycleRow = typeof reviewCycles.$inferSelect;

/**
 * One AI review per (pull request, cycle) (0007; FR-020). `lanes` is exactly seven typed LaneResult entries;
 * observed_at is the replace-whole watermark of PUT /ingest/pull-requests/{externalId}/reviews/{cycle}.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    pullRequestId: uuid('pull_request_id').notNull(),
    externalId: text('external_id').notNull(),
    cycleNumber: integer('cycle_number').notNull(),
    status: reviewStatus('status').notNull().default('RUNNING'),
    lanes: jsonb('lanes').$type<LaneResult[]>().notNull(),
    observedAt: ts('observed_at').notNull(),
    startedAt: ts('started_at').notNull(),
    finishedAt: ts('finished_at'),
    agentRunId: uuid('agent_run_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('reviews_pull_request_id_cycle_number_key').on(t.pullRequestId, t.cycleNumber),
    uniqueIndex('reviews_organization_id_external_id_key').on(t.organizationId, t.externalId),
    index('reviews_pr_idx').on(t.pullRequestId, t.cycleNumber),
  ],
);
export type ReviewRow = typeof reviews.$inferSelect;

/**
 * Findings of a review (0007; FR-020, FR-021). Reconciled by (review_id, external_id) by the review ingest — matched
 * rows keep their id, absent rows are deleted; UNIQUE (review_id, position) is DEFERRABLE since 0008 so positions
 * can be reordered in place. Human actions move `state` OPEN → DISMISSED | FIX_REQUESTED | ISSUE_REQUESTED in place.
 * Bounded summaries only (FR-018); evidence ≤ 10.
 */
export const reviewFindings = pgTable(
  'review_findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    workflowId: uuid('workflow_id').notNull(),
    pullRequestId: uuid('pull_request_id').notNull(),
    reviewId: uuid('review_id').notNull(),
    externalId: text('external_id').notNull(),
    position: smallint('position').notNull(),
    lane: reviewLane('lane').notNull(),
    severity: findingSeverity('severity').notNull(),
    blocking: findingBlocking('blocking').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    impact: text('impact').notNull(),
    evidence: jsonb('evidence').$type<EvidenceRef[]>().notNull().default([]),
    recommendedFix: text('recommended_fix').notNull(),
    state: findingState('state').notNull().default('OPEN'),
    dismissedReason: text('dismissed_reason'),
    dismissedByUserId: uuid('dismissed_by_user_id'),
    dismissedAt: ts('dismissed_at'),
    fixCycleId: uuid('fix_cycle_id'),
    issueRequestedByUserId: uuid('issue_requested_by_user_id'),
    issueRequestedAt: ts('issue_requested_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('review_findings_review_id_position_key').on(t.reviewId, t.position),
    uniqueIndex('review_findings_review_id_external_id_key').on(t.reviewId, t.externalId),
    index('review_findings_review_idx').on(t.reviewId, t.position),
    index('review_findings_pr_idx').on(t.pullRequestId, t.position),
    index('review_findings_blocking_open_idx')
      .on(t.pullRequestId)
      .where(sql`${t.blocking} = 'BLOCKING' AND ${t.state} IN ('OPEN', 'FIX_REQUESTED')`),
  ],
);
export type ReviewFindingRow = typeof reviewFindings.$inferSelect;
