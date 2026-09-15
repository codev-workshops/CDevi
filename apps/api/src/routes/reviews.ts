import {
  FindingActionParams,
  PullRequestExternalIdParams,
  PullRequestIdParams,
  ReviewCycleParams,
  ReviewListQuery,
} from '@cdevi/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ProblemError } from '../lib/problem';

/**
 * specs/001 US6 Review Center and pull-request ingestion operations. The contracts and OpenAPI document are
 * registered by feature/US6-contracts-db; every operation is served here so the OpenAPI ↔ route-table parity
 * check holds, and answers 501 until the Review Center service lands (feature/US6-api). Auth runs first so the
 * 401 / 403 semantics of the document are already honoured.
 */
export default async function reviewRoutes(app: FastifyInstance) {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const notImplemented = () =>
    new ProblemError(
      501,
      'urn:cdevi:problem:not-implemented',
      'Not implemented',
      'Pull request reviews are not available yet.',
    );
  const pending = async () => {
    throw notImplemented();
  };

  api.get(
    '/reviews',
    { schema: { tags: ['reviews'], querystring: ReviewListQuery }, preHandler: app.requireUser },
    pending,
  );
  api.get(
    '/reviews/:pullRequestId',
    { schema: { tags: ['reviews'], params: PullRequestIdParams }, preHandler: app.requireUser },
    pending,
  );
  for (const action of ['dismiss', 'fix', 'issue'] as const) {
    api.post(
      `/reviews/:pullRequestId/findings/:findingId/${action}`,
      { schema: { tags: ['reviews'], params: FindingActionParams }, preHandler: app.requireUser },
      pending,
    );
  }
  api.put(
    '/ingest/pull-requests/:externalId',
    {
      schema: { tags: ['ingest'], params: PullRequestExternalIdParams },
      preHandler: app.requirePrincipal,
    },
    pending,
  );
  api.put(
    '/ingest/pull-requests/:externalId/reviews/:cycle',
    { schema: { tags: ['ingest'], params: ReviewCycleParams }, preHandler: app.requirePrincipal },
    pending,
  );
  api.put(
    '/ingest/pull-requests/:externalId/cycles/:cycle',
    { schema: { tags: ['ingest'], params: ReviewCycleParams }, preHandler: app.requirePrincipal },
    pending,
  );
}
