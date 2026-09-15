import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asIngest, asUser, signIn, skipDb, testApp } from './helpers';

const PR = '00000000-0000-4000-8000-000000001821';
const FINDING = '00000000-0000-4000-8000-000000000002';
const T = '2026-09-14T09:00:00.000Z';
const LANES = [
  'correctness',
  'security',
  'dependencies',
  'edge_cases',
  'testing',
  'architecture',
  'general',
].map((lane) => ({ lane, status: 'PASS' }));

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
    for (const [method, url, payload] of [
      ['GET', '/api/reviews', undefined],
      ['GET', `/api/reviews/${PR}`, undefined],
      [
        'POST',
        `/api/reviews/${PR}/findings/${FINDING}/dismiss`,
        { reason: 'Covered by the gateway.' },
      ],
      ['POST', `/api/reviews/${PR}/findings/${FINDING}/fix`, {}],
      ['POST', `/api/reviews/${PR}/findings/${FINDING}/issue`, {}],
    ] as const) {
      const r = await app.inject(
        asUser(cookie, payload === undefined ? { method, url } : { method, url, payload }),
      );
      expect(r.statusCode, `${method} ${url}`).toBe(501);
      expect(r.headers['content-type']).toContain('application/problem+json');
    }
  });

  it('FR-021 action bodies are validated against the contracts (strict; dismiss needs a reason ≤ 240)', async () => {
    for (const [action, payload] of [
      ['dismiss', {}],
      ['dismiss', { reason: 'x'.repeat(241) }],
      ['fix', { reason: 'not allowed here' }],
      ['issue', { reasoning: 'nope' }],
    ] as const) {
      const r = await app.inject(
        asUser(cookie, {
          method: 'POST',
          url: `/api/reviews/${PR}/findings/${FINDING}/${action}`,
          payload,
        }),
      );
      expect(r.statusCode, action).toBe(400);
      expect(r.headers['content-type']).toContain('application/problem+json');
    }
  });

  it('FR-036 pull-request ingest operations require the ingest principal and validate the body', async () => {
    const bodies = [
      [
        '/api/ingest/pull-requests/pr-1821',
        {
          number: 1821,
          title: 'PAY-1391 Refund processing',
          href: 'https://git.cdevi.demo/payments-api/pull/1821',
          status: 'OPEN',
          workflowExternalId: 's500-001',
          reviewStagePosition: 6,
          observedAt: T,
        },
      ],
      [
        '/api/ingest/pull-requests/pr-1821/reviews/3',
        {
          externalId: 'rev-1821-3',
          status: 'COMPLETE',
          lanes: LANES,
          findings: [],
          startedAt: T,
          observedAt: T,
        },
      ],
      [
        '/api/ingest/pull-requests/pr-1821/cycles/3',
        {
          findingsCount: 7,
          fixedCount: 6,
          remainingCount: 1,
          iteration: 3,
          state: 'COMPLETED',
          startedAt: T,
          observedAt: T,
        },
      ],
    ] as const;
    for (const [url, payload] of bodies) {
      const anon = await app.inject({ method: 'PUT', url, payload });
      expect(anon.statusCode, `${url} anonymous`).toBe(401);
      const ok = await app.inject(asIngest({ method: 'PUT', url, payload }));
      expect(ok.statusCode, url).toBe(501);
      const bad = await app.inject(
        asIngest({ method: 'PUT', url, payload: { ...payload, reasoning: 'step by step' } }),
      );
      expect(bad.statusCode, `${url} +reasoning`).toBe(400);
      const empty = await app.inject(asIngest({ method: 'PUT', url, payload: {} }));
      expect(empty.statusCode, `${url} {}`).toBe(400);
    }
  });
});
