import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Me } from '@cdevi/contracts';
import { AppFrame } from '../../app/(app)/AppFrame';
import { NAV_ITEMS, PLACEHOLDER_SECTIONS } from '../../lib/navigation';
import { expectNoViolations, renderApp } from '../a11y';
import { __nav } from '../mocks/next-navigation';

const me: Me = {
  user: {
    id: '00000000-0000-7000-8000-000000000001',
    displayName: 'Nadeesha Perera',
    role: 'approver',
  },
  organization: {
    id: '00000000-0000-7000-8000-000000000002',
    name: 'Acme Engineering',
    isDemo: true,
  },
  projects: [
    { id: '00000000-0000-7000-8000-000000000003', key: 'payments-api', name: 'Payments API' },
  ],
  canCreateRequirement: true,
};

describe('App shell (FR-001, FR-003, FR-030, ui-inbox-screen.md §1)', () => {
  it('renders the full shell with Inbox first, its pending count announced, and aria-current on the active route', () => {
    __nav.pathname = '/inbox';
    renderApp(
      <AppFrame me={me} needsYouCount={5}>
        <p>content</p>
      </AppFrame>,
    );
    const nav = screen.getByRole('navigation');
    const links = within(nav).getAllByRole('link');
    expect(links[0]).toHaveTextContent('Inbox');
    expect(links[0]).toHaveAttribute('href', '/inbox');
    expect(links[0]).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByLabelText(/5 pending/)).toBeInTheDocument();
    expect(links.map((l) => l.textContent?.replace(/\d+ pending|\d+/g, '').trim())).toEqual(
      NAV_ITEMS.map((n) => n.label),
    );
    expect(within(nav).getByText('Administration')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('content');
    expect(document.querySelector('.cd-app')).toHaveClass('cd-full');
  });

  it('shows organisation and user in the side footer with a Sign out button', () => {
    renderApp(
      <AppFrame me={me} needsYouCount={0}>
        <p>content</p>
      </AppFrame>,
    );
    expect(screen.getByText(/Acme Engineering · Nadeesha Perera/)).toBeInTheDocument();
    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut.closest('form')).toHaveAttribute('action', '/api/auth/sign-out');
    expect(signOut.closest('form')).toHaveAttribute('method', 'post');
  });

  it('renders the panel only when given one', () => {
    const { rerender } = renderApp(
      <AppFrame me={me} needsYouCount={0}>
        <p>content</p>
      </AppFrame>,
    );
    expect(screen.queryByRole('complementary', { name: 'Details' })).toBeNull();
    rerender(
      <AppFrame me={me} needsYouCount={0} panel={<p>side</p>}>
        <p>content</p>
      </AppFrame>,
    );
    expect(screen.getByRole('complementary', { name: 'Details' })).toHaveTextContent('side');
  });

  it('FR-032 /agents remains a placeholder section and /agents/runs/{id} is not a nav item but highlights Agents', () => {
    expect(PLACEHOLDER_SECTIONS.agents).toBe('Agents');
    expect(NAV_ITEMS.some((n) => n.href.startsWith('/agents/'))).toBe(false);
    __nav.pathname = '/agents/runs/00000000-0000-7000-8000-000000000009';
    renderApp(
      <AppFrame me={me} needsYouCount={0}>
        <p>content</p>
      </AppFrame>,
    );
    const nav = screen.getByRole('navigation');
    const current = within(nav)
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current'));
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Agents');
    expect(current[0]).toHaveAttribute('href', '/agents');
  });

  it('is accessible', async () => {
    const { container } = renderApp(
      <AppFrame me={me} needsYouCount={12} panel={<p>side</p>}>
        <h1>Inbox</h1>
      </AppFrame>,
    );
    await expectNoViolations(container);
  });
});
