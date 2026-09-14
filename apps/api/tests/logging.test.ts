import { Writable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asIngest,
  asUser,
  iso,
  MIN,
  plus,
  SEED_PASSWORD,
  signIn,
  skipDb,
  testApp,
  uniq,
} from './helpers';

describe.skipIf(skipDb)(
  'security pass (T064): logs and errors carry no secrets or internals',
  () => {
    let app: FastifyInstance;
    const lines: string[] = [];
    beforeAll(async () => {
      const sink = new Writable({
        write(chunk, _enc, cb) {
          lines.push(chunk.toString());
          cb();
        },
      });
      app = await testApp({ logger: { level: 'info', stream: sink } });
    });
    afterAll(() => app.close());

    it('sign-in and ingestion logs contain no email, password, token, ask or question text', async () => {
      const ext = uniq('log');
      const c = await signIn(app, 'approver1@cdevi.demo');
      await app.inject(
        asIngest({
          method: 'PUT',
          url: `/api/ingest/workflows/${ext}`,
          payload: {
            projectKey: 'payments-api',
            title: 'Secret-ish title Zebra42',
            state: 'RUNNING',
            observedAt: iso(plus(-1 * MIN)),
          },
        }),
      );
      await app.inject(
        asIngest({
          method: 'PUT',
          url: `/api/ingest/approvals/${ext}-a`,
          payload: {
            workflowExternalId: ext,
            ask: 'Approve: the very secret ask Pelican77',
            riskLevel: 'LOW',
            requestedAt: iso(plus(-1 * MIN)),
          },
        }),
      );
      await app.inject(asUser(c, { method: 'GET', url: '/api/inbox' }));
      const all = lines.join('\n');
      expect(all).not.toContain('approver1@cdevi.demo');
      expect(all).not.toContain(SEED_PASSWORD);
      expect(all).not.toContain('cdvi_test_ingest_token');
      expect(all).not.toContain('Pelican77');
      expect(all).not.toContain('Zebra42');
      expect(all).not.toMatch(/cdevi_session=[A-Za-z0-9_-]{20,}/);
      expect(all).toMatch(/"responseTime":/);
    });

    it('a forced database error yields a generic 500 Problem without SQL or stack text', async () => {
      const broken = await testApp({ notify: false });
      try {
        const c = await signIn(broken, 'approver1@cdevi.demo');
        // Simulate a database failure inside the inbox transaction.
        (broken as unknown as { tx: () => Promise<never> }).tx = async () => {
          throw new Error('relation "workflows" does not exist at SELECT w.id FROM workflows');
        };
        const res = await broken.inject(asUser(c, { method: 'GET', url: '/api/inbox' }));
        expect(res.statusCode).toBe(500);
        expect(res.body).not.toMatch(/SELECT|relation|workflows|\.ts:\d+/);
        expect(res.json()).toMatchObject({ type: 'urn:cdevi:problem:internal', status: 500 });
        expect(res.json().detail).toMatch(/^Request req-\S+ failed/);
      } finally {
        await broken.close();
      }
    });

    it('auth and inbox responses are Cache-Control: no-store', async () => {
      const c = await signIn(app, 'engineer1@cdevi.demo');
      for (const url of ['/api/auth/me', '/api/inbox', '/api/inbox?tab=done']) {
        const res = await app.inject(asUser(c, { method: 'GET', url }));
        expect(res.headers['cache-control'], url).toBe('no-store');
      }
      const signIn401 = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        payload: { email: 'x@y.zz', password: 'wrong-wrong-wrong' },
      });
      expect(signIn401.headers['cache-control']).toBe('no-store');
    });
  },
);
