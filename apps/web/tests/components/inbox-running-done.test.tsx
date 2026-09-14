import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxScreen } from '../../app/(app)/inbox/InboxScreen';
import { expectNoViolations, renderApp } from '../a11y';
import { doneItems, me, runningItems, snapshot } from '../fixtures/snapshot';

beforeEach(() => {
  vi.stubGlobal(
    'EventSource',
    class {
      addEventListener() {}
      close() {}
    },
  );
});

describe('Inbox · Running and Done (US2)', () => {
  it('FR-014 FR-016 running rows are non-gate rows linking to the workflow, with the exact state word, stage and elapsed time; QUEUED shows queued age', () => {
    renderApp(
      <InboxScreen
        me={me}
        initial={snapshot({
          tab: 'running',
          items: runningItems,
          counts: { needsYou: 7, running: 100, done: 305 },
        })}
      />,
    );
    expect(screen.getByRole('tab', { name: /Running/ })).toHaveAttribute('aria-selected', 'true');
    const rows = within(screen.getByRole('list', { name: 'Running' })).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r).not.toHaveClass('cd-gate');
      expect(r).not.toHaveAttribute('aria-describedby');
    }
    expect(within(rows[0]!).getByText('running')).toHaveClass('cd-run');
    expect(rows[0]).toHaveTextContent(
      /payments-api · Implementation Agent · stage 2 of 7 · Implementation · 12 m/,
    );
    expect(within(rows[1]!).getByText('retrying')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('waiting')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('queued')).toBeInTheDocument();
    expect(rows[3]).toHaveTextContent(/queued 5 min ago/);
    expect(within(rows[0]!).getByRole('link')).toHaveAttribute('href', runningItems[0]!.href);
  });

  it('FR-015 FR-016 done rows show completed / struck-through cancelled, finish age and PR reference', () => {
    renderApp(
      <InboxScreen
        me={me}
        initial={snapshot({
          tab: 'done',
          items: doneItems,
          counts: { needsYou: 7, running: 100, done: 305 },
        })}
      />,
    );
    const rows = within(screen.getByRole('list', { name: 'Done' })).getAllByRole('listitem');
    expect(within(rows[0]!).getByText('completed')).toHaveClass('cd-done');
    expect(rows[0]).toHaveTextContent(/completed 2 h ago · PR #412/);
    expect(within(rows[1]!).getByText('cancelled')).toHaveClass('cd-cancelled');
    expect(rows[1]).toHaveTextContent(/cancelled 1 d ago/);
    expect(screen.getByRole('tab', { name: /Running/ })).toHaveAccessibleName(/Running.*100/);
    expect(screen.getByRole('tab', { name: /Done/ })).toHaveAccessibleName(/Done.*305/);
  });

  it('shows the per-tab empty texts', () => {
    const { unmount } = renderApp(
      <InboxScreen
        me={me}
        initial={snapshot({
          tab: 'running',
          items: [],
          counts: { needsYou: 0, running: 0, done: 0 },
        })}
      />,
    );
    expect(screen.getByText('No workflows are running.')).toBeInTheDocument();
    unmount();
    renderApp(
      <InboxScreen
        me={me}
        initial={snapshot({ tab: 'done', items: [], counts: { needsYou: 0, running: 0, done: 0 } })}
      />,
    );
    expect(screen.getByText('Nothing finished in the last 7 days.')).toBeInTheDocument();
  });

  it('is accessible', async () => {
    for (const s of [
      snapshot({ tab: 'running', items: runningItems }),
      snapshot({ tab: 'done', items: doneItems }),
    ]) {
      const { container, unmount } = renderApp(<InboxScreen me={me} initial={s} />);
      await expectNoViolations(container);
      unmount();
    }
  });
});
