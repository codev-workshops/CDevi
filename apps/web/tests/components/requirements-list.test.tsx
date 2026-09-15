import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REQUIREMENT_STATE_WORDS } from '@cdevi/contracts/requirement-rules';
import { requirementStateToPill, stateToPill } from '@cdevi/design-system';
import { RequirementsListScreen } from '../../app/(app)/requirements/RequirementsListScreen';
import { expectNoViolations, renderApp } from '../a11y';
import {
  APPROVER,
  ENGINEER,
  JIRA_KEY,
  JIRA_URL,
  PROJECT,
  SEED_ROWS,
  bulkPage,
  flaggedRow,
  listEmpty,
  listFiltered,
  listFilteredEmpty,
  listPopulated,
  me,
  page,
} from '../fixtures/requirements';

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
const problem = (status: number) =>
  jsonResponse({ type: 'about:blank', title: 'Nope', status }, status);
const lastUrl = () => new URL(String(fetchMock.mock.calls.at(-1)![0]), 'http://localhost');
const saffron = (c: Element) => c.querySelectorAll('.cd-saffron').length;
const list = () => screen.getByRole('list', { name: 'Requirements' });
const rows = () => within(list()).getAllByRole('listitem');

beforeEach(() => {
  fetchMock.mockReset();
  sources.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeSource);
  document.cookie = 'cdevi_project=; Path=/; Max-Age=0';
  window.history.replaceState(null, '', '/requirements');
});
afterEach(() => vi.unstubAllGlobals());

