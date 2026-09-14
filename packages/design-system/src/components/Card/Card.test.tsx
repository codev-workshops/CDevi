import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { List, ListRow } from './Card';

describe('List loading state', () => {
  it('marks the list busy and renders three skeleton rows instead of the empty text', () => {
    renderThemed(<List loading empty="Nothing here." />);
    const list = document.querySelector('.cd-list')!;
    expect(list).toHaveAttribute('aria-busy', 'true');
    expect(list.querySelectorAll('.cd-row.cd-skeleton')).toHaveLength(3);
    expect(screen.queryByText('Nothing here.')).toBeNull();
  });

  it('keeps existing rows while refreshing', () => {
    renderThemed(
      <List loading>
        <ListRow title="Keep me" />
      </List>,
    );
    expect(screen.getByText('Keep me')).toBeInTheDocument();
    expect(document.querySelector('.cd-list')).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelectorAll('.cd-skeleton')).toHaveLength(0);
  });

  it('shows the empty text when not loading and empty', () => {
    renderThemed(<List empty="Nothing here." />);
    expect(screen.getByText('Nothing here.')).toBeInTheDocument();
    expect(document.querySelector('.cd-list')).not.toHaveAttribute('aria-busy');
  });

  it('is accessible while loading', async () => {
    await expectAccessible(<List loading />);
  });
});
