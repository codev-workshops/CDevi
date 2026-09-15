import {
  CreateRequirementRequest,
  RejectRequirementRequest,
  RequirementDetail,
  RequirementIdParams,
  RequirementListPage,
  RequirementListQuery,
} from '@cdevi/contracts';
import { InvalidCursorError } from '@cdevi/contracts/read-model';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { problems } from '../lib/problem';
import { visibleProjects, type SessionUser } from '../services/auth';
import {
  approveRequirement,
  createRequirement,
  listRequirements,
  rejectRequirement,
  requirementDetail,
  submitRequirement,
  type RequirementScope,
} from '../services/requirements';

const TAG = 'requirements';

export default async function requirementRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  const scopeFor = async (user: SessionUser): Promise<RequirementScope> => ({
    organizationId: user.organizationId,
    projectIds: (await visibleProjects(app.pool, user)).map((p) => p.id),
  });

  /** Runs one mutation and returns the refreshed detail in the same transaction (the row is already locked). */
  async function mutate(
    request: FastifyRequest,
    reply: FastifyReply,
    timing: string,
    fn: (
      client: pg.PoolClient,
      scope: RequirementScope,
      user: SessionUser,
      id: string,
    ) => Promise<string>,
  ): Promise<RequirementDetail> {
    const { id } = request.params as RequirementIdParams;
    const user = request.user!;
    const started = performance.now();
    const scope = await scopeFor(user);
    const detail = await app.tx(
      { organizationId: user.organizationId, userId: user.id },
      async (client) => {
        const requirementId = await fn(client, scope, user, id);
        return requirementDetail(client, scope, requirementId, user, app.now());
      },
    );
    if (!detail) throw problems.notFound("This requirement isn't available to you.");
    reply.header('server-timing', `${timing};dur=${(performance.now() - started).toFixed(1)}`);
    request.log.info(
      { userId: user.id, requirementId: detail.requirement.id, action: timing, state: detail.requirement.state },
      'requirement action',
    );
    return detail;
  }

  r.get(
    '/requirements',
    {
      schema: {
        tags: [TAG],
        querystring: RequirementListQuery,
        response: { 200: RequirementListPage },
      },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest, reply) => {
      const query = request.query as RequirementListQuery;
      const user = request.user!;
      const started = performance.now();
      const scope = await scopeFor(user);
      let page: RequirementListPage;
      try {
        page = await app.tx(
          { organizationId: user.organizationId, userId: user.id, isolation: 'REPEATABLE READ' },
          (client) => listRequirements(client, scope, user, query, app.now()),
        );
      } catch (e) {
        if (e instanceof InvalidCursorError) throw problems.invalidCursor();
        throw e;
      }
      reply.header('server-timing', `requirements;dur=${(performance.now() - started).toFixed(1)}`);
      request.log.info(
        { userId: user.id, project: query.project, items: page.items.length, total: page.total },
        'requirements list',
      );
      return page;
    },
  );

  r.post(
    '/requirements',
    {
      schema: {
        tags: [TAG],
        body: CreateRequirementRequest,
        response: { 201: RequirementDetail },
      },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest, reply) => {
      const body = request.body as CreateRequirementRequest;
      const user = request.user!;
      const started = performance.now();
      const scope = await scopeFor(user);
      const detail = await app.tx(
        { organizationId: user.organizationId, userId: user.id },
        async (client) => {
          const id = await createRequirement(client, scope, user, body, app.now());
          return requirementDetail(client, scope, id, user, app.now());
        },
      );
      if (!detail) throw problems.notFound("That project isn't available to you.");
      reply.header('server-timing', `create;dur=${(performance.now() - started).toFixed(1)}`);
      reply.header('location', `/api/requirements/${detail.requirement.id}`);
      request.log.info(
        { userId: user.id, requirementId: detail.requirement.id, projectId: body.projectId },
        'requirement created',
      );
      return reply.code(201).send(detail);
    },
  );

  r.get(
    '/requirements/:id',
    {
      schema: { tags: [TAG], params: RequirementIdParams, response: { 200: RequirementDetail } },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as RequirementIdParams;
      const user = request.user!;
      const started = performance.now();
      const scope = await scopeFor(user);
      const detail = await app.tx(
        { organizationId: user.organizationId, userId: user.id, isolation: 'REPEATABLE READ' },
        (client) => requirementDetail(client, scope, id, user, app.now()),
      );
      if (!detail) throw problems.notFound("This requirement isn't available to you.");
      reply.header('server-timing', `requirement;dur=${(performance.now() - started).toFixed(1)}`);
      return detail;
    },
  );

  r.post(
    '/requirements/:id/submit',
    {
      schema: { tags: [TAG], params: RequirementIdParams, response: { 200: RequirementDetail } },
      preHandler: app.requireUser,
    },
    (request: FastifyRequest, reply) =>
      mutate(request, reply, 'submit', (client, scope, user, id) =>
        submitRequirement(client, scope, user, id, app.now()),
      ),
  );

  r.post(
    '/requirements/:id/approve',
    {
      schema: { tags: [TAG], params: RequirementIdParams, response: { 200: RequirementDetail } },
      preHandler: app.requireUser,
    },
    (request: FastifyRequest, reply) =>
      mutate(request, reply, 'approve', (client, scope, user, id) =>
        approveRequirement(client, scope, user, id, app.now()),
      ),
  );

  r.post(
    '/requirements/:id/reject',
    {
      schema: {
        tags: [TAG],
        params: RequirementIdParams,
        body: RejectRequirementRequest,
        response: { 200: RequirementDetail },
      },
      preHandler: app.requireUser,
    },
    (request: FastifyRequest, reply) =>
      mutate(request, reply, 'reject', (client, scope, user, id) =>
        rejectRequirement(
          client,
          scope,
          user,
          id,
          request.body as RejectRequirementRequest,
          app.now(),
        ),
      ),
  );
}
