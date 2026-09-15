import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { Button } from './Button';

describe('Button', () => {
  it('renders a real <button type="button"> with variant and size classes', () => {
    renderThemed(
      <Button variant="saffron" size="sm">
        Approve
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Approve' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn).toHaveClass('cd-btn', 'cd-saffron', 'cd-sm');
  });

  it('fires onClick with mouse, Enter and Space; not when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderThemed(<Button onClick={onClick}>Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });
    await user.click(btn);
    btn.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it('disabled button is not clickable', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderThemed(
      <Button disabled onClick={onClick}>
        No
      </Button>,
    );
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'No' })).toBeDisabled();
  });

  it('loading sets aria-busy and shows a hidden spinner', () => {
    renderThemed(<Button loading>Saving</Button>);
    const btn = screen.getByRole('button', { name: 'Saving' });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn.querySelector('.cd-spin')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps an explicit aria-disabled on a focusable button so the help text stays reachable', () => {
    renderThemed(
      <Button aria-disabled aria-describedby="why">
        Approve
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Approve' });
    expect(btn).toHaveAttribute('aria-disabled', 'true');
    expect(btn).toHaveAttribute('aria-describedby', 'why');
    expect(btn).toBeEnabled();
  });

  it('renders a link when href is given and marks disabled links aria-disabled', () => {
    renderThemed(
      <>
        <Button href="/runs">Runs</Button>
        <Button href="/x" disabled>
          Gone
        </Button>
      </>,
    );
    expect(screen.getByRole('link', { name: 'Runs' })).toHaveAttribute('href', '/runs');
    const gone = screen.getByRole('link', { name: 'Gone' });
    expect(gone).toHaveAttribute('aria-disabled', 'true');
    expect(gone).not.toHaveAttribute('href');
  });

  it('is accessible in both themes for every variant', async () => {
    await expectAccessible(
      <>
        <Button>Primary</Button>
        <Button variant="saffron">Saffron</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button disabled>Disabled</Button>
        <Button href="/a">Link</Button>
      </>,
    );
  });
});
