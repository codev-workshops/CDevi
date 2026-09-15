import { AnswerRequest, DecisionParams, DecisionResult } from '@cdevi/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { decide } from './approvals';

export default async function clarificationRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/clarifications/:id/answer',
    {
      schema: {
        tags: ['approvals'],
        params: DecisionParams,
        body: AnswerRequest,
        response: { 200: DecisionResult },
      },
      preHandler: app.requireUser,
    },
    (request: FastifyRequest) =>
      decide(app, request, { kind: 'answer', body: request.body as AnswerRequest }),
  );
}
