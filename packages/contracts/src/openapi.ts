import { z, type ZodType } from 'zod';
import { Me, SignInRequest } from './auth';
import { Problem } from './common';
import { InboxSnapshot, RecordView } from './inbox';
import {
  AgentDecisionIngest,
  AgentDecisionsIngest,
  AgentDecisionsIngestResult,
  AgentRunUpsert,
  ApprovalUpsert,
  ArtifactUpsert,
  ClarificationUpsert,
  IngestResult,
  StageUpsert,
  TestRunUpsert,
  Transition,
  WorkflowUpsert,
  RequirementAnalysisIngest,
  RequirementIngestResult,
} from './ingest';
import {
  StageAgentRunRef,
  WorkflowActionRequest,
  WorkflowDetail,
  WorkflowPullRequestView,
} from './workflow-detail';
import {
  AgentDecision,
  AgentRunDetail,
  ConfidenceLevel,
  EvidenceRef,
  PolicyOutcome,
  RunStep,
} from './agent-runs';
import { STALE_RUN_AFTER_MS } from './agent-run-model';
import { AlreadyResolvedProblem, AnswerRequest, ApproveRequest, RejectRequest } from './decisions';
import { ApprovalCenterDetail, ApprovalCenterSnapshot, DecisionResult } from './approval-center';
import {
  ActiveWorkflowCard,
  DashboardCounts,
  DashboardHealth,
  DashboardNeedsMe,
  DashboardPipeline,
  DashboardQuery,
  DashboardRisk,
  DashboardSnapshot,
  Figure,
  PipelineStage,
  Rate,
  SecurityFindings,
  Window,
} from './dashboard';
import { ACTIVE_CARD_LIMIT, WINDOW_KEYS } from './dashboard-model';
import {
  CreateRequirementRequest,
  RejectRequirementRequest,
  Requirement,
  RequirementDetail,
  RequirementListPage,
  RequirementListQuery,
  RequirementState,
} from './requirements';
import {
  REQUIREMENT_STATES,
  REQUIREMENTS_PAGE_SIZE,
  WORKFLOWS_PAGE_SIZE,
} from './requirement-rules';
import { WorkflowListItem, WorkflowListPage, WorkflowListQuery } from './workflow-list';
import { JiraWebhookEvent, JiraWebhookResult } from './integrations';
import { WORKFLOW_STATES } from './vocabulary';
import {
  ApplyFixBody,
  CreateIssueBody,
  DismissFindingBody,
  FindingActionResult,
  FindingBlocking,
  FindingSeverity,
  FindingState,
  LaneResult,
  LaneStatus,
  PullRequestIngest,
  PullRequestReviewView,
  PullRequestStatus,
  ReviewCycleIngest,
  ReviewCycleState,
  ReviewCycleView,
  ReviewFindingIngest,
  ReviewFindingView,
  ReviewIngest,
  ReviewLane,
  ReviewListItem,
  ReviewListQuery,
  ReviewListResponse,
  ReviewStatus,
} from './reviews';

type Json = Record<string, unknown>;

const schema = (t: ZodType): Json => {
  const js = z.toJSONSchema(t, {
    target: 'openapi-3.0',
    io: 'input',
    unrepresentable: 'any',
  }) as Json;
  delete js['$schema'];
  return js;
};

const problem = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } },
});
const json = (ref: string, description?: string) => ({
  ...(description ? { description } : {}),
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
});
const externalId = {
  name: 'externalId',
  in: 'path',
  required: true,
  schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{1,128}$' },
};
const ingestErrors = {
  '400': problem('Invalid body'),
  '401': problem('Unknown or disabled principal'),
  '403': problem('Project outside the principal scope'),
  '404': problem('Unknown project or workflow'),
};

const workflowId = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};

const alreadyResolved = {
  description:
    'Already resolved by someone else (urn:cdevi:problem:already-resolved, body carries the recorded resolution) or the workflow is no longer WAITING_FOR_HUMAN (urn:cdevi:problem:invalid-transition)',
  content: {
    'application/problem+json': {
      schema: {
        oneOf: [
          { $ref: '#/components/schemas/AlreadyResolvedProblem' },
          { $ref: '#/components/schemas/Problem' },
        ],
      },
    },
  },
};
const decisionErrors = {
  '401': problem('Not signed in'),
  '403': problem('Only approvers and administrators may decide (FR-032)'),
  '404': problem('Not found or not visible'),
  '409': alreadyResolved,
};

const projectQuery = {
  name: 'project',
  in: 'query',
  required: false,
  schema: {
    oneOf: [{ const: 'all' }, { type: 'string', format: 'uuid' }],
    default: 'all',
  },
};

const cursorQuery = {
  name: 'cursor',
  in: 'query',
  required: false,
  schema: { type: 'string', maxLength: 200 },
  description: 'Opaque keyset cursor from the previous page (nextCursor)',
};
const csvQuery = (name: string, values: readonly string[]) => ({
  name,
  in: 'query',
  required: false,
  schema: { type: 'string' },
  description: `Comma-separated subset of ${values.join('|')}`,
});
const requirementId = { ...workflowId, description: 'Requirement id' };
const pullRequestId = { ...workflowId, name: 'pullRequestId', description: 'Pull request id' };
const findingId = { ...workflowId, name: 'findingId', description: 'Finding id' };
const cycleNumber = {
  name: 'cycle',
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
  description: 'Review / fix cycle number (1-based, per pull request)',
};
const findingActionErrors = {
  '400': problem('Invalid body (unknown key, missing or over-long reason)'),
  '401': problem('Not signed in'),
  '403': problem('Viewers are read-only (FR-032)'),
  '404': problem('Pull request or finding not found or not visible'),
  '409': problem(
    'Finding is not OPEN (already dismissed, fixed, fix requested or issue requested) — urn:cdevi:problem:invalid-transition',
  ),
};
const requirementSessionErrors = {
  '401': problem('Not signed in'),
  '403': problem('Role may not perform this action (FR-032)'),
  '404': problem('Not found or not visible'),
  '409': problem(
    'Transition not legal in the current state (urn:cdevi:problem:invalid-transition)',
  ),
};

