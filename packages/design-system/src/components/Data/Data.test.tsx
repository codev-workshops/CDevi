import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectAccessible } from '../../test/a11y';
import { renderThemed } from '../../test/render';
import { Bars, KeyValue, Meter, Stat, StatGrid, Table } from './Data';

const rows = [
  { id: '1', task: 'Limiter', cost: '$1.12' },
  { id: '2', task: 'Redis', cost: '$2.38' },
];
const columns = [
  { key: 'task', header: 'Task', cell: (r: (typeof rows)[number]) => r.task },
  {
    key: 'cost',
    header: 'Cost',
    cell: (r: (typeof rows)[number]) => r.cost,
    align: 'end' as const,
  },
];

describe('Data components', () => {
  it('Table has a caption and column scopes; empty state spans columns', () => {
    renderThemed(
      <>
        <Table caption="Runs" columns={columns} rows={rows} rowKey={(r) => r.id} />
        <Table caption="None" hideCaption columns={columns} rows={[]} rowKey={(r) => r.id} />
      </>,
    );
    expect(screen.getByRole('table', { name: 'Runs' })).toHaveClass('cd-table');
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('scope', 'col');
    expect(screen.getByText('No rows.')).toHaveAttribute('colspan', '2');
    expect(screen.getByText('None')).toHaveClass('cd-visually-hidden');
  });

  it('Meter exposes role=meter with value range and sets the custom property', () => {
    renderThemed(<Meter label="Model cost" value={1.12} max={5} />);
    const m = screen.getByRole('meter', { name: 'Model cost' });
    expect(m).toHaveAttribute('aria-valuenow', '1.12');
    expect(m).toHaveAttribute('aria-valuemax', '5');
    expect((m.firstElementChild as HTMLElement).style.getPropertyValue('--cd-meter-value')).toBe(
      '22.400000000000002%',
    );
  });

  it('Bars is an image with a label and sets bar heights', () => {
    renderThemed(<Bars label="Cost by day" values={[{ value: 5 }, { value: 10, local: true }]} />);
    const img = screen.getByRole('img', { name: 'Cost by day' });
    const bars = img.querySelectorAll('i');
    expect(bars[0]!.style.getPropertyValue('--cd-bar-value')).toBe('50%');
    expect(bars[1]).toHaveClass('cd-local');
  });

  it('Stat groups value and label; StatGrid sets data-columns', () => {
    renderThemed(
      <StatGrid columns={4}>
        <Stat value="18" label="Active workflows" />
      </StatGrid>,
    );
    expect(screen.getByText('18').closest('p')).toHaveTextContent('18 Active workflows');
    expect(screen.getByText('18').closest('.cd-stat-grid')).toHaveAttribute('data-columns', '4');
  });

  it('is accessible', async () => {
    await expectAccessible(
      <>
        <KeyValue items={[{ term: 'Base', detail: 'main' }]} />
        <Table caption="Runs" columns={columns} rows={rows} rowKey={(r) => r.id} />
        <Meter label="Minutes" value={14} max={120} muted />
        <Bars label="Bars" values={[{ value: 1 }]} />
        <StatGrid>
          <Stat value="5" label="Verified" />
        </StatGrid>
      </>,
    );
  });
});
