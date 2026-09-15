import { ACTIVE_STATES, SDLC_STAGES } from '@cdevi/contracts/dashboard-model';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppFrame } from '../../app/(app)/AppFrame';
import { DashboardScreen } from '../../app/(app)/dashboard/DashboardScreen';
import { expectNoViolations, renderApp } from '../a11y';
import {
  DASHBOARD_DEMO,
  adminMe,
  allProjects,
  cards,
  empty,
  populated,
  zeroDenominators,
} from '../fixtures/dashboard';
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
const problem = (status: number) =>
  jsonResponse({ type: 'about:blank', title: 'Nope', status }, status);

const region = (name: string) => screen.getByRole('region', { name });
const link = (name: string | RegExp) => screen.getByRole('link', { name });
const saffron = (container: Element) => container.querySelectorAll('.cd-saffron').length;
const updatedAt = () => {
  const t = screen.getByText('Updated').querySelector('time');
  expect(t).toHaveTextContent(/^(just now|\d+ (min|h|d) ago)$/);
  return t?.getAttribute('datetime');
};

beforeEach(() => {
  fetchMock.mockReset();
  sources.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeSource);
  document.cookie = 'cdevi_project=; Path=/; Max-Age=0';
  window.history.replaceState(null, '', '/dashboard');
});
afterEach(() => vi.unstubAllGlobals());

