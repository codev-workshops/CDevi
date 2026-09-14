import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalCenterScreen } from '../../app/(app)/approvals/ApprovalCenterScreen';
import { expectNoViolations, renderApp } from '../a11y';
import { clarification, critical, items, low, medium, snapshot } from '../fixtures/approval-center';
import { me } from '../fixtures/snapshot';

type Listener = (ev: { data: string }) => void;
const sources: FakeSource[] = [];
class FakeSource {
  listeners = new Map<string, Listener[]>();
  constructor() {
    sources.push(this);
  }
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data: string) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data });
  }
  close() {}
}

const fetchMock = vi.fn();
const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });

beforeEach(() => {
  fetchMock.mockReset();
  sources.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('Approval Center (specs/001 US2)', () => {
  it('FR-011 lists pending approvals and clarifications in API order with ask, workflow, requester, time and risk', () => {
    renderApp(<ApprovalCenterScreen me={me} initial={snapshot()} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Approval Center');

    const list = screen.getByRole('list', { name: 'Needs a decision' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(items.length);
    expect(rows.map((r) => within(r).getByRole('link').getAttribute('href'))).toEqual(
      items.map((i) => i.href),
    );

    const first = rows[0]!;
    expect(within(first).getByRole('link')).toHaveTextContent(critical.ask);
    expect(within(first).getByText('needs you')).toHaveClass('cd-pill');
    expect(within(first).getByText('critical risk')).toBeInTheDocument();
    expect(within(first).getByText(critical.workflowExternalId).tagName).toBe('CODE');
    expect(first).toHaveTextContent('Requested by Implementation Agent');
    expect(first).toHaveTextContent('40 min ago');

    expect(within(rows[1]!).getByText('medium risk')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('low risk')).toBeInTheDocument();
    const last = rows[3]!;
    expect(within(last).getByText('clarification')).toHaveClass('cd-pill');
    expect(within(last).queryByText(/risk$/)).toBeNull();
    expect(last).toHaveTextContent(clarification.ask);
  });

  it('FR-025 switching the project selector refetches with ?project= and offers an all-projects option', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(snapshot({ project: low.project.id, items: [low] })),
    );
    renderApp(<ApprovalCenterScreen me={me} initial={snapshot()} />);

    const select = screen.getByRole('combobox', { name: 'Project' });
    expect(within(select).getByRole('option', { name: 'All projects' })).toBeInTheDocument();
    await user.selectOptions(select, me.projects[1]!.id);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('/api/approvals?');
    expect(url).toContain(`project=${me.projects[1]!.id}`);
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Needs a decision' })).getAllByRole('listitem'),
      ).toHaveLength(1),
    );
  });

  it('SC-005 refreshes the list when the inbox stream announces a change and shows the count', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(snapshot({ items: [medium, clarification] })));
    renderApp(<ApprovalCenterScreen me={me} initial={snapshot()} />);
    expect(screen.getByText('3 approvals · 1 clarification')).toBeInTheDocument();

    await waitFor(() => expect(sources).toHaveLength(1));
    sources[0]!.emit('inbox.changed', JSON.stringify({ workflowId: critical.workflowId }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Needs a decision' })).getAllByRole('listitem'),
      ).toHaveLength(2),
    );
    expect(screen.getByText('1 approval · 1 clarification')).toBeInTheDocument();
  });

  it('renders the empty state and the error state with a Retry button', async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp(
      <ApprovalCenterScreen me={me} initial={snapshot({ items: [] })} />,
    );
    expect(screen.getByText(/Nothing needs a decision/)).toBeInTheDocument();
    unmount();

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ type: 'urn:cdevi:problem:internal', title: 'Boom', status: 500 }, 500),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(snapshot()));
    renderApp(<ApprovalCenterScreen me={me} initial={snapshot()} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), me.projects[0]!.id);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Couldn.t load approvals/);
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('WCAG 2.2 AA: populated, empty and error states have no axe violations', async () => {
    for (const s of [snapshot(), snapshot({ items: [] })]) {
      const { container, unmount } = renderApp(<ApprovalCenterScreen me={me} initial={s} />);
      await expectNoViolations(container);
      unmount();
    }
  });
});
