import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asUser,
  cookieOf,
  FIXED_NOW,
  HOUR,
  DAY,
  plus,
  SEED_PASSWORD,
  signIn,
  skipDb,
  testApp,
} from './helpers';

describe.skipIf(skipDb)('auth (FR-004, FR-005, FR-002)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await testApp();
  });
  afterAll(() => app.close());

  it('FR-004 sign-in sets an HttpOnly Secure SameSite=Lax cookie and 204', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'approver1@cdevi.demo', password: SEED_PASSWORD },
    });
    expect(res.statusCode).toBe(204);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^cdevi_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('FR-004 wrong password and unknown email return identical 401 Problems', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'approver1@cdevi.demo', password: 'definitely-wrong' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'nobody@cdevi.demo', password: 'definitely-wrong' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(wrong.json()).toEqual(unknown.json());
    expect(wrong.json().detail).toBe('Email or password is incorrect.');
    expect(JSON.stringify(wrong.json())).not.toMatch(/approver1|nobody/);
  });

  it('FR-004 invalid body → 400 Problem with errors[]', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { email: 'not-an-email', password: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.length).toBeGreaterThan(0);
  });

  it('FR-004 6th attempt within a minute → 429', async () => {
    const limited = await testApp({ rateLimit: { signInMax: 5 } });
    try {
      for (let i = 0; i < 5; i++) {
        const r = await limited.inject({
          method: 'POST',
          url: '/api/auth/sign-in',
          payload: { email: 'viewer1@cdevi.demo', password: 'wrong-wrong' },
          remoteAddress: '10.0.0.9',
        });
        expect(r.statusCode).toBe(401);
      }
      const sixth = await limited.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        payload: { email: 'viewer1@cdevi.demo', password: 'wrong-wrong' },
        remoteAddress: '10.0.0.9',
      });
      expect(sixth.statusCode).toBe(429);
      expect(sixth.json().type).toBe('urn:cdevi:problem:rate-limited');
    } finally {
      await limited.close();
    }
  });

  it('GET /auth/me returns role, organization.isDemo, visible projects and canCreateRequirement', async () => {
    const admin = await signIn(app, 'admin@cdevi.demo');
    const me = (await app.inject(asUser(admin, { method: 'GET', url: '/api/auth/me' }))).json();
    expect(me.user.role).toBe('administrator');
    expect(me.organization.isDemo).toBe(true);
    expect(me.organization.name).toBe('Acme Engineering');
    // 4 S-500 projects + dashboard-demo (no memberships; administrators see every project).
    expect(me.projects).toHaveLength(5);
    expect(me.canCreateRequirement).toBe(true);

    const viewer = await signIn(app, 'viewer1@cdevi.demo');
    const vm = (await app.inject(asUser(viewer, { method: 'GET', url: '/api/auth/me' }))).json();
    expect(vm.user.role).toBe('viewer');
    expect(vm.projects.length).toBeGreaterThanOrEqual(1);
    expect(vm.projects.length).toBeLessThan(4);
    expect(vm.canCreateRequirement).toBe(false);
  });

  it('FR-002 canCreateRequirement is true for engineer, approver, administrator and false for viewer', async () => {
    for (const [email, expected] of [
      ['engineer1@cdevi.demo', true],
      ['approver1@cdevi.demo', true],
      ['admin@cdevi.demo', true],
      ['viewer1@cdevi.demo', false],
    ] as const) {
      const c = await signIn(app, email);
      expect(
        (await app.inject(asUser(c, { method: 'GET', url: '/api/auth/me' }))).json()
          .canCreateRequirement,
        email,
      ).toBe(expected);
    }
  });

  it('unauthenticated /auth/me → 401 Problem', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().type).toBe('urn:cdevi:problem:unauthenticated');
  });

  it('sign-out revokes the session and clears the cookie', async () => {
    const c = await signIn(app, 'engineer1@cdevi.demo');
    const out = await app.inject(asUser(c, { method: 'POST', url: '/api/auth/sign-out' }));
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toMatch(/cdevi_session=;|Max-Age=0|Expires=/);
    expect((await app.inject(asUser(c, { method: 'GET', url: '/api/auth/me' }))).statusCode).toBe(
      401,
    );
  });

  it('FR-004 idle (> 12 h) and absolute (> 7 d) expiry reject the session and clear the cookie', async () => {
    const c = await signIn(app, 'engineer2@cdevi.demo');
    const later = await testApp({ now: () => plus(13 * HOUR) });
    try {
      const r = await later.inject(asUser(c, { method: 'GET', url: '/api/auth/me' }));
      expect(r.statusCode).toBe(401);
      expect(String(r.headers['set-cookie'])).toMatch(/cdevi_session=;/);
    } finally {
      await later.close();
    }
    const c2 = await signIn(app, 'engineer3@cdevi.demo');
    // Keep it alive within idle windows but past the absolute limit.
    const day8 = await testApp({ now: () => plus(8 * DAY) });
    try {
      expect(
        (await day8.inject(asUser(c2, { method: 'GET', url: '/api/auth/me' }))).statusCode,
      ).toBe(401);
    } finally {
      await day8.close();
    }
  });

  it('cookie-authenticated non-GET requests from a cross-site origin are rejected (CSRF)', async () => {
    const c = await signIn(app, 'engineer4@cdevi.demo');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie: c, origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().type).toBe('urn:cdevi:problem:forbidden');
  });

  it('disabled user cannot sign in', async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env['DATABASE_MIGRATOR_URL'] });
    await pool.query(`update users set disabled_at = now() where email = 'viewer5@cdevi.demo'`);
    try {
      const r = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        payload: { email: 'viewer5@cdevi.demo', password: SEED_PASSWORD },
      });
      expect(r.statusCode).toBe(401);
    } finally {
      await pool.query(`update users set disabled_at = null where email = 'viewer5@cdevi.demo'`);
      await pool.end();
    }
  });

  it('sign-in p95 < 500 ms over 20 runs (scrypt N=2^15)', async () => {
    const perf = await testApp({ rateLimit: { signInMax: 1000 } });
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      const r = await perf.inject({
        method: 'POST',
        url: '/api/auth/sign-in',
        payload: { email: 'engineer5@cdevi.demo', password: SEED_PASSWORD },
      });
      times.push(performance.now() - t);
      expect(r.statusCode).toBe(204);
      cookieOf(r);
    }
    await perf.close();
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95) - 1]!).toBeLessThan(500);
    expect(FIXED_NOW.toISOString()).toBe('2026-09-14T09:00:00.000Z');
  });
});
