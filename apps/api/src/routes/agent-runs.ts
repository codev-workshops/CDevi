import { AgentRunDetail, AgentRunIdParams } from '@cdevi/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { problems } from '../lib/problem';
import { getAgentRunDetail } from '../services/agent-run-detail';

/**
 * GET /agent-runs/{id} — the specs/001 US5 read model. Session auth; every role may read (FR-032);
 * an unknown run and a run in an invisible project return the same 404 Problem.
 */
export default async function agentRunsRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/agent-runs/:id',
    {
      schema: {
        tags: ['agent-runs'],
        params: AgentRunIdParams,
        response: { 200: AgentRunDetail },
      },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as AgentRunIdParams;
      const user = request.user!;
      const started = performance.now();
      const detail = await app.tx(
        { organizationId: user.organizationId, userId: user.id, isolation: 'REPEATABLE READ' },
        (client) => getAgentRunDetail(client, user, id, app.now()),
      );
      if (!detail) throw problems.notFound("This agent run isn't available to you.");
      reply.header('cache-control', 'no-store');
      reply.header('server-timing', `agent-run;dur=${(performance.now() - started).toFixed(1)}`);
      request.log.info(
        { userId: user.id, agentRunId: id, decisions: detail.decisions.length },
        'agent run detail',
      );
      return detail;
    },
  );
}
