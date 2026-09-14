import { NextResponse, type NextRequest } from 'next/server';

/** Exposes the pathname to server layouts (panel slot, sign-in `next=`); nothing else happens here. */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-pathname', request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ['/((?!_next|api|auth|favicon.ico).*)'] };