/**
 * specs/001 US1–US6 fragment: Workflow Detail read + actions, the stage/run/artifact/test-run ingestion routes,
 * the Approval Center, the Dashboard, the Requirements routes, the runtime analysis ingest, the inbound Jira webhook,
 * the bounded workflow list, the Agent Run detail with its decisions ingest, and the Review Center (pull requests,
 * findings, fix cycles) with its three ingestion routes. `specs/001-sdlc-control-plane-mvp/contracts/openapi.yaml` is a snapshot of this.
 */
export function buildWorkflowDetailOpenApi(): Json {
  return {
    openapi: '3.1.0',
    info: {
      title:
        'CDevi API — Workflow Detail, Approval Center, Dashboard, Requirements, Agent Runs and Pull Request Reviews (specs/001 US1–US6)',
      version: '0.6.0',
      description:
        'Generated from Zod schemas in packages/contracts (`pnpm -F @cdevi/contracts openapi`) and snapshot-tested; edit the schemas, not the yaml. Extends the specs/003 document: same session cookie, Bearer ingestion tokens, Problem errors. Live updates reuse GET /inbox/stream — the client filters inbox.changed frames by workflowId (Dashboard: refetch on any frame, coalesced). Human decisions (approve, reject, answer) are a separate path from agent ingestion: session user, approver/administrator only, exactly once. The Dashboard is a read model over existing tables: every figure carries the href of the filtered list behind it. Requirements (US4): analysis is produced by the agent runtime and delivered through PUT /ingest/requirements/{externalId}/analysis; Jira is inbound-only through the signed webhook. Agent runs (US5): GET /agent-runs/{id} is read-only for every role; decisions are delivered whole by the runtime through PUT /ingest/agent-runs/{externalId}/decisions with a strict schema that carries bounded summaries only (FR-018) — no free-form reasoning field is accepted. Pull request reviews (US6): the runtime reports the pull request, each review (seven lanes, ≤ 50 findings) and each fix cycle through PUT /ingest/pull-requests/{externalId}[/reviews/{cycle}|/cycles/{cycle}] — strict, no reasoning field; humans dismiss a finding, apply a fix or request an issue through POST /reviews/{pullRequestId}/findings/{findingId}/{dismiss|fix|issue} (engineer, approver, administrator; every action writes audit_events, ingestion never does). readyForMerge is derived (FR-022): no BLOCKING finding OPEN or FIX_REQUESTED.',
    },
    servers: [{ url: '/api' }],
    tags: [
      { name: 'workflows' },
      { name: 'ingest' },
      { name: 'approvals' },
      { name: 'dashboard' },
      { name: 'requirements' },
      { name: 'integrations' },
      { name: 'agent-runs' },
      { name: 'reviews' },
    ],
    paths: {
      '/workflows/{id}': {
        get: {
          tags: ['workflows'],
          summary: 'Workflow Detail read model (FR-001, FR-003…FR-006, FR-033)',
          description:
            'Ordered stages, current-stage detail, activity (≤ 200), artifacts (≤ 100), test runs (≤ 50), attention, failure and role-gated actions. Not visible and unknown both return 404.',
          security: [{ sessionCookie: [] }],
          parameters: [workflowId],
          responses: {
            '200': {
              ...json('WorkflowDetail'),
              headers: {
                'Server-Timing': { schema: { type: 'string' }, description: 'detail;dur=…' },
              },
            },
            '400': problem('Invalid id'),
            '401': problem('Not signed in'),
            '404': problem('Not found or not visible (403 and 404 are indistinguishable)'),
          },
        },
      },
      '/workflows/{id}/actions': {
        post: {
          tags: ['workflows'],
          summary: 'Retry, escalate or cancel a workflow (FR-006)',
          description:
            'retry/cancel: engineer or administrator; escalate: engineer, approver or administrator. retry requires FAILED; cancel requires a non-terminal state; escalate requires FAILED, BLOCKED or WAITING_FOR_HUMAN. Returns the refreshed detail.',
          security: [{ sessionCookie: [] }],
          parameters: [workflowId],
          requestBody: { required: true, ...json('WorkflowActionRequest') },
          responses: {
            '200': json('WorkflowDetail'),
            '400': problem('Invalid body'),
            '401': problem('Not signed in'),
            '403': problem('Role may not perform this action'),
            '404': problem('Not found or not visible'),
            '409': problem('Action not legal in the current state'),
          },
        },
      },
      '/ingest/workflows/{externalId}/stages/{position}': {
        put: {
          tags: ['ingest'],
          summary: 'Create or transition a workflow stage (FR-002, FR-034)',
          description:
            'Stale when observedAt is not newer than the stage state. Updates workflows.stage_index/stage_name when the stage is current. Links an approval or clarification by external id.',
          security: [{ ingestionToken: [] }],
          parameters: [
            externalId,
            {
              name: 'position',
              in: 'path',
              required: true,
              schema: { type: 'integer', minimum: 1, maximum: 20 },
            },
          ],
          requestBody: { required: true, ...json('StageUpsert') },
          responses: {
            '200': json('IngestResult'),
            ...ingestErrors,
            '409': problem('Illegal transition for the current stage state'),
          },
        },
      },
      '/ingest/agent-runs/{externalId}': {
        put: {
          tags: ['ingest'],
          summary: 'Create or update an agent run with its bounded timeline (FR-016, FR-018)',
          security: [{ ingestionToken: [] }],
          parameters: [externalId],
          requestBody: { required: true, ...json('AgentRunUpsert') },
          responses: { '200': json('IngestResult'), ...ingestErrors },
        },
      },
      '/ingest/agent-runs/{externalId}/decisions': {
        put: {
          tags: ['ingest'],
          summary:
            'Runtime replaces the decisions of an agent run as a whole (FR-017, FR-018, FR-036)',
          description:
            'Bearer ingestion principal scoped to the run project. Replaces every decision of the run (≤ 50, positions 1..50 unique, ≤ 20 typed evidence refs each). The body is strict: `reason` is a ≤ 600-character summary and any other reasoning field (chainOfThought, reasoning, thoughts, …) is a 400. `stale` when observedAt is not newer than the stored watermark (nothing written). One ingestion_log row and one inbox_changed notification per call.',
          security: [{ ingestionToken: [] }],
          parameters: [externalId],
          requestBody: { required: true, ...json('AgentDecisionsIngest') },
          responses: {
            '200': json('AgentDecisionsIngestResult'),
            '400': problem('Invalid body (unknown key, bound exceeded, duplicate position)'),
            '401': problem('Unknown or disabled principal'),
            '403': problem('Project outside the principal scope'),
            '404': problem('Unknown agent run externalId'),
            '409': problem(
              'Agent run is not accepting decisions (concurrent replacement in progress)',
            ),
          },
        },
      },
      '/ingest/artifacts/{externalId}': {
        put: {
          tags: ['ingest'],
          summary: 'Create or update an artifact; immutable once its stage completed (FR-004)',
          security: [{ ingestionToken: [] }],
          parameters: [externalId],
          requestBody: { required: true, ...json('ArtifactUpsert') },
          responses: {
            '200': json('IngestResult'),
            ...ingestErrors,
            '409': problem('Artifact is immutable: its producing stage has completed'),
          },
        },
      },
      '/ingest/test-runs/{externalId}': {
        put: {
          tags: ['ingest'],
          summary: 'Create or update a test-run summary (FR-019)',
          security: [{ ingestionToken: [] }],
          parameters: [externalId],
          requestBody: { required: true, ...json('TestRunUpsert') },
          responses: { '200': json('IngestResult'), ...ingestErrors },
        },
      },
      '/approvals': {
        get: {
          tags: ['approvals'],
          summary: 'Approval Center list: pending approvals and clarifications (FR-011, FR-025)',
          description:
            'Items whose workflow is WAITING_FOR_HUMAN and that are not yet decided/answered, across the visible projects (administrators: all; others: memberships) or one project. Ordered highest risk first, then oldest; clarifications after every approval. Bounded to 200.',
          security: [{ sessionCookie: [] }],
          parameters: [projectQuery],
          responses: {
            '200': {
              ...json('ApprovalCenterSnapshot'),
              headers: {
                'Server-Timing': { schema: { type: 'string' }, description: 'approvals;dur=…' },
              },
            },
            '400': problem('Invalid query'),
            '401': problem('Not signed in'),
          },
        },
      },
      '/approvals/{id}': {
        get: {
          tags: ['approvals'],
          summary:
            'Approval or clarification detail with context, links, resolution and audit (FR-012, FR-014, FR-029)',
          description:
            'id is an approval id or a clarification id. canDecide reflects the caller role; resolution is null while pending. Not visible and unknown both return 404.',
          security: [{ sessionCookie: [] }],
          parameters: [workflowId],
          responses: {
            '200': json('ApprovalCenterDetail'),
            '400': problem('Invalid id'),
            '401': problem('Not signed in'),
            '404': problem('Not found or not visible'),
          },
        },
      },
      '/approvals/{id}/approve': {
        post: {
          tags: ['approvals'],
          summary: 'Approve an approval; workflow resumes to RUNNING (FR-012, FR-013, FR-015)',
          description:
            'HIGH and CRITICAL require confirmed=true (400 validation with path confirmed otherwise). Locks the row (SELECT … FOR UPDATE): the first writer wins and a later caller receives 409 with the recorded resolution. Writes decision, workflow transition, audit event and the inbox change notification in one transaction.',
          security: [{ sessionCookie: [] }],
          parameters: [workflowId],
          requestBody: { required: true, ...json('ApproveRequest') },
          responses: {
            '200': json('DecisionResult'),
            '400': problem('Invalid body or missing confirmation'),
            ...decisionErrors,
          },
        },
      },
      '/approvals/{id}/reject': {
        post: {
          tags: ['approvals'],
          summary:
            'Reject an approval with a reason; workflow moves to BLOCKED or CANCELLED (FR-013, FR-015)',
          security: [{ sessionCookie: [] }],
          parameters: [workflowId],
          requestBody: { required: true, ...json('RejectRequest') },
          responses: {
            '200': json('DecisionResult'),
            '400': problem('Invalid body (reason required, target BLOCKED|CANCELLED)'),
            ...decisionErrors,
          },
        },
      },
      '/clarifications/{id}/answer': {
        post: {
          tags: ['approvals'],
          summary:
            'Answer a clarification with a suggested option or free text; workflow resumes (FR-014, FR-015)',
          security: [{ sessionCookie: [] }],
          parameters: [workflowId],
          requestBody: { required: true, ...json('AnswerRequest') },
          responses: {
            '200': json('DecisionResult'),
            '400': problem('Invalid body (exactly one of option/text; option must be offered)'),
            ...decisionErrors,
          },
        },
      },
      '/dashboard': {
        get: {
          tags: ['dashboard'],
          summary:
            'Dashboard snapshot: counts, pipeline, needs-me, health, risk, active workflows (FR-023, FR-025, FR-026)',
          description: `Read model over the visible projects (administrators: all; others: memberships) or one project. Point-in-time counts and the pipeline use the current state; rates, PRs generated and HIGH/CRITICAL audit events use the window (${WINDOW_KEYS.join('|')}, default 7d). Every figure carries the href of the filtered list behind it. activeWorkflows is bounded to ${ACTIVE_CARD_LIMIT} cards (activeWorkflowsTotal carries the full count). securityFindings is connected:false until review findings exist (US6).`,
          security: [{ sessionCookie: [] }],
          parameters: [
            projectQuery,
            {
              name: 'window',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: [...WINDOW_KEYS], default: '7d' },
            },
          ],
          responses: {
            '200': {
              ...json('DashboardSnapshot'),
              headers: {
                'Server-Timing': { schema: { type: 'string' }, description: 'dashboard;dur=…' },
              },
            },
            '400': problem('Invalid query (project must be all|uuid, window must be 24h|7d|30d)'),
            '401': problem('Not signed in'),
          },
        },
      },
      '/workflows': {
        get: {
          tags: ['workflows'],
          summary: 'Bounded workflow list for the Workflow Center (FR-003)',
          description: `Workflows in the visible projects, newest state change first, ${WORKFLOWS_PAGE_SIZE} per page with a keyset cursor over (state_observed_at DESC, id DESC). An invisible project or requirement yields an empty page (total 0), not 404.`,
          security: [{ sessionCookie: [] }],
          parameters: [
            projectQuery,
            {
              name: 'requirement',
              in: 'query',
              required: false,
              schema: { type: 'string', format: 'uuid' },
            },
            csvQuery('state', WORKFLOW_STATES),
            {
              name: 'stage',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 7 },
              description: 'Current stage position',
            },
            cursorQuery,
          ],
          responses: {
            '200': json('WorkflowListPage'),
            '400': problem('Invalid query or cursor'),
            '401': problem('Not signed in'),
          },
        },
      },
      '/requirements': {
        get: {
          tags: ['requirements'],
          summary:
            'Requirements list with state, project and assignee filters (FR-007, FR-009, FR-025)',
          description: `Requirements in the visible projects (or one project), newest first, ${REQUIREMENTS_PAGE_SIZE} per page with a keyset cursor over (created_at DESC, id DESC). Each row carries the linked workflow state when one exists.`,
          security: [{ sessionCookie: [] }],
          parameters: [
            projectQuery,
            csvQuery('state', REQUIREMENT_STATES),
            {
              name: 'assignee',
              in: 'query',
              required: false,
              schema: {
                oneOf: [
                  { const: 'me' },
                  { const: 'unassigned' },
                  { type: 'string', format: 'uuid' },
                ],
              },
            },
            cursorQuery,
          ],
          responses: {
            '200': json('RequirementListPage'),
            '400': problem('Invalid query or cursor'),
            '401': problem('Not signed in'),
          },
        },
        post: {
          tags: ['requirements'],
          summary: 'Create a requirement in DRAFT (FR-007, FR-032)',
          description:
            'Engineers, approvers and administrators only; the project must be visible to the caller. Saved as DRAFT with source manual.',
          security: [{ sessionCookie: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateRequirementRequest' },
              },
            },
          },
          responses: {
            '201': {
              ...json('RequirementDetail', 'Created'),
              headers: {
                Location: { schema: { type: 'string' }, description: '/api/requirements/{id}' },
              },
            },
            '400': problem('Invalid body'),
            '401': problem('Not signed in'),
            '403': problem('Viewers may not create requirements (FR-032)'),
            '404': problem('Project not visible'),
          },
        },
      },
      '/requirements/{id}': {
        get: {
          tags: ['requirements'],
          summary: 'Requirement detail with analysis, transitions and role-gated actions (FR-009)',
          description:
            'Business objective, the runtime analysis (acceptance criteria, rules, open questions — each flagged aiGenerated with its source), the linked workflow and the actions the caller may take. Not visible and unknown both return 404.',
          security: [{ sessionCookie: [] }],
          parameters: [requirementId],
          responses: {
            '200': json('RequirementDetail'),
            '401': problem('Not signed in'),
            '404': problem('Not found or not visible (403 and 404 are indistinguishable)'),
          },
        },
      },
      '/requirements/{id}/submit': {
        post: {
          tags: ['requirements'],
          summary: 'Submit for analysis: DRAFT | NEEDS_CLARIFICATION → ANALYZING (FR-009, FR-036)',
          description:
            'Engineers, approvers and administrators. Records who submitted and when; the agent runtime delivers the result through PUT /ingest/requirements/{externalId}/analysis.',
          security: [{ sessionCookie: [] }],
          parameters: [requirementId],
          responses: { '200': json('RequirementDetail'), ...requirementSessionErrors },
        },
      },
      '/requirements/{id}/approve': {
        post: {
          tags: ['requirements'],
          summary: 'Approve: READY → APPROVED and create the workflow (FR-010, FR-032)',
          description:
            'Approvers and administrators only. One transaction (SELECT … FOR UPDATE, exactly once): the requirement becomes APPROVED, a workflow with its seven stages is created with the first stage QUEUED, an audit_events row is written and inbox_changed is notified.',
          security: [{ sessionCookie: [] }],
          parameters: [requirementId],
          responses: { '200': json('RequirementDetail'), ...requirementSessionErrors },
        },
      },
      '/requirements/{id}/reject': {
        post: {
          tags: ['requirements'],
          summary: 'Reject: DRAFT | NEEDS_CLARIFICATION | READY → REJECTED (FR-009, FR-032)',
          description:
            'Approvers and administrators only; the reason is recorded on the requirement and in audit_events.',
          security: [{ sessionCookie: [] }],
          parameters: [requirementId],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RejectRequirementRequest' },
              },
            },
          },
          responses: {
            '200': json('RequirementDetail'),
            '400': problem('Invalid body (reason required)'),
            ...requirementSessionErrors,
          },
        },
      },
      '/ingest/requirements/{externalId}/analysis': {
        put: {
          tags: ['ingest'],
          summary: 'Runtime delivers the requirement analysis (FR-009, FR-036)',
          description:
            'Bearer ingestion principal scoped to the requirement project. Replaces the analysis items; state becomes READY when openQuestions is empty, otherwise NEEDS_CLARIFICATION. `stale` when observedAt is not newer than the stored analysis (nothing written).',
          security: [{ ingestionToken: [] }],
          parameters: [externalId],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RequirementAnalysisIngest' },
              },
            },
          },
          responses: {
            '200': json('RequirementIngestResult'),
            '400': problem('Invalid body'),
            '401': problem('Unknown or disabled principal'),
            '403': problem('Project outside the principal scope'),
            '404': problem('Unknown requirement externalId'),
            '409': problem('Requirement is not ANALYZING or NEEDS_CLARIFICATION'),
          },
        },
      },
      '/agent-runs/{id}': {
        get: {
          tags: ['agent-runs'],
          summary:
            'Agent run detail: metadata, steps, timeline and decisions (FR-016, FR-017, FR-018)',
          description: `Read-only for every role including viewer; the run must belong to a visible project. Steps (≤ 20) are the runtime's structured progress, the timeline (≤ 50) its events, decisions (≤ 50) carry action, bounded reason, confidence, policy outcome, optional risk level and typed evidence (≤ 20; accessible:false or no href renders as access-restricted). durationMs is finishedAt − startedAt, or now − startedAt while unfinished. A RUNNING|RETRYING run with no timeline activity for more than ${STALE_RUN_AFTER_MS / 60_000} minutes is shown as stale by the client (runFreshness), not re-stated. Live updates ride GET /inbox/stream filtered by workflowId. Not visible and unknown both return 404.`,
          security: [{ sessionCookie: [] }],
          parameters: [{ ...workflowId, description: 'Agent run id' }],
          responses: {
            '200': json('AgentRunDetail'),
            '401': problem('Not signed in'),
            '404': problem('Not found or not visible (403 and 404 are indistinguishable)'),
          },
        },
      },
      '/integrations/jira/webhook': {
        post: {
          tags: ['integrations'],
          summary: 'Inbound Jira issue webhook (FR-008)',
          description:
            'No session. The raw body (≤ 256 KB) is authenticated with x-hub-signature = sha256=<hex HMAC-SHA256(JIRA_WEBHOOK_SECRET, body)> compared in constant time before it is parsed. jira:issue_created / jira:issue_updated create or update the requirement of the project mapped to the Jira project key (source jira, externalRef). jira:issue_deleted or a transition into a done status flags the requirement and moves its linked workflow to BLOCKED. Unmapped projects and unknown events are ignored.',
          security: [],
          parameters: [
            {
              name: 'x-hub-signature',
              in: 'header',
              required: true,
              schema: { type: 'string', pattern: '^sha256=[0-9a-f]{64}$' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/JiraWebhookEvent' } },
            },
          },
          responses: {
            '202': json('JiraWebhookResult', 'Accepted'),
            '400': problem('Invalid event payload'),
            '401': problem('Missing or invalid signature, or webhook secret not configured'),
            '413': problem('Body larger than 256 KB'),
            '429': problem('Rate limited (120 requests per minute per IP)'),
          },
        },
      },
      '/reviews': {
        get: {
          tags: ['reviews'],
          summary: 'Pull requests with AI reviews, newest activity first (US6, FR-025)',
          description:
            'Session user; every role including viewer. Bounded to 50 rows per page over the visible projects, ordered by updatedAt desc, id desc with an opaque keyset cursor. `state` filters by pull request status. Each row carries the derived readyForMerge / blockingOpenCount (FR-022) and the Review Center href.',
          security: [{ sessionCookie: [] }],
          parameters: [
            projectQuery,
            {
              name: 'state',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: [...PullRequestStatus.options] },
            },
            cursorQuery,
          ],
          responses: {
            '200': json('ReviewListResponse'),
            '400': problem('Invalid project, state or cursor'),
            '401': problem('Not signed in'),
          },
        },
      },
      '/reviews/{pullRequestId}': {
        get: {
          tags: ['reviews'],
          summary: 'Review Center: latest review lanes, findings and fix-cycle history (FR-020, FR-022)',
          description:
            'Session user; read-only for every role including viewer (viewers see the actions disabled). Findings (≤ 50) carry severity, blocking class, bounded impact / recommended fix text and typed evidence (≤ 10; accessible:false or no href renders as access-restricted). readyForMerge is derived: false while any BLOCKING finding is OPEN or FIX_REQUESTED, and the client shows “Not ready for merge approval — N blocking findings open”. Live updates ride GET /inbox/stream filtered by the workflowId. Not visible and unknown both return 404.',
          security: [{ sessionCookie: [] }],
          parameters: [pullRequestId],
          responses: {
            '200': json('PullRequestReviewView'),
            '401': problem('Not signed in'),
            '404': problem('Not found or not visible (403 and 404 are indistinguishable)'),
          },
        },
      },
      '/reviews/{pullRequestId}/findings/{findingId}/dismiss': {
        post: {
          tags: ['reviews'],
          summary: 'Dismiss an OPEN finding with a reason (FR-021, FR-032)',
          description:
            'Engineer, approver or administrator. Sets the finding DISMISSED with the reason (≤ 240 chars), the actor and the time; writes an audit_events row (finding.dismissed) and an inbox_changed notification. Returns the finding and the recomputed readiness.',
          security: [{ sessionCookie: [] }],
          parameters: [pullRequestId, findingId],
          requestBody: { required: true, ...json('DismissFindingBody') },
          responses: { '200': json('FindingActionResult'), ...findingActionErrors },
        },
      },
      '/reviews/{pullRequestId}/findings/{findingId}/fix': {
        post: {
          tags: ['reviews'],
          summary: 'Ask the agent to fix an OPEN finding (FR-021, AS-4)',
          description:
            'Engineer, approver or administrator; the body is an empty strict object. In one transaction: joins the RUNNING review cycle of the pull request or creates the next one (iteration n+1, findingsCount = open findings now, fixedCount 0), marks the finding FIX_REQUESTED with fixCycleId, sets the workflow’s Review stage RUNNING with a reason, writes audit_events (finding.fix_requested) and notifies inbox_changed. The runtime reports real progress through PUT /ingest/pull-requests/{externalId}/cycles/{cycle}. 409 when the cycle budget (maxIterations) is exhausted or the finding is not OPEN.',
          security: [{ sessionCookie: [] }],
          parameters: [pullRequestId, findingId],
          requestBody: { required: true, ...json('ApplyFixBody') },
          responses: { '200': json('FindingActionResult'), ...findingActionErrors },
        },
      },
      '/reviews/{pullRequestId}/findings/{findingId}/issue': {
        post: {
          tags: ['reviews'],
          summary: 'Record the intent to track an OPEN finding as an issue (FR-021)',
          description:
            'Engineer, approver or administrator; the body is an empty strict object. Records intent only: the finding becomes ISSUE_REQUESTED with the actor and time, audit_events (finding.issue_requested) and inbox_changed. No outbound Jira call — Jira stays inbound-only.',
          security: [{ sessionCookie: [] }],
          parameters: [pullRequestId, findingId],
          requestBody: { required: true, ...json('CreateIssueBody') },
          responses: { '200': json('FindingActionResult'), ...findingActionErrors },
        },
      },
      '/ingest/pull-requests/{externalId}': {
        put: {
          tags: ['ingest'],
          summary: 'Runtime creates or updates the pull request of a workflow (FR-036)',
          description:
            'Bearer ingestion principal scoped to the workflow project. One pull request per workflow; the workflow and the optional requirement are resolved by externalId. Strict body. `stale` when observedAt is not newer than the stored watermark (nothing written). Never writes audit_events.',
          security: [{ ingestionToken: [] }],
          parameters: [externalId],
          requestBody: { required: true, ...json('PullRequestIngest') },
          responses: {
            '200': json('IngestResult'),
            ...ingestErrors,
            '404': problem('Unknown workflow or requirement externalId'),
          },
        },
      },
      '/ingest/pull-requests/{externalId}/reviews/{cycle}': {
        put: {
          tags: ['ingest'],
          summary: 'Runtime replaces the AI review of a cycle as a whole (FR-020, FR-018, FR-036)',
          description:
            'Bearer ingestion principal scoped to the pull request project. Exactly seven distinct lane results and ≤ 50 findings (positions and externalIds unique, ≤ 10 typed evidence refs each). The body is strict: description / impact / recommendedFix are bounded summaries and any reasoning field (chainOfThought, reasoning, rationale, …) is a 400. Findings already DISMISSED, FIX_REQUESTED or ISSUE_REQUESTED by a human keep their state; the runtime flips findings to FIXED here. `stale` when observedAt is not newer than the stored watermark.',
          security: [{ ingestionToken: [] }],
          parameters: [externalId, cycleNumber],
          requestBody: { required: true, ...json('ReviewIngest') },
          responses: {
            '200': json('IngestResult'),
            '400': problem('Invalid body (unknown key, bound exceeded, lane missing or duplicated)'),
            '401': problem('Unknown or disabled principal'),
            '403': problem('Project outside the principal scope'),
            '404': problem('Unknown pull request externalId'),
            '409': problem('Review is not accepting a replacement (concurrent replacement in progress)'),
          },
        },
      },
      '/ingest/pull-requests/{externalId}/cycles/{cycle}': {
        put: {
          tags: ['ingest'],
          summary: 'Runtime reports the progress of a fix cycle (AS-4, FR-036)',
          description:
            'Bearer ingestion principal scoped to the pull request project. Upserts the cycle counts, iteration and state (RUNNING → COMPLETED | FAILED | CANCELLED); fixedCount + remainingCount ≤ findingsCount. Strict body. `stale` when observedAt is not newer than the stored watermark. 409 when the cycle is already terminal.',
          security: [{ ingestionToken: [] }],
          parameters: [externalId, cycleNumber],
          requestBody: { required: true, ...json('ReviewCycleIngest') },
          responses: {
            '200': json('IngestResult'),
            '400': problem('Invalid body (unknown key, inconsistent counts)'),
            '401': problem('Unknown or disabled principal'),
            '403': problem('Project outside the principal scope'),
            '404': problem('Unknown pull request externalId'),
            '409': problem('Cycle already COMPLETED, FAILED or CANCELLED'),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'cdevi_session' },
        ingestionToken: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        Problem: schema(Problem),
        WorkflowDetail: schema(WorkflowDetail),
        WorkflowActionRequest: schema(WorkflowActionRequest),
        StageUpsert: schema(StageUpsert),
        AgentRunUpsert: schema(AgentRunUpsert),
        ArtifactUpsert: schema(ArtifactUpsert),
        TestRunUpsert: schema(TestRunUpsert),
        IngestResult: schema(IngestResult),
        ApprovalCenterSnapshot: schema(ApprovalCenterSnapshot),
        ApprovalCenterDetail: schema(ApprovalCenterDetail),
        ApproveRequest: schema(ApproveRequest),
        RejectRequest: schema(RejectRequest),
        AnswerRequest: schema(AnswerRequest),
        DecisionResult: schema(DecisionResult),
        AlreadyResolvedProblem: schema(AlreadyResolvedProblem),
        DashboardQuery: schema(DashboardQuery),
        Window: schema(Window),
        Figure: schema(Figure),
        Rate: schema(Rate),
        PipelineStage: schema(PipelineStage),
        DashboardCounts: schema(DashboardCounts),
        DashboardPipeline: schema(DashboardPipeline),
        DashboardNeedsMe: schema(DashboardNeedsMe),
        DashboardHealth: schema(DashboardHealth),
        SecurityFindings: schema(SecurityFindings),
        DashboardRisk: schema(DashboardRisk),
        ActiveWorkflowCard: schema(ActiveWorkflowCard),
        DashboardSnapshot: schema(DashboardSnapshot),
        RequirementState: schema(RequirementState),
        Requirement: schema(Requirement),
        RequirementDetail: schema(RequirementDetail),
        RequirementListQuery: schema(RequirementListQuery),
        RequirementListPage: schema(RequirementListPage),
        CreateRequirementRequest: schema(CreateRequirementRequest),
        RejectRequirementRequest: schema(RejectRequirementRequest),
        RequirementAnalysisIngest: schema(RequirementAnalysisIngest),
        RequirementIngestResult: schema(RequirementIngestResult),
        JiraWebhookEvent: schema(JiraWebhookEvent),
        JiraWebhookResult: schema(JiraWebhookResult),
        WorkflowListQuery: schema(WorkflowListQuery),
        WorkflowListItem: schema(WorkflowListItem),
        WorkflowListPage: schema(WorkflowListPage),
        StageAgentRunRef: schema(StageAgentRunRef),
        ConfidenceLevel: schema(ConfidenceLevel),
        PolicyOutcome: schema(PolicyOutcome),
        EvidenceRef: schema(EvidenceRef),
        RunStep: schema(RunStep),
        AgentDecision: schema(AgentDecision),
        AgentRunDetail: schema(AgentRunDetail),
        AgentDecisionIngest: schema(AgentDecisionIngest),
        AgentDecisionsIngest: schema(AgentDecisionsIngest),
        AgentDecisionsIngestResult: schema(AgentDecisionsIngestResult),
        ReviewLane: schema(ReviewLane),
        LaneStatus: schema(LaneStatus),
        ReviewStatus: schema(ReviewStatus),
        FindingSeverity: schema(FindingSeverity),
        FindingBlocking: schema(FindingBlocking),
        FindingState: schema(FindingState),
        ReviewCycleState: schema(ReviewCycleState),
        PullRequestStatus: schema(PullRequestStatus),
        LaneResult: schema(LaneResult),
        ReviewFindingView: schema(ReviewFindingView),
        ReviewCycleView: schema(ReviewCycleView),
        PullRequestReviewView: schema(PullRequestReviewView),
        ReviewListItem: schema(ReviewListItem),
        ReviewListResponse: schema(ReviewListResponse),
        ReviewListQuery: schema(ReviewListQuery),
        DismissFindingBody: schema(DismissFindingBody),
        ApplyFixBody: schema(ApplyFixBody),
        CreateIssueBody: schema(CreateIssueBody),
        FindingActionResult: schema(FindingActionResult),
        WorkflowPullRequestView: schema(WorkflowPullRequestView),
        PullRequestIngest: schema(PullRequestIngest),
        ReviewFindingIngest: schema(ReviewFindingIngest),
        ReviewIngest: schema(ReviewIngest),
        ReviewCycleIngest: schema(ReviewCycleIngest),
      },
    },
  };
}

