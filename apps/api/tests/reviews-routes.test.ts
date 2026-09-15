import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asIngest, asUser, signIn, skipDb, testApp } from './helpers';

const PR = '00000000-0000-4000-8000-000000001821';
const FINDING = '00000000-0000-4000-8000-000000000002';

describe.skipIf(skipDb)('US6 review routes are registered (specs/001 FR-016/FR-017 parity)', () => {
  let app: FastifyInstance;
  let cookie: string;
  beforeAll(async () => {
    app = await testApp();
    cookie = await signIn(app, 'engineer1@cdevi.demo');
  });
  afterAll(() => app.close());

  it('FR-020 review operations require a session and answer problem+json until the service lands', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/reviews' });
    expect(anon.statusCode).toBe(401);
    for (const [method, url] of [
      ['GET', '/api/reviews'],
      ['GET', `/api/reviews/${PR}`],
      ['POST', `/api/reviews/${PR}/findings/${FINDING}/dismiss`],
      ['POST', `/api/reviews/${PR}/findings/${FINDING}/fix`],
      ['POST', `/api/reviews/${PR}/findings/${FINDING}/issue`],
    ] as const) {
      const r = await app.inject(asUser(cookie, { method, url }));
      expect(r.statusCode, `${method} ${url}`).toBe(501);
      expect(r.headers['content-type']).toContain('application/problem+json');
    }
  });

  it('FR-036 pull-request ingest operations require the ingest principal', async () => {
    const anon = await app.inject({ method: 'PUT', url: '/api/ingest/pull-requests/pr-1821' });
    expect(anon.statusCode).toBe(401);
    for (const url of [
      '/api/ingest/pull-requests/pr-1821',
      '/api/ingest/pull-requests/pr-1821/reviews/3',
      '/api/ingest/pull-requests/pr-1821/cycles/3',
    ]) {
      const r = await app.inject(asIngest({ method: 'PUT', url, payload: {} }));
      expect(r.statusCode, url).toBe(501);
    }
  });
});
