import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunScreen } from '../../app/(app)/agents/runs/[id]/AgentRunScreen';
import { expectNoViolations, renderApp } from '../a11y';
import {
  ALL_FIXTURES,
  NOW,
  WORKFLOW_ID,
  runCompleted,
  runFailedStep,
  runHighRisk,
  runRunning,
  runRunningEmptySteps,
  runRunningNoDecisions,
  runStale,
} from '../fixtures/agent-run';

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
  window.location.hash = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const changed = (workflowId: string) =>
  sources[0]!.emit('inbox.changed', JSON.stringify({ workflowId, table: 'agent_decisions' }));

const decisionsTab = () => screen.getByRole('tab', { name: /^Decisions \(\d+\)$/ });
const timelineTab = () => screen.getByRole('tab', { name: /^Timeline \(\d+\)$/ });

describe('Agent Run Inspector (specs/001 US5)', () => {
  it('FR-016 renders header, steps, timeline and decisions from AgentRunDetail', async () => {
    const run = runRunning();
    const { container } = renderApp(<AgentRunScreen initial={run} now={NOW} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review Agent — Approve');
    expect(screen.getByRole('link', { name: 'Back to workflow' })).toHaveAttribute(
      'href',
      `/workflows/${WORKFLOW_ID}`,
    );
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Workflows' })).toHaveAttribute(
      'href',
      '/workflows',
    );
    expect(within(crumbs).getByRole('link', { name: run.workflow.title })).toHaveAttribute(
      'href',
      `/workflows/${WORKFLOW_ID}`,
    );
    expect(within(crumbs).getByRole('link', { name: 'Stage 6 · Approve' })).toHaveAttribute(
      'href',
      `/workflows/${WORKFLOW_ID}#stage-6`,
    );
    expect(crumbs).toHaveTextContent('Run · Review Agent');

    const header = screen.getByRole('region', { name: 'Run' });
    const terms = within(header)
      .getAllByRole('term')
      .map((t) => t.textContent);
    expect(terms).toEqual(['Agent', 'Workflow', 'Stage', 'Model', 'Started', 'Duration', 'Status']);
    expect(header).toHaveTextContent('Review Agent');
    expect(
      within(header).getByRole('link', { name: `s500-001 · ${run.workflow.title}` }),
    ).toHaveAttribute('href', `/workflows/${WORKFLOW_ID}`);
    expect(header).toHaveTextContent('6. Approve');
    expect(header).toHaveTextContent('fable-5.1');
    expect(header.querySelector(`time[datetime="${run.startedAt}"]`)).not.toBeNull();
    expect(header).toHaveTextContent('20 min ago');
    expect(header).toHaveTextContent('20 min 0 s');
    expect(within(header).getAllByText('running')).not.toHaveLength(0);

    // Summary is the agent's claim, visibly "not evidence" (DR-03).
    const summary = container.querySelector('.cd-msg.cd-summary')!;
    expect(summary).toHaveTextContent(run.summary!);
    expect(summary).toHaveTextContent('not evidence');

    // Structured progress: a checklist, never a spinner.
    const progress = screen.getByRole('region', { name: 'Progress' });
    expect(progress).toHaveTextContent('2 of 4 steps completed');
    const steps = within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual([
      'Review the diff (done)',
      'Check test evidence (done)',
      'Wait for approval to open the PRrunning',
      'Open the pull request',
    ]);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(progress.querySelector('[role="progressbar"], [aria-busy]')).toBeNull();

    // Decisions tab is selected by default when there are decisions; Timeline is oldest first.
    expect(decisionsTab()).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(timelineTab());
    const log = screen.getByLabelText('Agent activity');
    const lines = Array.from(log.querySelectorAll('time')).map((t) => t.getAttribute('datetime'));
    expect(lines).toEqual(run.timeline.map((e) => e.at));
    expect(log).toHaveTextContent('tool · Read the diff of 4 files');
    expect(log).toHaveTextContent('error · Policy check timed out once; retried');
    expect(log.querySelector('.cd-ex')).toHaveTextContent('error · Policy check timed out once');
    expect(log).toHaveTextContent('decision · Opening a pull request needs human approval (policy)');

    await userEvent.click(decisionsTab());
    const list = screen.getByRole('list', { name: 'Decisions' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(list.querySelector('#decision-2')).not.toBeNull();
  });

  it('FR-017 decision shows action, reason, confidence, policy outcome and evidence', () => {
    const run = runRunning();
    renderApp(<AgentRunScreen initial={run} now={NOW} />);
    const list = screen.getByRole('list', { name: 'Decisions' });
    const [first, second, third] = within(list).getAllByRole('listitem');

    expect(first).toHaveTextContent('1. Accepted the limiter diff without requesting changes');
    expect(first).toHaveTextContent(run.decisions[0]!.reason);
    expect(within(first!).getByText('allowed')).toHaveClass('cd-done');
    expect(within(first!).getByText('confidence high')).toBeInTheDocument();
    expect(first!.querySelector(`time[datetime="${run.decisions[0]!.decidedAt}"]`)).not.toBeNull();
    const ev1 = within(first!).getByRole('group', { name: 'Evidence for decision 1' });
    const link = within(ev1).getByRole('link', {
      name: 'PAY-231 — rate limiting for /api/auth (opens in a new tab)',
    });
    expect(link).toHaveAttribute('href', 'https://jira.acme.example/browse/PAY-231');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const internal = within(ev1).getByRole('link', { name: 'Test results — all suites' });
    expect(internal).toHaveAttribute('href', `/workflows/${WORKFLOW_ID}#artifact-s500-001-tests`);
    expect(internal).not.toHaveAttribute('target');
    expect(ev1).toHaveTextContent('artifact · s500-001-tests');
    expect(ev1).toHaveTextContent('ticket');

    expect(within(second!).getByText('approval required')).toHaveClass('cd-wait');
    expect(within(second!).getByText('confidence medium')).toBeInTheDocument();
    expect(second).toHaveTextContent('policy POL-PR-01');
    expect(within(second!).getByText(/medium risk/)).toBeInTheDocument();

    expect(within(third!).getByText('denied')).toHaveClass('cd-fail');
    expect(third).toHaveTextContent('policy POL-SEC-04');
    // Neither outcome that stops the agent is green (DR-04).
    expect(within(second!).getByText('approval required')).not.toHaveClass('cd-done');
    expect(within(third!).getByText('denied')).not.toHaveClass('cd-done');
  });

  it('FR-026 a decision with riskLevel renders the RiskBadge; none otherwise', () => {
    renderApp(<AgentRunScreen initial={runHighRisk()} now={NOW} />);
    const list = screen.getByRole('list', { name: 'Decisions' });
    expect(within(list).getByText(/high risk/)).toBeInTheDocument();
    expect(within(list).getByText('approval required')).toHaveClass('cd-wait');
  });

  it('FR-018 renders no field other than the contract fields (no reasoning text in DOM)', () => {
    for (const [name, make] of Object.entries(ALL_FIXTURES)) {
      const run = make();
      const { container, unmount } = renderApp(<AgentRunScreen initial={run} now={NOW} />);
      const text = container.textContent ?? '';
      expect(text, name).not.toMatch(/reasoning|chain[- ]?of[- ]?thought|thoughts?:/i);
      expect(container.querySelector('[data-reasoning], .cd-reasoning'), name).toBeNull();
      for (const d of run.decisions) {
        expect(Object.keys(d).sort(), name).toEqual(
          [
            'action',
            'confidence',
            'decidedAt',
            'evidence',
            'id',
            'policyOutcome',
            'policyRef',
            'position',
            'reason',
            'riskLevel',
          ].sort(),
        );
      }
      unmount();
    }
  });

  it('restricted evidence renders "access restricted" without an anchor', () => {
    renderApp(<AgentRunScreen initial={runRunning()} now={NOW} />);
    const list = screen.getByRole('list', { name: 'Decisions' });
    const third = within(list).getAllByRole('listitem')[2]!;
    const ev = within(third).getByRole('group', { name: 'Evidence for decision 3' });
    expect(ev).toHaveTextContent('config/production.secrets.env — access restricted');
    expect(ev).toHaveTextContent('file · config/production.secrets.env:1 · not available to you');
    expect(within(ev).queryAllByRole('link')).toHaveLength(0);
    expect(ev.querySelector('a')).toBeNull();
    // The rest of the card is intact.
    expect(third).toHaveTextContent('3. Did not read the production secrets file');
  });

  it('FR-004 FR-034 refetches on inbox.changed and updates the Stepper without resetting the tab or focus', async () => {
    const run = runRunning();
    const next = runRunning({
      steps: run.steps.map((s) => ({ ...s, status: 'completed' as const })),
      decisions: [...run.decisions],
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(next));
    renderApp(<AgentRunScreen initial={run} now={NOW} />);
    expect(sources).toHaveLength(1);

    await userEvent.click(timelineTab());
    expect(timelineTab()).toHaveFocus();

    changed('someone-else');
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();

    changed(run.workflow.id);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`/api/agent-runs/${run.id}`);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Progress' })).toHaveTextContent(
        '4 of 4 steps completed',
      ),
    );
    expect(screen.getByRole('list', { name: 'Progress' }).querySelector('[aria-current]')).toBeNull();
    expect(timelineTab()).toHaveAttribute('aria-selected', 'true');
    expect(timelineTab()).toHaveFocus();
    expect(screen.getByText('Run updated')).toBeInTheDocument();
  });

  it('FR-034 a failed refetch shows a retryable error notice and keeps the last good model', async () => {
    const run = runRunning();
    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'boom' }, 500));
    fetchMock.mockResolvedValueOnce(jsonResponse(runRunning({ summary: 'Recovered.' })));
    renderApp(<AgentRunScreen initial={run} now={NOW} />);
    changed(run.workflow.id);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("The run couldn't be refreshed");
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review Agent — Approve');
    const retry = within(alert).getByRole('button', { name: 'Retry' });
    expect(retry).not.toHaveClass('cd-saffron');
    await userEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText('Recovered.')).toBeInTheDocument();
  });

  it('FR-016 duration ticks once per second while running and stops when the run finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const run = runRunning();
    renderApp(<AgentRunScreen initial={run} now={NOW} />);
    const header = screen.getByRole('region', { name: 'Run' });
    expect(header).toHaveTextContent('20 min 0 s');
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(header).toHaveTextContent('20 min 3 s');

    // A finished run has a static duration and no "running" pill.
    const done = runCompleted();
    const { container } = renderApp(<AgentRunScreen initial={done} now={NOW} />);
    const doneHeader = within(container).getByRole('region', { name: 'Run' });
    expect(doneHeader).toHaveTextContent('2 h');
    expect(within(doneHeader).queryByText('running')).toBeNull();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(doneHeader).toHaveTextContent('2 h');
  });

  it('stale run shows the Notice and keeps the state pill', () => {
    const run = runStale();
    const { container } = renderApp(<AgentRunScreen initial={run} now={NOW} />);
    const status = screen
      .getAllByRole('status')
      .find((n) => /No activity for/.test(n.textContent ?? ''));
    expect(status).toBeDefined();
    expect(status).toHaveTextContent('No activity for 40 m —');
    expect(status).toHaveTextContent("The run's state is unchanged");
    expect(within(status!).getByRole('link', { name: 'Open workflow' })).toHaveAttribute(
      'href',
      `/workflows/${WORKFLOW_ID}`,
    );
    const pills = container.querySelectorAll('.cd-pill');
    expect(Array.from(pills).map((p) => p.textContent)).toContain('running');
    expect(screen.getByRole('region', { name: 'Run' })).toHaveTextContent('no recent activity');

    // An active run has no stale notice.
    const { container: fresh } = renderApp(<AgentRunScreen initial={runRunning()} now={NOW} />);
    expect(fresh.textContent).not.toMatch(/No activity for/);
  });

  it('empty decisions, empty steps and a failed step render words, never a spinner', () => {
    const { unmount } = renderApp(<AgentRunScreen initial={runRunningNoDecisions()} now={NOW} />);
    expect(timelineTab()).toHaveAttribute('aria-selected', 'true');
    expect(decisionsTab()).toHaveTextContent('Decisions (0)');
    unmount();

    const { unmount: u2 } = renderApp(<AgentRunScreen initial={runRunningEmptySteps()} now={NOW} />);
    const progress = screen.getByRole('region', { name: 'Progress' });
    expect(progress).toHaveTextContent('The runtime has not reported structured progress for this run.');
    expect(progress.querySelector('[role="progressbar"]')).toBeNull();
    u2();

    renderApp(<AgentRunScreen initial={runFailedStep()} now={NOW} />);
    const steps = within(screen.getByRole('list', { name: 'Progress' })).getAllByRole('listitem');
    expect(steps[1]).toHaveTextContent('failed');
    expect(within(steps[1]!).getByText('failed')).toHaveClass('cd-fail');
    expect(screen.getByRole('list', { name: 'Progress' }).querySelector('[aria-current]')).toBeNull();
  });

  it('empty decisions tab shows the info notice when selected', async () => {
    renderApp(<AgentRunScreen initial={runRunningNoDecisions()} now={NOW} />);
    await userEvent.click(decisionsTab());
    const notice = screen.getByText(/No decisions recorded yet/).closest('[role="status"]');
    expect(notice).not.toBeNull();
    expect(screen.getByRole('tabpanel')).toContainElement(notice as HTMLElement);
  });

  it('#decision-n deep link selects the Decisions tab and focuses the card', async () => {
    window.location.hash = '#decision-2';
    renderApp(<AgentRunScreen initial={runRunning()} now={NOW} />);
    expect(decisionsTab()).toHaveAttribute('aria-selected', 'true');
    const card = document.getElementById('decision-2')!;
    await waitFor(() => expect(card).toHaveFocus());
    expect(card).toHaveTextContent('2. Opening the pull request requires approval');
  });

  it('FR-032 no saffron button on the screen in any state', () => {
    for (const [name, make] of Object.entries(ALL_FIXTURES)) {
      const { container, unmount } = renderApp(<AgentRunScreen initial={make()} now={NOW} />);
      expect(container.querySelectorAll('.cd-saffron'), name).toHaveLength(0);
      expect(container.querySelectorAll('input, select, textarea'), name).toHaveLength(0);
      unmount();
    }
  });

  it('SC-010 axe: no violations in every state', async () => {
    for (const make of Object.values(ALL_FIXTURES)) {
      const { container, unmount } = renderApp(<AgentRunScreen initial={make()} now={NOW} />);
      await expectNoViolations(container);
      unmount();
    }
  });
});