/** The 003 document merged with the US1 fragment — what the API serves at /api/docs. */
export function buildFullOpenApi(): Json {
  const base = buildOpenApi();
  const frag = buildWorkflowDetailOpenApi();
  const components = base['components'] as { schemas: Json; securitySchemes: Json };
  const fragComponents = frag['components'] as { schemas: Json };
  return {
    ...base,
    info: { ...(base['info'] as Json), title: 'CDevi API' },
    tags: [
      ...(base['tags'] as Json[]),
      { name: 'workflows' },
      { name: 'approvals' },
      { name: 'dashboard' },
      { name: 'requirements' },
      { name: 'integrations' },
      { name: 'agent-runs' },
      { name: 'reviews' },
    ],
    paths: { ...(base['paths'] as Json), ...(frag['paths'] as Json) },
    components: {
      securitySchemes: components.securitySchemes,
      schemas: { ...components.schemas, ...fragComponents.schemas },
    },
  };
}

/** Builds the OpenAPI 3.1 document from the Zod schemas. `contracts/openapi.yaml` is a snapshot of this. */
export function buildOpenApi(): Json {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CDevi API — Inbox Home Page (specs/003)',
      version: '0.3.0',
      description:
        'Generated from Zod schemas in packages/contracts (`pnpm -F @cdevi/contracts openapi`) and snapshot-tested; edit the schemas, not the yaml. Users authenticate with a session cookie, ingestion principals with a Bearer token. Every error is a Problem. Every list is bounded to 50 items with keyset cursors.',
    },
    servers: [{ url: '/api' }],
    tags: [{ name: 'auth' }, { name: 'inbox' }, { name: 'ingest' }, { name: 'health' }],
    paths: {
      '/auth/sign-in': {
        post: {
          tags: ['auth'],
          summary: 'Sign in with email and password (FR-004)',
          description:
            'Rate-limited 5/min per IP+email. Wrong password and unknown email return the same 401 Problem.',
          requestBody: { required: true, ...json('SignInRequest') },
          responses: {
            '204': {
              description:
                'Signed in; Set-Cookie: cdevi_session (HttpOnly; Secure; SameSite=Lax; Path=/)',
            },
            '400': problem('Invalid body'),
            '401': problem('Email or password is incorrect'),
            '429': problem('Too many attempts'),
          },
        },
      },
      '/auth/sign-out': {
        post: {
          tags: ['auth'],
          summary: 'Revoke the current session',
          security: [{ sessionCookie: [] }],
          responses: { '204': { description: 'Session revoked and cookie cleared' } },
        },
      },
      '/auth/me': {
        get: {
          tags: ['auth'],
          summary: 'Current user, organization and visible projects (FR-003, FR-028)',
          security: [{ sessionCookie: [] }],
          responses: { '200': json('Me'), '401': problem('Not signed in') },
        },
      },
      '/inbox': {
        get: {
          tags: ['inbox'],
          summary:
            'Inbox snapshot — counts, Today summary and one page of one tab (FR-006…FR-018, FR-026…FR-028)',
          security: [{ sessionCookie: [] }],
          parameters: [
            {
              name: 'tab',
              in: 'query',
              schema: {
                type: 'string',
                enum: ['needsYou', 'running', 'done'],
                default: 'needsYou',
              },
            },
            {
              name: 'project',
              in: 'query',
              description: 'Project id or `all` (default). Must be visible to the user, else 404.',
              schema: { type: 'string', default: 'all' },
            },
            {
              name: 'cursor',
              in: 'query',
              description: 'Opaque keyset cursor from a previous nextCursor.',
              schema: { type: 'string', maxLength: 200 },
            },
          ],
          responses: {
            '200': {
              ...json('InboxSnapshot'),
              headers: {
                'Server-Timing': {
                  schema: { type: 'string' },
                  description: 'db;dur=…, total;dur=…',
                },
              },
            },
            '400': problem('Invalid query or cursor'),
            '401': problem('Not signed in'),
            '404': problem('Project not visible'),
          },
        },
      },
      '/inbox/stream': {
        get: {
          tags: ['inbox'],
          summary:
            'Server-Sent Events — inbox.changed notifications for visible projects (FR-019, SC-007)',
          description:
            'text/event-stream. Each event: id=<seq>, event=inbox.changed, data={"projectId","workflowId"}. Heartbeat comment every 25 s. Send Last-Event-ID on reconnect to replay missed events (≤ 24 h) once. Payloads carry no titles or asks — the client refetches GET /inbox.',
          security: [{ sessionCookie: [] }],
          parameters: [{ name: 'Last-Event-ID', in: 'header', schema: { type: 'string' } }],
          responses: {
            '200': {
              description: 'Event stream',
              content: { 'text/event-stream': { schema: { type: 'string' } } },
            },
            '401': problem('Not signed in'),
          },
        },
      },
      '/inbox/records/{kind}/{id}': {
        get: {
          tags: ['inbox'],
          summary:
            'Read-only record behind the /approvals/{id} and /workflows/{id} stubs (research R9)',
          security: [{ sessionCookie: [] }],
          parameters: [
            {
              name: 'kind',
              in: 'path',
              required: true,
              schema: { type: 'string', enum: ['approvals', 'workflows'] },
            },
            { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': json('RecordView'),
            '401': problem('Not signed in'),
            '404': problem('Not found or not visible (403 and 404 are indistinguishable)'),
          },
        },
      },
      '/ingest/workflows/{externalId}': {
        put: {
          tags: ['ingest'],
          summary:
            'Create or update a workflow; optionally apply a state transition (FR-020, FR-021)',
          security: [{ ingestionToken: [] }],
          parameters: [externalId],
          requestBody: { required: true, ...json('WorkflowUpsert') },
          responses: {
            '200': json(
              'IngestResult',
              'accepted, or stale when observedAt is not newer than the current state',
            ),
            ...ingestErrors,
            '409': problem('Illegal transition for the current state'),
          },
        },
      },
      '/ingest/workflows/{externalId}/transitions': {
        post: {
          tags: ['ingest'],
          summary: 'Append a state transition (state machine in data-model.md §3)',
          security: [{ ingestionToken: [] }],
          parameters: [externalId],
          requestBody: { required: true, ...json('Transition') },
          responses: {
            '200': json(
              'IngestResult',
              'accepted, or stale when observedAt is not newer than the current state',
            ),
            ...ingestErrors,
            '409': problem('Illegal transition for the current state (logged as rejected)'),
          },
        },
      },
      '/ingest/approvals/{externalId}': {
        put: {
          tags: ['ingest'],
          summary: 'Raise, update or resolve an approval request (FR-020, FR-021)',
          description:
            'A workflow may have at most one pending approval or clarification; a second pending request → 409.',
          security: [{ ingestionToken: [] }],
          parameters: [externalId],
          requestBody: { required: true, ...json('ApprovalUpsert') },
          responses: {
            '200': json('IngestResult'),
            ...ingestErrors,
            '409': problem('Another request is pending for this workflow'),
          },
        },
      },
      '/ingest/clarifications/{externalId}': {
        put: {
          tags: ['ingest'],
          summary: 'Raise, update or answer a clarification (FR-020, FR-021)',
          security: [{ ingestionToken: [] }],
          parameters: [externalId],
          requestBody: { required: true, ...json('ClarificationUpsert') },
          responses: {
            '200': json('IngestResult'),
            ...ingestErrors,
            '409': problem('Another request is pending for this workflow'),
          },
        },
      },
      '/healthz': {
        get: {
          tags: ['health'],
          summary: 'Liveness + DB round-trip + listener status (research R14)',
          responses: {
            '200': {
              description: 'Health',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['status', 'dbRoundTripMs', 'listenerConnected'],
                    properties: {
                      status: { type: 'string', enum: ['ok', 'degraded'] },
                      dbRoundTripMs: { type: 'number' },
                      listenerConnected: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'cdevi_session' },
        ingestionToken: { type: 'http', scheme: 'bearer' },
      },
      schemas: {
        Problem: schema(Problem),
        SignInRequest: schema(SignInRequest),
        Me: schema(Me),
        InboxSnapshot: schema(InboxSnapshot),
        RecordView: schema(RecordView),
        WorkflowUpsert: schema(WorkflowUpsert),
        Transition: schema(Transition),
        ApprovalUpsert: schema(ApprovalUpsert),
        ClarificationUpsert: schema(ClarificationUpsert),
        IngestResult: schema(IngestResult),
      },
    },
  };
}
