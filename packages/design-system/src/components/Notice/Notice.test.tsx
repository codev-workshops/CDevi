import { screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { Button } from '../Button/Button';
import { Notice } from './Notice';

describe('Notice', () => {
  it('info tone is a polite status region', () => {
    renderThemed(<Notice tone="info">Your session expired.</Notice>);
    const el = screen.getByRole('status');
    expect(el).toHaveClass('cd-notice', 'cd-info');
    expect(el).toHaveTextContent('Your session expired.');
  });

  it('error tone is an alert', () => {
    renderThemed(<Notice tone="error">Couldn&apos;t load the Inbox.</Notice>);
    expect(screen.getByRole('alert')).toHaveClass('cd-notice', 'cd-error');
  });

  it('renders the action slot and forwards className and ref', () => {
    const ref = createRef<HTMLDivElement>();
    renderThemed(
      <Notice
        ref={ref}
        tone="error"
        className="extra"
        action={<Button variant="ghost">Retry</Button>}
      >
        Failed.
      </Notice>,
    );
    expect(
      screen.getByRole('button', { name: 'Retry' }).closest('.cd-notice-action'),
    ).not.toBeNull();
    expect(ref.current).toHaveClass('cd-notice', 'extra');
  });

  it('is accessible', async () => {
    await expectAccessible(
      <>
        <Notice tone="info">Demonstration data.</Notice>
        <Notice tone="error" action={<Button variant="ghost">Retry</Button>}>
          Couldn&apos;t load.
        </Notice>
      </>,
    );
  });
});
