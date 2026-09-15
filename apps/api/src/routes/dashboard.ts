import { DashboardQuery, DashboardSnapshot } from '@cdevi/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { dashboardSnapshot } from '../services/dashboard';
import { scopeFor } from './approvals';

/**
 * GET /dashboard — the specs/001 US3 read model. One REPEATABLE READ transaction over the caller's visible
 * projects; an unknown or invisible project yields a zero snapshot rather than a 404.
 */
export default async function dashboardRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/dashboard',
    {
      schema: {
        tags: ['dashboard'],
        querystring: DashboardQuery,
        response: { 200: DashboardSnapshot },
      },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest, reply) => {
      const query = request.query as DashboardQuery;
      const user = request.user!;
      const started = performance.now();
      const scope = await scopeFor(app, user);
      const snapshot = await app.tx(
        { organizationId: user.organizationId, userId: user.id, isolation: 'REPEATABLE READ' },
        (client) => dashboardSnapshot(client, scope, query, app.now()),
      );
      reply.header('server-timing', `dashboard;dur=${(performance.now() - started).toFixed(1)}`);
      request.log.info(
        {
          userId: user.id,
          project: query.project,
          window: query.window,
          active: snapshot.activeWorkflowsTotal,
        },
        'dashboard snapshot',
      );
      return snapshot;
    },
  );
}
