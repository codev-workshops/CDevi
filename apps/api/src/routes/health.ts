import type { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/healthz', { schema: { tags: ['health'] } }, async (_request, reply) => {
    const t = performance.now();
    let dbOk = true;
    try {
      await app.pool.query('SELECT 1');
    } catch {
      dbOk = false;
    }
    const dbRoundTripMs = Math.round((performance.now() - t) * 10) / 10;
    const listenerConnected = app.notify.connected;
    reply.header('cache-control', 'no-store');
    return {
      status: dbOk && listenerConnected ? 'ok' : 'degraded',
      dbRoundTripMs,
      listenerConnected,
    };
  });
}
