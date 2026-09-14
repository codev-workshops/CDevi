import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InboxScreen } from '../../app/(app)/inbox/InboxScreen';
import { expectNoViolations, renderApp } from '../a11y';
import { me, needsYouItems, snapshot } from '../fixtures/snapshot';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal(
    'EventSource',
    class {
      onmessage = null;
      addEventListener() {}
      close() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

describe('Inbox · Needs you (US1)', () => {
  it('FR-007 FR-024 renders every needs-you row as a gate ListRow with state word in a pill, badges, ask and meta', () => {
    renderApp(<InboxScreen me={me} initial={snapshot()} />);
    const list = screen.getByRole('list', { name: 'Needs you' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(needsYouItems.length);
    for (const row of rows) expect(row).toHaveClass('cd-gate');

    const critical = rows[0]!;
    expect(within(critical).getByRole('link', { name: 'Rotate signing keys' })).toHaveAttribute(
      'href',
      needsYouItems[0]!.href,
    );
    expect(within(critical).getByText('needs you')).toHaveClass('cd-pill');
    expect(within(critical).getByText('critical risk')).toBeInTheDocument();
    expect(critical.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(critical.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Approve: rotate production signing keys',
    );
    expect(critical).toHaveTextContent(
      /payments-api · Implementation Agent · asked 40 min ago · times out in 3 h 56 m/,
    );

    const high = rows[1]!;
    expect(within(high).getByText('main').tagName).toBe('CODE');
    expect(within(high).getByText('high risk')).toBeInTheDocument();

    const stale = rows[2]!;
    expect(within(stale).getByText('stale')).toHaveClass('cd-pill');
    expect(within(stale).getByText('medium risk')).toBeInTheDocument();

    const expired = rows[3]!;
    expect(within(expired).getByText('expired')).toHaveClass('cd-pill');
    expect(within(expired).getByText('low risk')).toBeInTheDocument();

    const clarification = rows[4]!;
    expect(within(clarification).getByText('needs you')).toBeInTheDocument();
    expect(within(clarification).queryByText(/risk$/)).toBeNull();
    expect(within(clarification).getByText('recommended answer')).toHaveClass('cd-pill');
    expect(within(clarification).getByRole('link')).toHaveAttribute('href', needsYouItems[4]!.href);

    const blocked = rows[5]!;
    expect(within(blocked).getByText('blocked')).toHaveClass('cd-blocked');
    expect(blocked).toHaveTextContent('Blocked: issue tracker unreachable');
    expect(blocked).toHaveTextContent(/blocked 10 min ago/);
    expect(within(blocked).getByRole('link')).toHaveAttribute(
      'href',
      `/workflows/${needsYouItems[5]!.workflowId}`,
    );

    const failed = rows[6]!;
    expect(within(failed).getByText('failed')).toHaveClass('cd-fail');
    expect(failed).toHaveTextContent('Failed at Testing: 3 unit tests failing');
    expect(failed).toHaveTextContent(/failed 3 d ago/);
  });

  it('FR-002 FR-013 FR-022 FR-028 has exactly one saffron button, the project selector, the demonstration pill and tab counts', () => {
    const { container } = renderApp(<InboxScreen me={me} initial={snapshot()} />);
    expect(container.querySelectorAll('.cd-btn.cd-saffron')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'New requirement' })).toHaveAttribute(
      'href',
      '/requirements/new',
    );
    const select = screen.getByLabelText('Project');
    expect(select.tagName).toBe('SELECT');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All projects', 'Payments API', 'Web App']);
    expect(screen.getByText('demonstration data')).toHaveClass('cd-pill');
    expect(screen.getByRole('tab', { name: /Needs you/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Needs you/ })).toHaveTextContent(
      String(needsYouItems.length),
    );
    expect(screen.getByRole('tab', { name: /Running/ })).toHaveTextContent('100');
    expect(screen.getByRole('tab', { name: /Done/ })).toHaveTextContent('305');
    // FR-012: no inline decision controls
    expect(screen.queryByRole('button', { name: /approve|reject|answer/i })).toBeNull();
  });

  it('shows the empty state for all projects and for a selected project', () => {
    renderApp(
      <InboxScreen
        me={me}
        initial={snapshot({ items: [], counts: { needsYou: 0, running: 3, done: 5 } })}
      />,
    );
    expect(screen.getByText(/Nothing needs you right now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Running' })).toBeInTheDocument();
  });

  it('shows the project-scoped empty state with a reset link', () => {
    renderApp(
      <InboxScreen
        me={me}
        initial={snapshot({
          items: [],
          project: me.projects[0]!.id,
          counts: { needsYou: 0, running: 3, done: 5 },
        })}
      />,
    );
    expect(screen.getByText(/Nothing needs you in/)).toHaveTextContent('payments-api');
    expect(screen.getByRole('button', { name: /all projects/i })).toBeInTheDocument();
  });

  it('FR-025 shows the error Notice with Retry when a refetch fails, keeps the shell usable', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { type: 'urn:cdevi:problem:internal', title: 'Something went wrong', status: 500 },
        500,
      ),
    );
    renderApp(<InboxScreen me={me} initial={snapshot()} />);
    await userEvent.click(screen.getByRole('tab', { name: /Running/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the Inbox.");
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'New requirement' })).toBeInTheDocument();
    fetchMock.mockResolvedValueOnce(jsonResponse(snapshot({ tab: 'running', items: [] })));
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('FR-025 shows the loading skeleton (aria-busy) while the first snapshot for a scope loads', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    renderApp(<InboxScreen me={me} initial={snapshot()} />);
    await userEvent.selectOptions(screen.getByLabelText('Project'), me.projects[1]!.id);
    const list = document.querySelector('.cd-list')!;
    await waitFor(() => expect(list).toHaveAttribute('aria-busy', 'true'));
    expect(document.querySelectorAll('.cd-skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Nothing needs you/)).toBeNull();
    resolve(
      jsonResponse(
        snapshot({
          project: me.projects[1]!.id,
          items: [needsYouItems[4]!],
          counts: { needsYou: 1, running: 1, done: 1 },
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: /Needs you/ })).toHaveTextContent('1'),
    );
    expect(fetchMock.mock.calls[0]![0]).toContain(`project=${me.projects[1]!.id}`);
    expect(document.cookie).toContain(`cdevi_project=${me.projects[1]!.id}`);
  });

  it('Load more appends the next page and moves focus to the first new row', async () => {
    const more = {
      ...needsYouItems[1]!,
      workflowId: '00000000-0000-7000-8000-0000000000ff',
      title: 'Second page row',
      requestId: '00000000-0000-7000-8000-0000000000fe',
      href: '/approvals/00000000-0000-7000-8000-0000000000fe',
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(snapshot({ items: [more], nextCursor: null })));
    renderApp(
      <InboxScreen
        me={me}
        initial={snapshot({
          nextCursor: 'abc',
          counts: { needsYou: needsYouItems.length + 1, running: 1, done: 1 },
        })}
      />,
    );
    const btn = screen.getByRole('button', { name: /Load more \(1 remaining\)/ });
    await userEvent.click(btn);
    const link = await screen.findByRole('link', { name: 'Second page row' });
    expect(fetchMock.mock.calls[0]![0]).toContain('cursor=abc');
    expect(document.activeElement).toBe(link);
    expect(screen.queryByRole('button', { name: /Load more/ })).toBeNull();
  });

  it('is accessible in populated, empty and error states', async () => {
    for (const s of [
      snapshot(),
      snapshot({ items: [], counts: { needsYou: 0, running: 0, done: 0 } }),
    ]) {
      const { container, unmount } = renderApp(<InboxScreen me={me} initial={s} />);
      await expectNoViolations(container);
      unmount();
    }
  });
});
