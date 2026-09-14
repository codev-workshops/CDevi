import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getMe } from '../../../lib/session';
import { safeNext } from '../../../lib/safe-next';
import { SignInForm, type SignInError } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

const ERRORS = new Set<SignInError>(['credentials', 'rate-limited', 'origin']);

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(typeof params['next'] === 'string' ? params['next'] : undefined);
  if (await getMe()) redirect(next);
  const reason = typeof params['reason'] === 'string' ? params['reason'] : undefined;
  const raw = typeof params['error'] === 'string' ? params['error'] : undefined;
  const error = raw && ERRORS.has(raw as SignInError) ? (raw as SignInError) : undefined;
  return <SignInForm error={error} next={next} reason={reason} />;
}
