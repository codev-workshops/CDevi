import {
  ApprovalCenterDetail,
  ApprovalCenterQuery,
  ApprovalCenterSnapshot,
  ApproveRequest,
  DecisionParams,
  DecisionResult,
  RejectRequest,
} from '@cdevi/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { problems } from '../lib/problem';
import {
  approvalCenterDetail,
  approvalCenterSnapshot,
  type CenterScope,
} from '../services/approval-center';
import { visibleProjects, type SessionUser } from '../services/auth';
import { applyDecision, type DecisionInput } from '../services/decisions';

export const scopeFor = async (app: FastifyInstance, user: SessionUser): Promise<CenterScope> => ({
  organizationId: user.organizationId,
  projectIds: (await visibleProjects(app.pool, user)).map((p) => p.id),
  role: user.role,
});

/** Runs one decision and returns the refreshed detail — shared by the approval and clarification routes. */
export async function decide(
  app: FastifyInstance,
  request: FastifyRequest,
  input: DecisionInput,
): Promise<DecisionResult> {
  const { id } = request.params as DecisionParams;
  const user = request.user!;
  const scope = await scopeFor(app, user);
  const detail = await app.tx(
    { organizationId: user.organizationId, userId: user.id },
    async (client) => {
      const itemId = await applyDecision(client, user, scope, id, input, app.now());
      return approvalCenterDetail(client, scope, itemId);
    },
  );
  if (!detail) throw problems.notFound("This item isn't available to you.");
  request.log.info(
    { userId: user.id, itemId: id, decision: input.kind, workflowState: detail.workflowState },
    'human decision',
  );
  return { detail };
}

export default async function approvalRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    '/approvals',
    {
      schema: {
        tags: ['approvals'],
        querystring: ApprovalCenterQuery,
        response: { 200: ApprovalCenterSnapshot },
      },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest, reply) => {
      const { project } = request.query as ApprovalCenterQuery;
      const user = request.user!;
      const started = performance.now();
      const scope = await scopeFor(app, user);
      if (project !== 'all' && !scope.projectIds.includes(project))
        throw problems.notFound("This project isn't available to you.");
      const snapshot = await approvalCenterSnapshot(app.pool, scope, project, app.now());
      reply.header('server-timing', `approvals;dur=${(performance.now() - started).toFixed(1)}`);
      request.log.info(
        { userId: user.id, project, items: snapshot.items.length },
        'approval center snapshot',
      );
      return snapshot;
    },
  );

  r.get(
    '/approvals/:id',
    {
      schema: {
        tags: ['approvals'],
        params: DecisionParams,
        response: { 200: ApprovalCenterDetail },
      },
      preHandler: app.requireUser,
    },
    async (request: FastifyRequest, reply) => {
      const { id } = request.params as DecisionParams;
      const user = request.user!;
      const started = performance.now();
      const scope = await scopeFor(app, user);
      const detail = await app.tx(
        { organizationId: user.organizationId, userId: user.id, isolation: 'REPEATABLE READ' },
        (client) => approvalCenterDetail(client, scope, id),
      );
      if (!detail) throw problems.notFound("This item isn't available to you.");
      reply.header('server-timing', `approval;dur=${(performance.now() - started).toFixed(1)}`);
      return detail;
    },
  );

  r.post(
    '/approvals/:id/approve',
    {
      schema: {
        tags: ['approvals'],
        params: DecisionParams,
        body: ApproveRequest,
        response: { 200: DecisionResult },
      },
      preHandler: app.requireUser,
    },
    (request: FastifyRequest) =>
      decide(app, request, { kind: 'approve', body: request.body as ApproveRequest }),
  );

  r.post(
    '/approvals/:id/reject',
    {
      schema: {
        tags: ['approvals'],
        params: DecisionParams,
        body: RejectRequest,
        response: { 200: DecisionResult },
      },
      preHandler: app.requireUser,
    },
    (request: FastifyRequest) =>
      decide(app, request, { kind: 'reject', body: request.body as RejectRequest }),
  );
}
