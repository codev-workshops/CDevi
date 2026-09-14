import { SignInRequest } from '@cdevi/contracts';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { apiBase, API_TIMEOUT_MS } from '../../../lib/api';
import { safeNext } from '../../../lib/safe-next';

/**
 * Sign-in form post (research R2). A route handler rather than a Server Action so the flow also works behind
 * local preview proxies / reverse proxies where the browser Origin differs from the forwarded Host.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const next = safeNext(String(form.get('next') ?? ''));
  const back = (error: string) =>
    NextResponse.redirect(
      new URL(`/sign-in?error=${error}&next=${encodeURIComponent(next)}`, request.url),
      303,
    );

  if (!originAllowed(request)) return back('origin');

  const parsed = SignInRequest.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) return back('credentials');

  const res = await fetch(`${apiBase()}/api/auth/sign-in`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: process.env['WEB_ORIGIN'] ?? 'http://localhost:3000',
    },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (res.status === 429) return back('rate-limited');
  if (res.status !== 204) return back('credentials');

  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = /^cdevi_session=([^;]+)/.exec(setCookie);
  if (!match) return back('credentials');
  const jar = await cookies();
  jar.set('cdevi_session', match[1]!, {
    httpOnly: true,
    sameSite: 'lax',
    secure: /;\s*Secure/i.test(setCookie),
    path: '/',
    maxAge: 7 * 24 * 3600,
  });
  return NextResponse.redirect(new URL(next, request.url), 303);
}

/** Login-CSRF guard: Origin must be the configured web origin (or any loopback origin outside production). */
function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin form posts from older UAs; the API has its own checks
  const allowed = new Set(
    [
      process.env['WEB_ORIGIN'] ?? 'http://localhost:3000',
      ...(process.env['CDEVI_ALLOWED_ORIGINS'] ?? '').split(','),
    ].filter(Boolean),
  );
  if (allowed.has(origin)) return true;
  const env = process.env['CDEVI_ENV'] ?? 'development';
  if (env !== 'production') {
    try {
      const host = new URL(origin).hostname;
      return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    } catch {
      return false;
    }
  }
  return false;
}
