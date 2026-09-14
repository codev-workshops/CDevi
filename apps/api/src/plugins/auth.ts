import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { problems } from '../lib/problem';
import {
  resolvePrincipal,
  resolveSession,
  SESSION_COOKIE,
  type IngestionPrincipal,
  type SessionUser,
} from '../services/auth';

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
    principal?: IngestionPrincipal;
    sessionId?: string;
  }
  interface FastifyInstance {
    requireUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePrincipal: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    clearSessionCookie: (reply: FastifyReply) => void;
    setSessionCookie: (reply: FastifyReply, id: string) => void;
  }
}

export interface AuthPluginOptions {
  secureCookies: boolean;
  /** Origins allowed to make cookie-authenticated state-changing requests (CSRF defence, analysis S1). */
  allowedOrigins: string[];
}

export default fp<AuthPluginOptions>(async (app: FastifyInstance, opts) => {
  const cookieOpts = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: opts.secureCookies,
  };

  app.decorate('setSessionCookie', (reply: FastifyReply, id: string) => {
    reply.setCookie(SESSION_COOKIE, id, { ...cookieOpts, maxAge: 7 * 24 * 3600 });
  });
  app.decorate('clearSessionCookie', (reply: FastifyReply) => {
    reply.clearCookie(SESSION_COOKIE, cookieOpts);
  });

  app.decorate('requireUser', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    const id = request.cookies[SESSION_COOKIE];
    if (!id) throw problems.unauthenticated();
    const user = await resolveSession(app.pool, id, app.now());
    if (!user) {
      app.clearSessionCookie(reply);
      throw problems.unauthenticated('Your session has expired. Sign in again.');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.origin ?? originOf(request.headers.referer);
      const fetchSite = request.headers['sec-fetch-site'];
      const crossSite =
        fetchSite === 'cross-site' ||
        (origin !== undefined && !opts.allowedOrigins.includes(origin));
      if (crossSite) throw problems.forbidden('Cross-site requests are not allowed.');
    }
    request.user = user;
    request.sessionId = id;
  });

  app.decorate('requirePrincipal', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store');
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw problems.unauthenticated('Provide a Bearer token.');
    const principal = await resolvePrincipal(app.pool, token);
    if (!principal) throw problems.unauthenticated('Unknown or disabled ingestion token.');
    request.principal = principal;
  });
});

function originOf(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
