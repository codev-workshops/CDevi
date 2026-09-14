import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InboxPanel } from '../../app/(app)/inbox/InboxPanel';
import { expectNoViolations, renderApp } from '../a11y';
import { snapshot } from '../fixtures/snapshot';

describe('Inbox · Today panel (US4, FR-017, FR-018)', () => {
  it('renders the four linked counts and the policy line', () => {
    const s = snapshot();
    renderApp(<InboxPanel today={s.today} policySummary={s.policySummary} />);
    const today = screen.getByLabelText('Today');
    const link = (name: string) => within(today).getByRole('link', { name });
    expect(link('9')).toHaveAttribute('href', '/inbox?tab=running&project=all');
    expect(link('5')).toHaveAttribute('href', '/inbox?tab=done&project=all');
    expect(link('3')).toHaveAttribute('href', '/approvals?decided=today&project=all');
    expect(link(String(s.counts.needsYou))).toHaveAttribute(
      'href',
      '/inbox?tab=needsYou&project=all',
    );
    expect(today).toHaveTextContent(/Runs started/);
    expect(today).toHaveTextContent(/Completed/);
    expect(today).toHaveTextContent(/Approvals decided/);
    expect(today).toHaveTextContent(/Needs you/);
    const policy = screen.getByLabelText('Workspace policy');
    expect(policy).toHaveTextContent(
      'Pull request merges and all HIGH/CRITICAL actions require human approval.',
    );
    expect(within(policy).getByRole('link', { name: 'Policies' })).toHaveAttribute(
      'href',
      '/policies',
    );
  });

  it('shows zeros rather than hiding rows', () => {
    const s = snapshot();
    const zero = { value: 0, href: '/x' };
    renderApp(
      <InboxPanel
        today={{
          ...s.today,
          workflowsStarted: zero,
          workflowsCompleted: zero,
          approvalsDecided: zero,
          needsYou: zero,
        }}
        policySummary={s.policySummary}
      />,
    );
    expect(within(screen.getByLabelText('Today')).getAllByRole('link', { name: '0' })).toHaveLength(
      4,
    );
  });

  it('is accessible', async () => {
    const s = snapshot();
    const { container } = renderApp(<InboxPanel today={s.today} policySummary={s.policySummary} />);
    await expectNoViolations(container);
  });
});
