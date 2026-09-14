import { describe, expect, it } from 'vitest';
import { skipDb, testApp } from './helpers';

describe.skipIf(skipDb)('GET /api/healthz (research R14)', () => {
  it('reports db round trip and listener status', async () => {
    const app = await testApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/api/healthz' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(['ok', 'degraded']).toContain(body.status);
      expect(typeof body.dbRoundTripMs).toBe('number');
      expect(body.listenerConnected).toBe(true);
      expect(body.status).toBe('ok');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    } finally {
      await app.close();
    }
  });
});
