import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReviewsScreen } from '../../app/(app)/reviews/ReviewsScreen';
import { expectNoViolations, renderApp } from '../a11y';
import { me } from '../fixtures/requirements';
import {
  NOW,
  PR_ID,
  PROJECT,
  READY_PR_ID,
  WORKFLOW_ID,
  listEmpty,
  listItem,
  listPopulated,
} from '../fixtures/reviews';

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
const list = () => screen.getByRole('list', { name: 'Pull requests under review' });
const rows = () => within(list()).getAllByRole('listitem');

beforeEach(() => {
  fetchMock.mockReset();
  sources.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeSource);
  document.cookie = 'cdevi_project=; Path=/; Max-Age=0';
  window.history.replaceState(null, '', '/reviews');
});
afterEach(() => vi.unstubAllGlobals());

describe('Reviews list (specs/001 US6)', () => {
  it('FR-020 renders PR number and title linking to /reviews/{id}, workflow link, review status pill and open findings', async () => {
    const { container } = renderApp(
      <ReviewsScreen me={me('engineer')} initial={listPopulated()} now={NOW} />,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reviews');
    expect(screen.getByText('2 pull requests')).toBeInTheDocument();

    const items = rows();
    expect(items).toHaveLength(2);
    const first = items[0]!;
    expect(
      within(first).getByRole('link', { name: '#1821 PAY-1391 Refund processing' }),
    ).toHaveAttribute('href', `/reviews/${PR_ID}`);
    expect(within(first).getByRole('link', { name: /Add rate limiting/ })).toHaveAttribute(
      'href',
      `/workflows/${WORKFLOW_ID}`,
    );
    expect(first).toHaveTextContent(PROJECT.key);
    expect(within(first).getByText('AI review complete')).toHaveClass('cd-pill');
    expect(first).toHaveTextContent('5 open findings');

    const second = items[1]!;
    expect(
      within(second).getByRole('link', { name: '#1822 PAY-1402 Ledger contract suite' }),
    ).toHaveAttribute('href', `/reviews/${READY_PR_ID}`);
    expect(within(second).getByText('AI review running')).toHaveClass('cd-pill');
    expect(saffron(container)).toBe(0);
    await expectNoViolations(container);
  });

  it('FR-022 rows that are not ready for merge show the marker; ready rows do not', () => {
    renderApp(<ReviewsScreen me={me('engineer')} initial={listPopulated()} now={NOW} />);
    const [first, second] = rows();
    const marker = within(first!).getByText(/Not ready for merge/);
    expect(marker).toHaveClass('cd-pill');
    expect(first).toHaveTextContent('1 blocking');
    expect(within(second!).queryByText(/Not ready for merge/)).toBeNull();
  });

  it('a pull request without a review shows "no review yet"', () => {
    renderApp(
      <ReviewsScreen
        me={me('engineer')}
        initial={{
          items: [
            listItem({
              reviewStatus: null,
              openFindingsCount: 0,
              blockingOpenCount: 0,
              readyForMerge: true,
            }),
          ],
          nextCursor: null,
        }}
        now={NOW}
      />,
    );
    expect(within(rows()[0]!).getByText('no review yet')).toHaveClass('cd-pill');
  });

  it('FR-025 project select lists All projects + me.projects, writes the cdevi_project cookie and refetches with ?project=; state select refetches with ?state=', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(listPopulated()));
    const m = me('approver');
    renderApp(
      <ReviewsScreen
        me={m}
        initial={{ ...listPopulated(), nextCursor: 'cursor-page-1' }}
        now={NOW}
      />,
    );
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();

    const project = screen.getByRole('combobox', { name: 'Project' });
    expect(
      within(project)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['All projects', ...m.projects.map((p) => p.name)]);
    await user.selectOptions(project, PROJECT.id);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastUrl().pathname).toBe('/api/reviews');
    expect(lastUrl().searchParams.get('project')).toBe(PROJECT.id);
    expect(lastUrl().searchParams.has('cursor')).toBe(false);
    expect(document.cookie).toContain(`cdevi_project=${PROJECT.id}`);
    expect(new URL(window.location.href).searchParams.get('project')).toBe(PROJECT.id);
    expect(project).toHaveFocus();

    const state = screen.getByRole('combobox', { name: 'Pull request state' });
    expect(
      within(state)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Any state', 'open', 'merged', 'closed']);
    await user.selectOptions(state, 'OPEN');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastUrl().searchParams.get('state')).toBe('OPEN');
    expect(lastUrl().searchParams.get('project')).toBe(PROJECT.id);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull());
  });

  it('Load more appends the next page using the cursor', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          listItem({
            id: READY_PR_ID,
            number: 1900,
            title: 'Page two',
            reviewHref: `/reviews/${READY_PR_ID}`,
          }),
        ],
        nextCursor: null,
      }),
    );
    renderApp(
      <ReviewsScreen
        me={me('engineer')}
        initial={{ items: [listItem()], nextCursor: 'c1' }}
        now={NOW}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(lastUrl().searchParams.get('cursor')).toBe('c1');
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('empty state and error state use design-system notices', async () => {
    const { container, unmount } = renderApp(
      <ReviewsScreen me={me('engineer')} initial={listEmpty()} now={NOW} />,
    );
    expect(screen.getByText(/No pull requests under review/)).toBeInTheDocument();
    await expectNoViolations(container);
    unmount();

    fetchMock
      .mockResolvedValueOnce(problem(500))
      .mockResolvedValueOnce(jsonResponse(listPopulated()));
    renderApp(<ReviewsScreen me={me('engineer')} initial={listPopulated()} now={NOW} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), PROJECT.id);
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn't load/);
    await userEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(rows()).toHaveLength(2);
  });

  it('FR-034 refetches on inbox.changed keeping the filters', async () => {
    fetchMock.mockResolvedValue(jsonResponse(listPopulated()));
    renderApp(<ReviewsScreen me={me('engineer')} initial={listEmpty()} now={NOW} />);
    expect(sources).toHaveLength(1);
    sources[0]!.emit(
      'inbox.changed',
      JSON.stringify({ workflowId: WORKFLOW_ID, table: 'review_findings' }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastUrl().pathname).toBe('/api/reviews');
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it('axe: no violations', async () => {
    const { container } = renderApp(
      <ReviewsScreen me={me('viewer')} initial={listPopulated()} now={NOW} />,
    );
    await expectNoViolations(container);
  });
});
