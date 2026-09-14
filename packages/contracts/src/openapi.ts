import { z, type ZodType } from 'zod';
import { Me, SignInRequest } from './auth';
import { Problem } from './common';
import { InboxSnapshot, RecordView } from './inbox';
import {
  AgentRunUpsert,
  ApprovalUpsert,
  ArtifactUpsert,
  ClarificationUpsert,
  IngestResult,
  StageUpsert,
  TestRunUpsert,
  Transition,
  WorkflowUpsert,
} from './ingest';
import { WorkflowActionRequest, WorkflowDetail } from './workflow-detail';
import { AlreadyResolvedProblem, AnswerRequest, ApproveRequest, RejectRequest } from './decisions';
import { ApprovalCenterDetail, ApprovalCenterSnapshot, DecisionResult } from './approval-center';

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

/**
 * specs/001 US1 fragment: Workflow Detail read + actions and the stage/run/artifact/test-run ingestion routes.
 * `specs/001-sdlc-control-plane-mvp/contracts/openapi.yaml` is a snapshot of this.
 */
export function buildWorkflowDetailOpenApi(): Json {
  return {
    openapi: '3.1.0',
    info: {
      title: 'CDevi API — Workflow Detail and Approval Center (specs/001 US1–US2)',
      version: '0.2.0',
      description:
        'Generated from Zod schemas in packages/contracts (`pnpm -F @cdevi/contracts openapi`) and snapshot-tested; edit the schemas, not the yaml. Extends the specs/003 document: same session cookie, Bearer ingestion tokens, Problem errors. Live updates reuse GET /inbox/stream — the client filters inbox.changed frames by workflowId. Human decisions (approve, reject, answer) are a separate path from agent ingestion: session user, approver/administrator only, exactly once.',
    },
    servers: [{ url: '/api' }],
    tags: [{ name: 'workflows' }, { name: 'ingest' }, { name: 'approvals' }],
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
          parameters: [
            {
              name: 'project',
              in: 'query',
              required: false,
              schema: {
                oneOf: [{ const: 'all' }, { type: 'string', format: 'uuid' }],
                default: 'all',
              },
            },
          ],
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
    tags: [...(base['tags'] as Json[]), { name: 'workflows' }, { name: 'approvals' }],
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