describe('Requirements list (specs/001 US4, ui-requirements.md §2/§5.1)', () => {
  it('FR-009 renders ≤ 50 rows with title link /requirements/{id}, RequirementStatePill word, Mono external id, project key, assignee or Unassigned, and "2 open questions" for req-seed-003', async () => {
    const { container } = renderApp(
      <RequirementsListScreen me={me('engineer')} initial={listPopulated()} />,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Requirements');
    expect(screen.getByText('8 of 8 requirements')).toBeInTheDocument();

    const items = rows();
    expect(items).toHaveLength(8);
    // API order: req-seed-008 first.
    expect(items[0]).toHaveTextContent('req-seed-008');
    for (const r of SEED_ROWS) {
      const li = items.find((el) => el.textContent?.includes(r.externalId))!;
      expect(within(li).getByRole('link', { name: r.title })).toHaveAttribute('href', r.href);
      // req-seed-007 and its workflow both read "completed"; the requirement pill carries data-state.
      const pill = within(li)
        .getAllByText(requirementStateToPill[r.state].word)
        .find((el) => el.getAttribute('data-state') === r.state)!;
      expect(pill).toHaveClass('cd-pill');
      expect(requirementStateToPill[r.state].word).toBe(REQUIREMENT_STATE_WORDS[r.state]);
      expect(li).toHaveTextContent(PROJECT.key);
      expect(li).toHaveTextContent(r.assignee?.name ?? 'Unassigned');
    }
    const seed3 = items.find((el) => el.textContent?.includes('req-seed-003'))!;
    expect(seed3).toHaveTextContent('2 open questions');
    expect(seed3).toHaveTextContent(APPROVER.name);
    const seed6 = items.find((el) => el.textContent?.includes('req-seed-006'))!;
    expect(seed6).toHaveTextContent(ENGINEER.name);
    expect(saffron(container)).toBe(0);
    await expectNoViolations(container);
  });

  it('FR-010 rows with a linked workflow show a StatePill inside a link named "Workflow s500-001, stage n of 7" to /workflows/{id}', () => {
    renderApp(<RequirementsListScreen me={me('engineer')} initial={listPopulated()} />);
    const linked = SEED_ROWS.filter((r) => r.workflow);
    expect(linked).toHaveLength(3);
    for (const r of linked) {
      const wf = r.workflow!;
      const link = screen.getByRole('link', {
        name: `Workflow ${wf.externalId}, stage ${wf.stage!.index} of ${wf.stage!.count}`,
      });
      expect(link).toHaveAttribute('href', `/workflows/${wf.id}`);
      const pill = within(link).getByText(stateToPill[wf.state].word);
      expect(pill).toHaveClass('cd-pill');
    }
    expect(screen.getByText('queued')).toBeInTheDocument();
    expect(screen.getByText('needs you')).toBeInTheDocument();
  });

  it('FR-008 the Jira row shows a link "Open PAY-231 in Jira (opens in a new tab)" with target _blank and rel noopener noreferrer, and a flagged row shows the "Jira deleted" pill', () => {
    const flagged = flaggedRow();
    renderApp(
      <RequirementsListScreen
        me={me('engineer')}
        initial={page({
          items: [flagged, ...SEED_ROWS.filter((r) => r.externalId !== 'req-seed-005')],
        })}
      />,
    );
    const jira = screen.getByRole('link', {
      name: `Open ${JIRA_KEY} in Jira (opens in a new tab)`,
    });
    expect(jira).toHaveAttribute('href', JIRA_URL);
    expect(jira).toHaveAttribute('target', '_blank');
    expect(jira).toHaveAttribute('rel', 'noopener noreferrer');
    expect(jira).toHaveTextContent(JIRA_KEY);

    const flaggedLi = rows().find((el) => el.textContent?.includes('PAY-241'))!;
    const pill = within(flaggedLi).getByText('Jira deleted');
    expect(pill).toHaveClass('cd-pill', 'cd-blocked');
    expect(within(flaggedLi).getByText('blocked')).toHaveClass('cd-pill');
  });

  it('FR-025 project select lists All projects + me.projects, writes the cdevi_project cookie and refetches with ?project=; state and assignee selects refetch with ?state=/?assignee= and reset the cursor', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(listFiltered()));
    const m = me('approver');
    renderApp(<RequirementsListScreen me={m} initial={page({ nextCursor: 'cursor-page-1' })} />);
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();

    const project = screen.getByRole('combobox', { name: 'Project' });
    expect(
      within(project)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All projects', ...m.projects.map((p) => p.name)]);
    await user.selectOptions(project, PROJECT.id);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastUrl().pathname).toBe('/api/requirements');
    expect(lastUrl().searchParams.get('project')).toBe(PROJECT.id);
    expect(lastUrl().searchParams.has('cursor')).toBe(false);
    expect(document.cookie).toContain(`cdevi_project=${PROJECT.id}`);
    expect(new URL(window.location.href).searchParams.get('project')).toBe(PROJECT.id);
    expect(project).toHaveFocus();

    const state = screen.getByRole('combobox', { name: 'State' });
    expect(
      within(state)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Any state',
      'draft',
      'analyzing',
      'needs clarification',
      'ready',
      'approved',
      'in implementation',
      'completed',
      'rejected',
    ]);
    await user.selectOptions(state, 'NEEDS_CLARIFICATION');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastUrl().searchParams.get('state')).toBe('NEEDS_CLARIFICATION');
    expect(new URL(window.location.href).searchParams.get('state')).toBe('NEEDS_CLARIFICATION');

    const assignee = screen.getByRole('combobox', { name: 'Assignee' });
    const names = within(assignee)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names.slice(0, 3)).toEqual(['Anyone', 'Me', 'Unassigned']);
    expect(names).toContain(APPROVER.name);
    expect(names).toContain(ENGINEER.name);
    await user.selectOptions(assignee, 'me');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(lastUrl().searchParams.get('assignee')).toBe('me');
    expect(lastUrl().searchParams.get('state')).toBe('NEEDS_CLARIFICATION');
    expect(new URL(window.location.href).searchParams.get('assignee')).toBe('me');

    await waitFor(() =>
      expect(screen.getByText('1 of 1 requirements · filtered')).toBeInTheDocument(),
    );
    expect(rows()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('FR-009 "Load more" appends the next page, keeps focus and never renders more than 50 new rows', async () => {
    const user = userEvent.setup();
    const first = bulkPage(50, 0, { nextCursor: 'cursor-a' });
    const second = bulkPage(50, 50, { nextCursor: null });
    fetchMock.mockResolvedValueOnce(jsonResponse(second));
    renderApp(<RequirementsListScreen me={me('engineer')} initial={first} />);
    expect(rows()).toHaveLength(50);
    expect(screen.getByText('50 of 120 requirements')).toBeInTheDocument();

    const more = screen.getByRole('button', { name: 'Load more' });
    await user.click(more);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastUrl().searchParams.get('cursor')).toBe('cursor-a');
    await waitFor(() => expect(rows()).toHaveLength(100));
    expect(screen.getByText('100 of 120 requirements')).toBeInTheDocument();
    expect(screen.getByText('50 more loaded')).toBeInTheDocument();
    expect(rows()[50]).toHaveTextContent('Bulk requirement 1050');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    // The button is gone, so focus lands on the summary line instead of falling back to <body>.
    expect(screen.getByText('100 of 120 requirements')).toHaveFocus();
  });

  it('FR-009 "Load more" keeps focus on itself while more pages remain', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(bulkPage(50, 50, { nextCursor: 'cursor-b' })));
    renderApp(
      <RequirementsListScreen
        me={me('engineer')}
        initial={bulkPage(50, 0, { nextCursor: 'cursor-a' })}
      />,
    );
    const more = screen.getByRole('button', { name: 'Load more' });
    await user.click(more);
    await waitFor(() => expect(rows()).toHaveLength(100));
    expect(screen.getByRole('button', { name: 'Load more' })).toHaveFocus();
  });

  it('FR-034 inbox.changed triggers one debounced refetch within 300 ms', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const next = page({ items: SEED_ROWS.slice(0, 3), total: 3 });
      let resolve: (r: Response) => void = () => {};
      fetchMock.mockReturnValue(
        new Promise<Response>((r) => {
          resolve = r;
        }),
      );
      const { container } = renderApp(
        <RequirementsListScreen me={me('engineer')} initial={listPopulated()} />,
      );
      expect(screen.getByText('live')).toHaveClass('cd-pill');
      expect(sources).toHaveLength(1);
      const es = sources[0]!;
      es.emit('open', '');
      es.emit('inbox.changed', JSON.stringify({ requirementId: SEED_ROWS[0]!.id }));
      await vi.advanceTimersByTimeAsync(100);
      es.emit('inbox.changed', '{}');
      await vi.advanceTimersByTimeAsync(250);
      expect(fetchMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(100);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(lastUrl().searchParams.has('cursor')).toBe(false);
      await waitFor(() => expect(list()).toHaveAttribute('aria-busy', 'true'));
      expect(rows()).toHaveLength(8);
      await expectNoViolations(container);

      resolve(jsonResponse(next));
      await waitFor(() => expect(rows()).toHaveLength(3));
      expect(list()).not.toHaveAttribute('aria-busy', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('FR-034 the live pill reports reconnecting while the stream is down', async () => {
    renderApp(<RequirementsListScreen me={me('engineer')} initial={listPopulated()} />);
    sources[0]!.emit('error', '');
    await waitFor(() => expect(screen.getByText('reconnecting')).toHaveClass('cd-pill'));
  });

  it('FR-009 empty state without filters shows the info notice and a primary "Create the first requirement" for creators only; with filters shows "Clear filters"', async () => {
    const user = userEvent.setup();
    const { container, unmount } = renderApp(
      <RequirementsListScreen me={me('engineer')} initial={listEmpty()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No requirements yet.');
    const create = screen.getByRole('link', { name: 'Create the first requirement' });
    expect(create).toHaveAttribute('href', '/requirements/new');
    expect(create).toHaveClass('cd-btn');
    expect(create).not.toHaveClass('cd-ghost', 'cd-saffron');
    expect(screen.queryByRole('list', { name: 'Requirements' })).toBeNull();
    expect(saffron(container)).toBe(0);
    await expectNoViolations(container);
    unmount();

    const viewer = renderApp(<RequirementsListScreen me={me('viewer')} initial={listEmpty()} />);
    expect(screen.queryByRole('link', { name: 'Create the first requirement' })).toBeNull();
    viewer.unmount();

    fetchMock.mockResolvedValueOnce(jsonResponse(listPopulated()));
    window.history.replaceState(null, '', '/requirements?state=COMPLETED&assignee=me');
    const filtered = renderApp(
      <RequirementsListScreen me={me('engineer')} initial={listFilteredEmpty()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No requirements match these filters.');
    expect(screen.getByRole('combobox', { name: 'State' })).toHaveValue('COMPLETED');
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveValue('me');
    expect(saffron(filtered.container)).toBe(0);
    await expectNoViolations(filtered.container);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastUrl().searchParams.has('state')).toBe(false);
    expect(lastUrl().searchParams.has('assignee')).toBe(false);
    expect(new URL(window.location.href).searchParams.has('state')).toBe(false);
    await waitFor(() => expect(rows()).toHaveLength(8));
    expect(screen.getByRole('combobox', { name: 'State' })).toHaveValue('');
  });

  it('FR-009 error state shows an alert and Retry; the last good page stays rendered', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(problem(500))
      .mockResolvedValueOnce(jsonResponse(listFiltered()));
    const { container } = renderApp(
      <RequirementsListScreen me={me('engineer')} initial={listPopulated()} />,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'State' }), 'READY');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Requirements couldn't be loaded."),
    );
    expect(rows()).toHaveLength(8);
    expect(saffron(container)).toBe(0);
    await expectNoViolations(container);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastUrl().searchParams.get('state')).toBe('READY');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('FR-032 "New requirement" is a primary link for engineer/approver/admin and aria-disabled with help for viewer', async () => {
    for (const role of ['engineer', 'approver', 'administrator'] as const) {
      const r = renderApp(<RequirementsListScreen me={me(role)} initial={listPopulated()} />);
      const link = screen.getByRole('link', { name: 'New requirement' });
      expect(link).toHaveAttribute('href', '/requirements/new');
      expect(link).toHaveClass('cd-btn');
      expect(link).not.toHaveClass('cd-ghost', 'cd-saffron');
      expect(link).not.toHaveAttribute('aria-disabled');
      expect(saffron(r.container)).toBe(0);
      r.unmount();
    }
    const { container } = renderApp(
      <RequirementsListScreen me={me('viewer')} initial={listPopulated()} />,
    );
    const link = screen.getByRole('link', { name: 'New requirement' });
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Your role (viewer) cannot create requirements')).toBeInTheDocument();
    expect(saffron(container)).toBe(0);
    await expectNoViolations(container);
  });

  it('SC-010 no .cd-saffron in any list state and axe passes in the populated filtered state', async () => {
    window.history.replaceState(null, '', '/requirements?state=NEEDS_CLARIFICATION');
    const { container } = renderApp(
      <RequirementsListScreen me={me('approver')} initial={listFiltered()} />,
    );
    expect(screen.getByText('1 of 1 requirements · filtered')).toBeInTheDocument();
    expect(saffron(container)).toBe(0);
    await expectNoViolations(container);
  });
});
