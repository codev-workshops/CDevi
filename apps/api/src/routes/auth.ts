import { Me, SignInRequest } from '@cdevi/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { problems } from '../lib/problem';
import { authenticate, buildMe, createSession, revokeSession } from '../services/auth';

export interface AuthRouteOptions {
  signInMax: number;
}

export default async function authRoutes(app: FastifyInstance, opts: AuthRouteOptions) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    '/auth/sign-in',
    {
      schema: { tags: ['auth'], body: SignInRequest, response: { 204: z.null() } },
      config: {
        rateLimit: {
          max: opts.signInMax,
          timeWindow: '1 minute',
          keyGenerator: (req) =>
            `${req.ip}|${String((req.body as { email?: string } | undefined)?.email ?? '').toLowerCase()}`,
        },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const user = await authenticate(app.pool, request.body.email, request.body.password);
      if (!user) throw problems.unauthenticated('Email or password is incorrect.');
      const id = await createSession(app.pool, user, app.now());
      app.setSessionCookie(reply, id);
      request.log.info({ userId: user.id }, 'signed in');
      return reply.code(204).send(null);
    },
  );

  r.post(
    '/auth/sign-out',
    { schema: { tags: ['auth'], response: { 204: z.null() } }, preHandler: app.requireUser },
    async (request, reply) => {
      if (request.sessionId) await revokeSession(app.pool, request.sessionId, app.now());
      app.clearSessionCookie(reply);
      return reply.code(204).send(null);
    },
  );

  r.get(
    '/auth/me',
    { schema: { tags: ['auth'], response: { 200: Me } }, preHandler: app.requireUser },
    async (request) => {
      return buildMe(app.pool, request.user!);
    },
  );
}