describe('Dashboard (specs/001 US3)', () => {
  it('FR-035 header counts answer "what is happening" and every figure links to its filtered list', () => {
    renderApp(<DashboardScreen me={adminMe} initial={populated} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard');

    expect(link('18 active workflows')).toHaveAttribute(
      'href',
      `/workflows?state=${ACTIVE_STATES.join(',')}`,
    );
    expect(link('7 running agents')).toHaveAttribute('href', '/workflows?state=RUNNING,RETRYING');
    expect(link('6 PRs generated · Last 7 days')).toHaveAttribute(
      'href',
      '/workflows?hasPr=true&window=7d',
    );
    expect(link('2 open failures')).toHaveAttribute('href', '/workflows?state=FAILED,BLOCKED');
    expect(updatedAt()).toBe(populated.generatedAt);
    expect(screen.getByText('live')).toHaveClass('cd-pill');
  });

  it('FR-023 the pipeline shows seven stage rows linking to the Workflow Center filtered by stage, plus a chart summary', () => {
    renderApp(<DashboardScreen me={adminMe} initial={populated} />);
    const pipeline = region('Pipeline');
    expect(
      within(pipeline).getByRole('img', {
        name: 'Workflows per SDLC stage: 3 Requirement, 2 Analysis, 1 Architecture, 4 Implementation, 3 Testing, 3 Review, 2 PR',
      }),
    ).toBeInTheDocument();

    const list = within(pipeline).getByRole('list', { name: 'Pipeline' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(8);
    SDLC_STAGES.forEach((name, i) => {
      const row = rows[i]!;
      expect(within(row).getByRole('link', { name })).toHaveAttribute(
        'href',
        `/workflows?stage=${i + 1}`,
      );
      expect(row).toHaveTextContent(`Stage ${i + 1}`);
      expect(within(row).getByText(String([3, 2, 1, 4, 3, 3, 2][i]))).toBeInTheDocument();
    });
    expect(within(rows[7]!).getByRole('link', { name: '1 without a stage' })).toHaveAttribute(
      'href',
      '/workflows?stage=none',
    );
  });

  it('FR-023 the "without a stage" row is omitted when every active workflow has a stage', () => {
    renderApp(<DashboardScreen me={me} initial={empty} />);
    const list = within(region('Pipeline')).getByRole('list', { name: 'Pipeline' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.queryByText(/without a stage/)).toBeNull();
  });

  it('SC-002 "What needs me" counts approvals, clarifications, failed and blocked workflows separately, each linking to its list', () => {
    const { container } = renderApp(<DashboardScreen me={adminMe} initial={populated} />);
    const needs = region('What needs me');
    expect(within(needs).getByRole('link', { name: '4 approvals' })).toHaveAttribute(
      'href',
      '/approvals',
    );
    expect(within(needs).getByRole('link', { name: '2 clarifications' })).toHaveAttribute(
      'href',
      '/approvals?kind=clarification',
    );
    expect(within(needs).getByRole('link', { name: '1 failed workflows' })).toHaveAttribute(
      'href',
      '/workflows?state=FAILED',
    );
    expect(within(needs).getByRole('link', { name: '1 blocked workflows' })).toHaveAttribute(
      'href',
      '/workflows?state=BLOCKED',
    );
    expect(saffron(container)).toBe(0);
  });

  it('FR-023 health shows the three rates for the window with one decimal, their fractions and links', () => {
    renderApp(<DashboardScreen me={adminMe} initial={populated} />);
    const health = region('Health · Last 7 days');
    const rate = (name: string, pct: string, fraction: string, href: string) => {
      const meter = within(health).getByRole('meter', { name });
      expect(meter.querySelector('i')).not.toHaveClass('cd-muted');
      const a = within(health).getByRole('link', { name: pct });
      expect(a).toHaveAttribute('href', href);
      const described = document.getElementById(a.getAttribute('aria-describedby') ?? '');
      expect(described).toHaveTextContent(fraction);
    };
    rate('Test pass rate', '97.4 %', '974 / 1000', '/testing?window=7d');
    rate('Agent success rate', '94.6 %', '35 / 37', '/agents?window=7d');
    rate('Human intervention rate', '33.3 %', '8 / 24', '/workflows?intervention=human&window=7d');
    const meters = within(health).getAllByRole('meter');
    expect(meters.map((m) => m.getAttribute('aria-valuenow'))).toEqual(['974', '35', '8']);
    expect(meters.map((m) => m.getAttribute('aria-valuemax'))).toEqual(['1000', '37', '24']);
  });

  it('FR-023 a zero denominator renders "—" with its reason, never 0 % or NaN, and a muted meter', () => {
    const { container } = renderApp(<DashboardScreen me={adminMe} initial={zeroDenominators} />);
    const health = region('Health · Last 24 hours');
    const dashes = within(health).getAllByRole('link', { name: '—' });
    expect(dashes.map((a) => a.getAttribute('href'))).toEqual([
      '/testing?window=24h',
      '/agents?window=24h',
      '/workflows?intervention=human&window=24h',
    ]);
    expect(health).toHaveTextContent('No test runs in this window');
    expect(health).toHaveTextContent('No finished agent runs in this window');
    expect(health).toHaveTextContent('No workflows in this window');
    expect(health.textContent).not.toMatch(/NaN|0 %/);
    for (const m of within(health).getAllByRole('meter')) {
      expect(m.querySelector('i')).toHaveClass('cd-muted');
      expect(m.querySelector('i')).not.toHaveClass('cd-warn');
    }
    expect(link('1 PRs generated · Last 24 hours')).toHaveAttribute(
      'href',
      '/workflows?hasPr=true&window=24h',
    );
    expect(saffron(container)).toBe(0);
  });

  it('FR-026 risk makes HIGH/CRITICAL prominent with badges and links to the Approval Center and Audit Log; security findings are "not connected yet"', () => {
    renderApp(<DashboardScreen me={adminMe} initial={populated} />);
    const risk = region('Risk');
    expect(within(risk).getAllByText('high risk')).toHaveLength(2);
    expect(within(risk).getAllByText('critical risk')).toHaveLength(2);
    for (const badge of [
      ...within(risk).getAllByText('high risk'),
      ...within(risk).getAllByText('critical risk'),
    ]) {
      expect(badge).toHaveAttribute('data-prominent', 'true');
    }
    expect(within(risk).getByRole('link', { name: '2 pending approvals' })).toHaveAttribute(
      'href',
      '/approvals?risk=HIGH,CRITICAL',
    );
    expect(
      within(risk).getByRole('link', { name: '0 audit events · Last 7 days' }),
    ).toHaveAttribute('href', '/audit?risk=HIGH,CRITICAL&window=7d');

    expect(within(risk).getByText('security findings')).toBeInTheDocument();
    expect(within(risk).getByText('—')).toBeInTheDocument();
    const notice = within(risk).getByRole('status');
    expect(notice).toHaveClass('cd-info');
    expect(notice).toHaveTextContent(
      'Not connected yet — review findings arrive with PR Review (User Story 6).',
    );
    expect(within(notice).getByRole('link', { name: 'Open Reviews' })).toHaveAttribute(
      'href',
      '/reviews',
    );
    expect(risk.querySelector('.cd-saffron, .cd-done, .cd-error')).toBeNull();
  });

  it('FR-023 active workflow cards show identifier, title, stage, progress, agent, elapsed time and state, open Workflow Detail, and cap at 12 with "Show all"', () => {
    renderApp(<DashboardScreen me={adminMe} initial={populated} />);
    const section = region('Active workflows (18)');
    const list = within(section).getByRole('list', { name: 'Active workflows' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => within(r).getByRole('link').getAttribute('href'))).toEqual(
      cards.map((c) => c.href),
    );

    const first = rows[0]!;
    const c0 = cards[0]!;
    expect(within(first).getByRole('link', { name: c0.title })).toHaveAttribute('href', c0.href);
    expect(within(first).getByText(c0.externalId).tagName).toBe('CODE');
    expect(first).toHaveTextContent(
      'Stage 4 of 7 · Implementation · Implementation Agent · 2 h 5 m',
    );
    const meter = within(first).getByRole('meter', { name: 'Progress' });
    expect(meter).toHaveAttribute('aria-valuenow', '3');
    expect(meter).toHaveAttribute('aria-valuemax', '7');
    expect(within(first).getByText('running')).toHaveClass('cd-pill');

    expect(within(rows[1]!).getByText('needs you')).toHaveClass('cd-pill');
    expect(within(rows[3]!).getByText('blocked')).toHaveClass('cd-pill');
    expect(within(rows[4]!).getByText('failed')).toHaveClass('cd-pill');

    const queued = rows[10]!;
    expect(queued).toHaveTextContent('Stage — of 7 · no stage · no agent · not started');
    expect(within(queued).getByText('queued')).toHaveClass('cd-pill');
    expect(within(queued).getByRole('meter', { name: 'Progress' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );

    expect(within(section).getByRole('link', { name: 'Show all 18' })).toHaveAttribute(
      'href',
      populated.counts.activeWorkflows.href,
    );
  });

  it('FR-023 "Show all" is absent when every active workflow fits in the list', () => {
    const twelve = { ...populated, activeWorkflowsTotal: 12 };
    renderApp(<DashboardScreen me={adminMe} initial={twelve} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Active workflows (12)' })).toBeVisible();
    expect(screen.queryByRole('link', { name: /^Show all/ })).toBeNull();
  });

  it('FR-025 the project selector offers all projects, refetches with ?project=, remembers the cookie and updates the URL', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(allProjects));
    renderApp(<DashboardScreen me={adminMe} initial={populated} />);

    const select = screen.getByRole('combobox', { name: 'Project' });
    expect(select).toHaveValue(DASHBOARD_DEMO.id);
    const options = within(select).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'All projects',
      ...adminMe.projects.map((p) => p.name),
    ]);
    await user.selectOptions(select, 'all');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost');
    expect(url.pathname).toBe('/api/dashboard');
    expect(url.searchParams.get('project')).toBe('all');
    expect(url.searchParams.get('window')).toBe('7d');
    expect(document.cookie).toContain('cdevi_project=all');
    expect(new URL(window.location.href).searchParams.get('project')).toBe('all');

    await waitFor(() => expect(link('118 active workflows')).toBeInTheDocument());
    expect(link('28 approvals')).toBeInTheDocument();
    expect(select).toHaveFocus();
  });

  it('FR-025 opening ?project=<uuid> remembers that project in the shared cookie so figure links land on the same scope', () => {
    document.cookie = 'cdevi_project=all; Path=/';
    renderApp(<DashboardScreen me={adminMe} initial={populated} />);
    expect(document.cookie).toContain(`cdevi_project=${DASHBOARD_DEMO.id}`);
    expect(document.cookie).not.toContain('cdevi_project=all');
  });

  it('FR-025 the Approvals nav count follows the Dashboard snapshot (approvals + clarifications) after a refetch', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(allProjects));
    renderApp(
      <AppFrame me={adminMe} needsYouCount={0} approvalsCount={99}>
        <DashboardScreen me={adminMe} initial={populated} />
      </AppFrame>,
    );
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByLabelText(/6 pending/)).toBeInTheDocument();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'all');
    await waitFor(() => expect(within(nav).getByLabelText(/42 pending/)).toBeInTheDocument());
  });

  it('FR-023 the window selector refetches with ?window= and relabels every windowed figure', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(zeroDenominators));
    renderApp(<DashboardScreen me={adminMe} initial={populated} />);

    const select = screen.getByRole('combobox', { name: 'Window' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Last 24 hours', 'Last 7 days', 'Last 30 days']);
    expect(select).toHaveValue('7d');
    await user.selectOptions(select, '24h');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const url = new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost');
    expect(url.searchParams.get('window')).toBe('24h');
    expect(url.searchParams.get('project')).toBe(DASHBOARD_DEMO.id);
    expect(new URL(window.location.href).searchParams.get('window')).toBe('24h');
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { level: 2, name: 'Health · Last 24 hours' }),
      ).toBeVisible(),
    );
    expect(link('1 PRs generated · Last 24 hours')).toBeInTheDocument();
  });

  it('FR-034 an inbox.changed frame refetches once after a 300 ms debounce while the previous figures stay visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const next = {
        ...populated,
        counts: {
          ...populated.counts,
          activeWorkflows: { ...populated.counts.activeWorkflows, value: 19 },
        },
      };
      let resolve: (r: Response) => void = () => {};
      fetchMock.mockReturnValue(
        new Promise<Response>((r) => {
          resolve = r;
        }),
      );
      const { container } = renderApp(<DashboardScreen me={adminMe} initial={populated} />);
      expect(sources).toHaveLength(1);
      const es = sources[0]!;
      es.emit('open', '');

      es.emit('inbox.changed', '{}');
      await vi.advanceTimersByTimeAsync(100);
      es.emit('inbox.changed', '{}');
      await vi.advanceTimersByTimeAsync(250);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(link('18 active workflows')).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(100);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(container.querySelector('[aria-busy="true"]')).not.toBeNull());
      expect(link('18 active workflows')).toBeInTheDocument();
      expect(screen.getByText('updating')).toHaveClass('cd-pill');
      await expectNoViolations(container);

      resolve(jsonResponse(next));
      await waitFor(() => expect(link('19 active workflows')).toBeInTheDocument());
      expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('FR-034 the live pill reports reconnecting while the stream is down', async () => {
    renderApp(<DashboardScreen me={adminMe} initial={populated} />);
    expect(screen.getByText('live')).toBeInTheDocument();
    sources[0]!.emit('error', '');
    await waitFor(() => expect(screen.getByText('reconnecting')).toHaveClass('cd-pill'));
  });

  it('FR-023 a failed refetch shows a retryable alert over the last good snapshot and Retry refetches and focuses the title', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(problem(500));
    const { container } = renderApp(<DashboardScreen me={adminMe} initial={populated} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Window' }), '30d');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the dashboard.");
    expect(link('18 active workflows')).toBeInTheDocument();
    expect(updatedAt()).toBe(populated.generatedAt);
    await expectNoViolations(container);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...populated, window: { ...populated.window, key: '30d' } }),
    );
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      new URL(String(fetchMock.mock.calls[1]![0]), 'http://localhost').searchParams.get('window'),
    ).toBe('30d');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('FR-025 a project with nothing active explains the empty list and offers to show all projects', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(jsonResponse(allProjects));
    const { container } = renderApp(<DashboardScreen me={me} initial={empty} />);
    expect(link('0 active workflows')).toHaveAttribute('href', empty.counts.activeWorkflows.href);
    expect(link('0 approvals')).toHaveAttribute('href', '/approvals');
    const list = within(region('Active workflows (0)')).getByRole('group', {
      name: 'Active workflows',
    });
    expect(list).toHaveTextContent('No active workflows in Web App.');
    expect(saffron(container)).toBe(0);
    await expectNoViolations(container);

    await user.click(within(list).getByRole('button', { name: 'Show all projects' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      new URL(String(fetchMock.mock.calls[0]![0]), 'http://localhost').searchParams.get('project'),
    ).toBe('all');
    expect(screen.getByRole('combobox', { name: 'Project' })).toHaveValue('all');
  });

  it('FR-025 the all-projects empty state has no project name and no reset control', () => {
    renderApp(<DashboardScreen me={me} initial={{ ...empty, project: 'all' }} />);
    expect(screen.getByText('No active workflows.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show all projects' })).toBeNull();
  });

  it('SC-010 the populated and zero-denominator dashboards have no WCAG 2.2 AA violations and no saffron control', async () => {
    const a = renderApp(<DashboardScreen me={adminMe} initial={populated} />);
    expect(saffron(a.container)).toBe(0);
    expect(a.container.querySelector('.cd-btn.cd-saffron, .cd-meter .cd-warn')).toBeNull();
    expect(a.container.querySelectorAll('.cd-pill.cd-wait, .cd-pill.cd-needs-you').length).toBe(
      cards.filter((c) => c.state === 'WAITING' || c.state === 'WAITING_FOR_HUMAN').length,
    );
    await expectNoViolations(a.container);
    a.unmount();

    const b = renderApp(<DashboardScreen me={adminMe} initial={zeroDenominators} />);
    await expectNoViolations(b.container);
    b.unmount();

    const c = renderApp(<DashboardScreen me={adminMe} initial={{ ...empty, project: 'all' }} />);
    await expectNoViolations(c.container);
  });
});
