import { buildFullOpenApi } from '@cdevi/contracts/openapi';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipDb, testApp } from './helpers';

const METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;

/** Every documented `{method} {path}` of the served OpenAPI document, in Fastify `:param` notation. */
function documentedOperations(): string[] {
  const doc = buildFullOpenApi();
  const paths = doc['paths'] as Record<string, Record<string, unknown>>;
  return Object.entries(paths)
    .flatMap(([path, ops]) =>
      METHODS.filter((m) => m in ops).map(
        (m) => `${m.toUpperCase()} /api${path.replace(/\{(\w+)\}/g, ':$1')}`,
      ),
    )
    .sort();
}

describe.skipIf(skipDb)('OpenAPI ↔ Fastify route table parity (specs/001 US5, plan §5)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await testApp();
  });
  afterAll(() => app.close());

  it('FR-016/FR-017 every documented operation is served, including the US5 agent-run and US6 review routes', () => {
    const ops = documentedOperations();
    expect(ops).toEqual(
      expect.arrayContaining([
        'GET /api/agent-runs/:id',
        'PUT /api/ingest/agent-runs/:externalId',
        'PUT /api/ingest/agent-runs/:externalId/decisions',
        'GET /api/workflows/:id',
        'GET /api/reviews',
        'GET /api/reviews/:pullRequestId',
        'POST /api/reviews/:pullRequestId/findings/:findingId/dismiss',
        'POST /api/reviews/:pullRequestId/findings/:findingId/fix',
        'POST /api/reviews/:pullRequestId/findings/:findingId/issue',
        'PUT /api/ingest/pull-requests/:externalId',
        'PUT /api/ingest/pull-requests/:externalId/reviews/:cycle',
        'PUT /api/ingest/pull-requests/:externalId/cycles/:cycle',
      ]),
    );
    const missing = ops.filter((op) => {
      const [method, url] = op.split(' ') as [HTTPMethods, string];
      return !app.hasRoute({ method, url });
    });
    expect(missing).toEqual([]);
  });
});
