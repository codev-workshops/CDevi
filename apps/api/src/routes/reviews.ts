import {
  ApplyFixBody,
  CreateIssueBody,
  DismissFindingBody,
  FindingActionParams,
  FindingActionResult,
  IngestResult,
  PullRequestExternalIdParams,
  PullRequestIdParams,
  PullRequestIngest,
  PullRequestReviewView,
  ReviewCycleIngest,
  ReviewCycleParams,
  ReviewIngest,
  ReviewListQuery,
  ReviewListResponse,
} from '@cdevi/contracts';
import { InvalidCursorError } from '@cdevi/contracts/read-model';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { problems } from '../lib/problem';
import { applyFindingAction, type FindingAction } from '../services/finding-actions';
import { getPullRequestReview, listReviews } from '../services/review-center';
import { ReviewIngestionService } from '../services/review-ingestion';

/**
 * specs/001 US6 — Review Center read models (FR-020, FR-022), the three human finding actions (FR-021, FR-032) and
 * the pull-request / review / fix-cycle ingestion routes (FR-036). Session routes: every role reads, viewer gets a
 * 403 Problem on actions; an unknown pull request and one in an invisible project answer the same 404. Ingest routes
 * take the Bearer ingest principal like `routes/ingest.ts`.
 */
export default async function reviewRoutes(app: FastifyInstance) {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    '/reviews',
    {
      schema: {
        tags: ['reviews'],
        querystring: ReviewListQuery,
        response: { 200: ReviewListResponse },
      },
      preHandler: app.requireUser,
    },
    async (request, reply) => {
      const user = request.user!;
      try {
        const page = await listReviews(app.pool, user, request.query);
        reply.header('cache-control', 'no-store');
        return page;
      } catch (e) {
        if (e instanceof InvalidCursorError) throw problems.invalidCursor();
        throw e;
      }
    },
  );

  api.get(
    '/reviews/:pullRequestId',
    {
      schema: {
        tags: ['reviews'],
        params: PullRequestIdParams,
        response: { 200: PullRequestReviewView },
      },
      preHandler: app.requireUser,
    },
    async (request, reply) => {
      const user = request.user!;
      const started = performance.now();
      const view = await app.tx(
        { organizationId: user.organizationId, userId: user.id, isolation: 'REPEATABLE READ' },
        (client) => getPullRequestReview(client, user, request.params.pullRequestId),
      );
      if (!view) throw problems.notFound("This pull request isn't available to you.");
      reply.header('cache-control', 'no-store');
      reply.header('server-timing', `review;dur=${(performance.now() - started).toFixed(1)}`);
      return view;
    },
  );

  const act = async (
    request: FastifyRequest,
    action: FindingAction,
  ): Promise<FindingActionResult> => {
    const { pullRequestId, findingId } = request.params as FindingActionParams;
    const user = request.user!;
    const result = await app.tx(
      { organizationId: user.organizationId, userId: user.id },
      (client) => applyFindingAction(client, user, pullRequestId, findingId, action, app.now()),
    );
    request.log.info(
      {
        userId: user.id,
        pullRequestId,
        findingId,
        action: action.kind,
        state: result.finding.state,
      },
      'finding action',
    );
    return result;
  };

  api.post(
    '/reviews/:pullRequestId/findings/:findingId/dismiss',
    {
      schema: {
        tags: ['reviews'],
        params: FindingActionParams,
        body: DismissFindingBody,
        response: { 200: FindingActionResult },
      },
      preHandler: app.requireUser,
    },
    async (request) => act(request, { kind: 'dismiss', body: request.body }),
  );
  api.post(
    '/reviews/:pullRequestId/findings/:findingId/fix',
    {
      schema: {
        tags: ['reviews'],
        params: FindingActionParams,
        body: ApplyFixBody,
        response: { 200: FindingActionResult },
      },
      preHandler: app.requireUser,
    },
    async (request) => act(request, { kind: 'fix', body: request.body }),
  );
  api.post(
    '/reviews/:pullRequestId/findings/:findingId/issue',
    {
      schema: {
        tags: ['reviews'],
        params: FindingActionParams,
        body: CreateIssueBody,
        response: { 200: FindingActionResult },
      },
      preHandler: app.requireUser,
    },
    async (request) => act(request, { kind: 'issue', body: request.body }),
  );

  const svc = (request: FastifyRequest, route: string, target: string) =>
    new ReviewIngestionService(app.pool, request.principal!, route, target);

  api.put(
    '/ingest/pull-requests/:externalId',
    {
      schema: {
        tags: ['ingest'],
        params: PullRequestExternalIdParams,
        body: PullRequestIngest,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(
        request,
        'PUT /ingest/pull-requests/{externalId}',
        request.params.externalId,
      ).upsertPullRequest(request.params.externalId, request.body),
  );
  api.put(
    '/ingest/pull-requests/:externalId/reviews/:cycle',
    {
      schema: {
        tags: ['ingest'],
        params: ReviewCycleParams,
        body: ReviewIngest,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(
        request,
        'PUT /ingest/pull-requests/{externalId}/reviews/{cycle}',
        request.params.externalId,
      ).replaceReview(request.params.externalId, request.params.cycle, request.body),
  );
  api.put(
    '/ingest/pull-requests/:externalId/cycles/:cycle',
    {
      schema: {
        tags: ['ingest'],
        params: ReviewCycleParams,
        body: ReviewCycleIngest,
        response: { 200: IngestResult },
      },
      preHandler: app.requirePrincipal,
    },
    async (request) =>
      svc(
        request,
        'PUT /ingest/pull-requests/{externalId}/cycles/{cycle}',
        request.params.externalId,
      ).upsertCycle(request.params.externalId, request.params.cycle, request.body),
  );
}
