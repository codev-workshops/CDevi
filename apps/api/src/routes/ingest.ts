import {
  ApprovalUpsert,
  ClarificationUpsert,
  ExternalIdParams,
  IngestResult,
  Transition,
  WorkflowUpsert,
} from '@cdevi/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { IngestionService } from '../services/ingestion';

export default async function ingestRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const svc = (request: FastifyRequest, route: string, target: string) =>
    new IngestionService(app.pool, request.principal!, route, target);

  r.put(
    '/ingest/workflows/:externalId',
    {
      schema: {
        tags: ['ingest'],
        params: ExternalIdParams,
        body: WorkflowUpsert,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(request, 'PUT /ingest/workflows/{externalId}', request.params.externalId).upsertWorkflow(
        request.params.externalId,
        request.body,
      ),
  );

  r.post(
    '/ingest/workflows/:externalId/transitions',
    {
      schema: {
        tags: ['ingest'],
        params: ExternalIdParams,
        body: Transition,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(
        request,
        'POST /ingest/workflows/{externalId}/transitions',
        request.params.externalId,
      ).transition(request.params.externalId, request.body),
  );

  r.put(
    '/ingest/approvals/:externalId',
    {
      schema: {
        tags: ['ingest'],
        params: ExternalIdParams,
        body: ApprovalUpsert,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(request, 'PUT /ingest/approvals/{externalId}', request.params.externalId).upsertApproval(
        request.params.externalId,
        request.body,
      ),
  );

  r.put(
    '/ingest/clarifications/:externalId',
    {
      schema: {
        tags: ['ingest'],
        params: ExternalIdParams,
        body: ClarificationUpsert,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(
        request,
        'PUT /ingest/clarifications/{externalId}',
        request.params.externalId,
      ).upsertClarification(request.params.externalId, request.body),
  );
}
