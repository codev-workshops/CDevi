'use client';

import { ActionBar, Brand, Button, Field, FocusLayout, Input, Notice } from '@cdevi/design-system';
import { useState } from 'react';

export type SignInError = 'credentials' | 'rate-limited' | 'origin';

export interface SignInFormProps {
  /** Where the form posts; the route handler sets the session cookie and redirects. */
  action?: string | undefined;
  error?: SignInError | undefined;
  next: string;
  /** `expired` shows the session-expired notice. */
  reason?: string | undefined;
}

export const CREDENTIALS_ERROR = 'Email or password is incorrect.';

export function SignInForm({ action = '/auth/sign-in', error, next, reason }: SignInFormProps) {
  const [pending, setPending] = useState(false);
  const credentialError = error === 'credentials' ? CREDENTIALS_ERROR : undefined;
  return (
    <FocusLayout brand={<Brand mark="සී" name="CDevi" wordmark="සීදේවි" />}>
      <h1>Sign in to CDevi</h1>
      {reason === 'expired' ? (
        <Notice tone="info">Your session expired. Sign in to continue.</Notice>
      ) : null}
      {error === 'rate-limited' ? (
        <Notice tone="error">Too many attempts. Try again in a minute.</Notice>
      ) : null}
      {error === 'origin' ? (
        <Notice tone="error">
          This sign-in request came from an unexpected origin. Open CDevi directly and try again.
        </Notice>
      ) : null}
      <form method="post" action={action} noValidate onSubmit={() => setPending(true)}>
        <input type="hidden" name="next" value={next} />
        <Field label="Email" htmlFor="sign-in-email">
          <Input id="sign-in-email" name="email" type="email" autoComplete="username" required />
        </Field>
        <Field label="Password" htmlFor="sign-in-password" error={credentialError}>
          <Input
            id="sign-in-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </Field>
        <ActionBar>
          <Button variant="saffron" type="submit" loading={pending}>
            Sign in
          </Button>
        </ActionBar>
      </form>
    </FocusLayout>
  );
}
