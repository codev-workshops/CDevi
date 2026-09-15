import {
  WorkflowActionRequest,
  WorkflowDetail,
  WorkflowIdParams,
  WorkflowListPage,
  WorkflowListQuery,
} from '@cdevi/contracts';
import { InvalidCursorError } from '@cdevi/contracts/read-model';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { problems } from '../lib/problem';
import { visibleProjects, type SessionUser } from '../services/auth';
import { applyWorkflowAction } from '../services/workflow-actions';
import { workflowDetail, type DetailScope } from '../services/workflow-detail';
import { listWorkflows } from '../services/workflow-list';

export default async function workflowRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const scopeFor = async (user: SessionUser): Promise<DetailScope> => ({
    organizationId: user.organizationId,
    projectIds: (await visibleProjects(app.pool, user)).map((p) => p.id),
    role: user.role,
  });

  r.get(
    '/workflows',
    {
      schema: {
        tags: ['workflows'],
        querystring: WorkflowListQuery,
        response: { 200: WorkflowListPage },
      },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest, reply) => {
      const query = request.query as WorkflowListQuery;
      const user = request.user!;
      const started = performance.now();
      const scope = await scopeFor(user);
      let page: WorkflowListPage;
      try {
        page = await app.tx(
          { organizationId: user.organizationId, userId: user.id, isolation: 'REPEATABLE READ' },
          (client) => listWorkflows(client, scope, query, app.now()),
        );
      } catch (e) {
        if (e instanceof InvalidCursorError) throw problems.invalidCursor();
        throw e;
      }
      reply.header('server-timing', `workflows;dur=${(performance.now() - started).toFixed(1)}`);
      request.log.info(
        { userId: user.id, project: query.project, items: page.items.length, total: page.total },
        'workflow list',
      );
      return page;
    },
  );

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
