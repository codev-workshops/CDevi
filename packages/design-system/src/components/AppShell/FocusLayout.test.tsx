import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { Brand, FocusLayout } from './AppShell';

describe('FocusLayout', () => {
  it('renders a main landmark with the focus classes, a brand slot and one card', () => {
    renderThemed(
      <FocusLayout brand={<Brand mark="සී" name="CDevi" />}>
        <h1>Sign in</h1>
      </FocusLayout>,
    );
    const main = screen.getByRole('main');
    expect(main).toHaveClass('cd-root', 'cd-focus');
    expect(main.querySelector('.cd-brand')).not.toBeNull();
    expect(main.querySelectorAll('.cd-card')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Sign in' }).closest('.cd-card')).not.toBeNull();
  });

  it('is accessible', async () => {
    await expectAccessible(
      <FocusLayout brand={<Brand mark="සී" name="CDevi" />}>
        <h1>Sign in</h1>
      </FocusLayout>,
    );
  });
});
