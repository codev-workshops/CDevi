import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NewRequirementButton } from '../../app/(app)/inbox/NewRequirementButton';
import { expectNoViolations, renderApp } from '../a11y';

describe('New requirement (US3, FR-002)', () => {
  it('is an enabled saffron link for roles that may create requirements', () => {
    const { container } = renderApp(<NewRequirementButton canCreate userRole="engineer" />);
    const link = screen.getByRole('link', { name: 'New requirement' });
    expect(link).toHaveAttribute('href', '/requirements/new');
    expect(link).toHaveClass('cd-saffron');
    expect(container.querySelectorAll('.cd-saffron')).toHaveLength(1);
    expect(screen.queryByText(/cannot create requirements/)).toBeNull();
  });

  it('is disabled with an explanation for viewers, and still the only saffron control', () => {
    const { container } = renderApp(<NewRequirementButton canCreate={false} userRole="viewer" />);
    const btn = screen.getByText('New requirement');
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).not.toHaveAttribute('href');
    const help = screen.getByText('Your role (Viewer) cannot create requirements.');
    expect(btn.getAttribute('aria-describedby')).toBe(help.id);
    expect(container.querySelectorAll('.cd-saffron')).toHaveLength(1);
  });

  it('is accessible in both states', async () => {
    for (const canCreate of [true, false]) {
      const { container, unmount } = renderApp(
        <NewRequirementButton canCreate={canCreate} userRole={canCreate ? 'approver' : 'viewer'} />,
      );
      await expectNoViolations(container);
      unmount();
    }
  });
});
