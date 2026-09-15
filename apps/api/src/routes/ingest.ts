import {
  AgentDecisionsIngest,
  AgentDecisionsIngestResult,
  AgentRunUpsert,
  ApprovalUpsert,
  ArtifactUpsert,
  ClarificationUpsert,
  ExternalIdParams,
  IngestResult,
  RequirementAnalysisIngest,
  RequirementIngestResult,
  StagePositionParams,
  StageUpsert,
  TestRunUpsert,
  Transition,
  WorkflowUpsert,
} from '@cdevi/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { IngestionService } from '../services/ingestion';
import { ingestRequirementAnalysis } from '../services/requirement-analysis';

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

  // ---- specs/001 US1 extensions

  r.put(
    '/ingest/workflows/:externalId/stages/:position',
    {
      schema: {
        tags: ['ingest'],
        params: StagePositionParams,
        body: StageUpsert,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(
        request,
        'PUT /ingest/workflows/{externalId}/stages/{position}',
        request.params.externalId,
      ).upsertStage(request.params.externalId, request.params.position, request.body),
  );

  r.put(
    '/ingest/agent-runs/:externalId',
    {
      schema: {
        tags: ['ingest'],
        params: ExternalIdParams,
        body: AgentRunUpsert,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(request, 'PUT /ingest/agent-runs/{externalId}', request.params.externalId).upsertAgentRun(
        request.params.externalId,
        request.body,
      ),
  );

  r.put(
    '/ingest/agent-runs/:externalId/decisions',
    {
      schema: {
        tags: ['ingest'],
        params: ExternalIdParams,
        body: AgentDecisionsIngest,
        response: { 200: AgentDecisionsIngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(
        request,
        'PUT /ingest/agent-runs/{externalId}/decisions',
        request.params.externalId,
      ).replaceAgentDecisions(request.params.externalId, request.body),
  );

  r.put(
    '/ingest/artifacts/:externalId',
    {
      schema: {
        tags: ['ingest'],
        params: ExternalIdParams,
        body: ArtifactUpsert,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(request, 'PUT /ingest/artifacts/{externalId}', request.params.externalId).upsertArtifact(
        request.params.externalId,
        request.body,
      ),
  );

  r.put(
    '/ingest/test-runs/:externalId',
    {
      schema: {
        tags: ['ingest'],
        params: ExternalIdParams,
        body: TestRunUpsert,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(request, 'PUT /ingest/test-runs/{externalId}', request.params.externalId).upsertTestRun(
        request.params.externalId,
        request.body,
      ),
  );

  // ---- specs/001 US4: the agent runtime delivers a requirement's analysis

  r.put(
    '/ingest/requirements/:externalId/analysis',
    {
      schema: {
        tags: ['ingest'],
        params: ExternalIdParams,
        body: RequirementAnalysisIngest,
        response: { 200: RequirementIngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      ingestRequirementAnalysis(
        app.pool,
        request.principal!,
        request.params.externalId,
        request.body,
        app.now(),
      ),
  );
}
