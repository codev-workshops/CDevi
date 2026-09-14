import { z, type ZodType } from 'zod';
import { Me, SignInRequest } from './auth';
import { Problem } from './common';
import { InboxSnapshot, RecordView } from './inbox';
import {
  ApprovalUpsert,
  ClarificationUpsert,
  IngestResult,
  Transition,
  WorkflowUpsert,
} from './ingest';

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
