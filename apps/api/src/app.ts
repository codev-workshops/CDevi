import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import { buildFullOpenApi } from '@cdevi/contracts/openapi';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { errorHandler } from './lib/problem';
import authPlugin from './plugins/auth';
import dbPlugin from './plugins/db';
import notifyPlugin from './plugins/notify';
import authRoutes from './routes/auth';
import healthRoutes from './routes/health';
import inboxRoutes from './routes/inbox';
import ingestRoutes from './routes/ingest';
import workflowRoutes from './routes/workflows';

export interface BuildOptions {
  /** Injected clock (Constitution II: time is controlled in tests). */
  now: () => Date;
  logger?: boolean | object | undefined;
  pool?: pg.Pool | undefined;
  rateLimit?: { signInMax?: number | undefined } | undefined;
  secureCookies?: boolean | undefined;
  allowedOrigins?: string[] | undefined;
  notify?: boolean | undefined;
  /** SSE heartbeat interval (tests shorten it). */
  heartbeatMs?: number | undefined;
}

declare module 'fastify' {
  interface FastifyInstance {
    now: () => Date;
  }
}

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const env = process.env['CDEVI_ENV'] ?? 'development';
  const app = Fastify({
    logger: opts.logger ?? {
      level: process.env['LOG_LEVEL'] ?? 'info',
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    trustProxy: true,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.decorate('now', opts.now);

  await app.register(cookie);
  // preHandler so per-route key generators can include the parsed body (sign-in keys on IP + email).
  await app.register(rateLimit, { global: false, hook: 'preHandler' });
  await app.register(swagger, {
    mode: 'static',
    specification: { document: buildFullOpenApi() as never },
  });
  await app.register(dbPlugin, { pool: opts.pool });
  await app.register(notifyPlugin, { enabled: opts.notify ?? true });
  await app.register(authPlugin, {
    secureCookies: opts.secureCookies ?? (env !== 'development' && env !== 'test'),
    allowedOrigins: opts.allowedOrigins ?? [
      process.env['WEB_ORIGIN'] ?? 'http://localhost:3000',
      process.env['API_ORIGIN'] ?? 'http://localhost:3001',
    ],
  });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { signInMax: opts.rateLimit?.signInMax ?? 5 });
      await api.register(inboxRoutes, { heartbeatMs: opts.heartbeatMs });
      await api.register(ingestRoutes);
      await api.register(workflowRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
