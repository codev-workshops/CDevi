import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignInForm } from '../../app/(auth)/sign-in/SignInForm';
import { safeNext } from '../../lib/safe-next';
import { expectNoViolations, renderApp } from '../a11y';

describe('Sign in (FR-004, ui-inbox-screen.md §3)', () => {
  it('renders FocusLayout, a POST form to the sign-in route, labelled fields with autocomplete, and exactly one saffron button', () => {
    const { container } = renderApp(<SignInForm next="/inbox" />);
    expect(screen.getByRole('main')).toHaveClass('cd-focus');
    expect(screen.getByRole('heading', { name: 'Sign in to CDevi' })).toBeInTheDocument();
    const form = container.querySelector('form')!;
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/auth/sign-in');
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    expect(pw).toHaveAttribute('autocomplete', 'current-password');
    expect(container.querySelectorAll('.cd-btn.cd-saffron')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
    expect(container.querySelector('input[name="next"]')).toHaveValue('/inbox');
  });

  it('shows the identical credentials error as an alert on the password field', () => {
    renderApp(<SignInForm error="credentials" next="/inbox" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a rate-limit Notice', () => {
    renderApp(<SignInForm error="rate-limited" next="/inbox" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in a minute.',
    );
  });

  it('shows the session-expired notice when asked', () => {
    renderApp(<SignInForm next="/inbox" reason="expired" />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your session expired. Sign in to continue.',
    );
  });

  it('only honours same-origin relative paths for ?next=', () => {
    expect(safeNext('/inbox?tab=running')).toBe('/inbox?tab=running');
    expect(safeNext('//evil.example/x')).toBe('/inbox');
    expect(safeNext('https://evil.example')).toBe('/inbox');
    expect(safeNext(undefined)).toBe('/inbox');
    expect(safeNext('/sign-in')).toBe('/inbox');
  });

  it('is accessible in every state', async () => {
    for (const error of [undefined, 'credentials', 'rate-limited', 'origin'] as const) {
      const { container, unmount } = renderApp(<SignInForm error={error} next="/inbox" />);
      await expectNoViolations(container);
      unmount();
    }
  });
});
