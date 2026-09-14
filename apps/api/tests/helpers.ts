import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { buildApp, type BuildOptions } from '../src/app';
import { FIXED_NOW, SEED_INGEST_TOKEN, SEED_PASSWORD } from './setup';

export { FIXED_NOW, SEED_INGEST_TOKEN, SEED_PASSWORD };
export const skipDb = Boolean(process.env['CDEVI_SKIP_DB_TESTS']);

export async function testApp(opts: Partial<BuildOptions> = {}): Promise<FastifyInstance> {
  const app = await buildApp({ now: () => FIXED_NOW, logger: false, ...opts });
  await app.ready();
  return app;
}

export function cookieOf(res: LightMyRequestResponse): string {
  const set = res.headers['set-cookie'];
  const first = Array.isArray(set) ? set[0] : set;
  if (!first) throw new Error('no Set-Cookie header');
  return first.split(';')[0]!;
}

export async function signIn(
  app: FastifyInstance,
  email: string,
  password = SEED_PASSWORD,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in',
    payload: { email, password },
    headers: { origin: 'http://localhost:3000' },
  });
  if (res.statusCode !== 204) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  return cookieOf(res);
}

export const asUser = (cookie: string, opts: InjectOptions): InjectOptions => ({
  ...opts,
  headers: { ...(opts.headers ?? {}), cookie, origin: 'http://localhost:3000' },
});

export const asIngest = (opts: InjectOptions, token = SEED_INGEST_TOKEN): InjectOptions => ({
  ...opts,
  headers: {
    ...(opts.headers ?? {}),
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
});

export const iso = (d: Date) => d.toISOString();
export const plus = (ms: number, from = FIXED_NOW) => new Date(from.getTime() + ms);
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
let n = 0;
export const uniq = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${(n++).toString(36)}`;
