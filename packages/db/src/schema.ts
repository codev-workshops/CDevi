/**
 * Drizzle schema mirroring migrations/0001_init.sql (data-model.md §2). The SQL file is the source of truth
 * for triggers, partial indexes, RLS and grants, which Drizzle does not model; this file gives queries types.
 */
import {
  bigserial,
  boolean,
  customType,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
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

export const workflows = pgTable('workflows', {
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
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

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
});

export const approvals = pgTable('approvals', {
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
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const clarifications = pgTable('clarifications', {
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
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

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

export const inboxChangeLog = pgTable('inbox_change_log', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  projectId: uuid('project_id').notNull(),
  workflowId: uuid('workflow_id').notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});
