import { WorkflowActionRequest, WorkflowDetail, WorkflowIdParams } from '@cdevi/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { problems } from '../lib/problem';
import { visibleProjects, type SessionUser } from '../services/auth';
import { applyWorkflowAction } from '../services/workflow-actions';
import { workflowDetail, type DetailScope } from '../services/workflow-detail';

export default async function workflowRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const scopeFor = async (user: SessionUser): Promise<DetailScope> => ({
    organizationId: user.organizationId,
    projectIds: (await visibleProjects(app.pool, user)).map((p) => p.id),
    role: user.role,
  });

  r.get(
    '/workflows/:id',
    {
      schema: { tags: ['workflows'], params: WorkflowIdParams, response: { 200: WorkflowDetail } },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as WorkflowIdParams;
      const user = request.user!;
      const started = performance.now();
      const scope = await scopeFor(user);
      const detail = await app.tx(
        { organizationId: user.organizationId, userId: user.id, isolation: 'REPEATABLE READ' },
        (client) => workflowDetail(client, scope, id, app.now()),
      );
      if (!detail) throw problems.notFound("This workflow isn't available to you.");
      reply.header('server-timing', `detail;dur=${(performance.now() - started).toFixed(1)}`);
      request.log.info(
        { userId: user.id, workflowId: id, stages: detail.stages.length },
        'workflow detail',
      );
      return detail;
    },
  );

  r.post(
    '/workflows/:id/actions',
    {
      schema: {
        tags: ['workflows'],
        params: WorkflowIdParams,
        body: WorkflowActionRequest,
        response: { 200: WorkflowDetail },
      },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest) => {
      const { id } = request.params as WorkflowIdParams;
      const body = request.body as WorkflowActionRequest;
      const user = request.user!;
      const scope = await scopeFor(user);
      const detail = await app.tx(
        { organizationId: user.organizationId, userId: user.id },
        async (client) => {
          await applyWorkflowAction(client, user, scope, id, body, app.now());
          return workflowDetail(client, scope, id, app.now());
        },
      );
      if (!detail) throw problems.notFound("This workflow isn't available to you.");
      request.log.info({ userId: user.id, workflowId: id, action: body.action }, 'workflow action');
      return detail;
    },
  );
}
