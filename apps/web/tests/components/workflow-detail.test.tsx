import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowDetailScreen } from '../../app/(app)/workflows/[id]/WorkflowDetailScreen';
import { expectNoViolations, renderApp } from '../a11y';
import {
  blockedDetail,
  completedDetail,
  detail,
  detailWithRuns,
  emptyDetail,
  failedDetail,
} from '../fixtures/workflow-detail';
import { PR_ID, workflowPullRequest } from '../fixtures/reviews';

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

const NINE = [
  'queued',
  'running',
  'retrying',
  'waiting',
  'needs you',
  'blocked',
  'failed',
  'completed',
  'cancelled',
];

describe('Workflow Detail (specs/001 US1)', () => {
  it('FR-001 FR-003 shows the ordered pipeline with one state pill per stage, the current stage, agent, elapsed and progress', async () => {
    const d = detail();
    const { container } = renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(d.workflow.title);

    const pipeline = screen.getByRole('list', { name: 'Stage pipeline' });
    const steps = within(pipeline).getAllByRole('listitem');
    expect(steps.map((s) => s.querySelector('b')!.textContent)).toEqual(
      d.stages.map((s) => `${s.position}. ${s.name}`),
    );
    for (const step of steps) {
      const pills = step.querySelectorAll('.cd-pill[data-state]');
      expect(pills).toHaveLength(1);
      expect(NINE).toContain(pills[0]!.textContent);
    }
    const current = steps[5]!;
    expect(current).toHaveAttribute('aria-current', 'step');
    expect(current).toHaveTextContent('Approve Agent');
    expect(current).toHaveTextContent('1 h 20 m');

    const meter = screen.getByRole('meter', { name: 'Progress' });
    expect(meter).toHaveAttribute('aria-valuenow', '5');
    expect(meter).toHaveAttribute('aria-valuemax', '7');
    expect(screen.getByText('5 of 7 stages complete')).toBeInTheDocument();

    const cur = screen.getByRole('region', { name: /Current stage: Approve/ });
    expect(cur).toHaveTextContent('fable-5.1');
    expect(cur).toHaveTextContent('Next stage7. Merge');
    expect(within(cur).getByText(/not evidence/)).toBeInTheDocument();
    expect(cur).toHaveTextContent('Waiting for a human: Approval required before merge');
    await expectNoViolations(container);
  });

  it('FR-016 Workflow Detail stage renders an Inspect run link per agent run, keeps the summary and adds no saffron', async () => {
    const d = detailWithRuns();
    const { container } = renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);
    const pipeline = screen.getByRole('list', { name: 'Stage pipeline' });
    const steps = within(pipeline).getAllByRole('listitem');

    // Stages without runs render nothing to inspect.
    expect(within(steps[0]!).queryAllByRole('link')).toHaveLength(0);

    const test = steps[4]!;
    const [r1, r2] = d.stages[4]!.agentRuns;
    const testLinks = within(test).getAllByRole('link', { name: /^Inspect run/ });
    expect(testLinks).toHaveLength(2);
    expect(testLinks[0]).toHaveAttribute('href', `/agents/runs/${r1!.id}`);
    expect(testLinks[0]).toHaveAccessibleName('Inspect run 1 of 2 by Test Agent, completed');
    expect(testLinks[0]).toHaveTextContent('Inspect run · Test Agent');
    expect(testLinks[1]).toHaveAttribute('href', `/agents/runs/${r2!.id}`);
    expect(testLinks[1]).toHaveAccessibleName('Inspect run 2 of 2 by Test Agent, failed');
    // The stage keeps exactly one visible state pill; each run's state word lives in its link's accessible name.
    expect(test.querySelectorAll('.cd-pill[data-state]')).toHaveLength(1);
    expect(test).toHaveAttribute('id', 'stage-5');

    const cur = steps[5]!;
    const [run] = d.stages[5]!.agentRuns;
    const link = within(cur).getByRole('link', { name: /^Inspect run/ });
    expect(link).toHaveAttribute('href', `/agents/runs/${run!.id}`);
    expect(link).toHaveAccessibleName('Inspect run 1 of 1 by Approve Agent, needs you');
    expect(link).toHaveTextContent(/^Inspect run$/);
    expect(link).not.toHaveClass('cd-btn');

    const region = screen.getByRole('region', { name: /Current stage: Approve/ });
    expect(within(region).getByRole('link', { name: /^Inspect run/ })).toHaveAttribute(
      'href',
      `/agents/runs/${run!.id}`,
    );
    expect(region).toHaveTextContent('Run');
    expect(
      within(region).getByRole('link', { name: /^Inspect run/ }).nextElementSibling,
    ).toHaveClass('cd-pill');
    expect(within(region).getByText(/not evidence/)).toBeInTheDocument();
    expect(region).toHaveTextContent('Waiting for a human: Approval required before merge');

    // The drill-down adds no saffron: the one WAITING_FOR_HUMAN action stays the only one.
    expect(container.querySelectorAll('.cd-saffron')).toHaveLength(1);
    await expectNoViolations(container);
  });

  it('FR-016 Workflow Detail current stage without runs says so', () => {
    renderApp(<WorkflowDetailScreen initial={detail()} userRole="engineer" />);
    const region = screen.getByRole('region', { name: /Current stage: Approve/ });
    expect(region).toHaveTextContent('RunNo run recorded');
    expect(within(region).queryAllByRole('link', { name: /^Inspect run/ })).toHaveLength(0);
  });

  it('FR-004 lists activity in order with timestamps and every artifact tagged with its producing stage', () => {
    const d = detail();
    renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);
    const activity = within(screen.getByRole('list', { name: 'Activity' })).getAllByRole(
      'listitem',
    );
    expect(activity).toHaveLength(d.activity.length);
    expect(activity.map((r) => r.querySelector('.cd-title')!.textContent)).toEqual(
      d.activity.map((e) => e.message),
    );
    for (const [i, row] of activity.entries()) {
      expect(row.querySelector('time')).toHaveAttribute('datetime', d.activity[i]!.at);
      expect(row).toHaveTextContent(d.activity[i]!.source);
    }
    expect(activity[3]).toHaveTextContent('Stage 4');

    const artifacts = within(screen.getByRole('list', { name: 'Artifacts' })).getAllByRole(
      'listitem',
    );
    expect(artifacts).toHaveLength(6);
    const words = artifacts.map((r) => r.querySelector('.cd-trailing')!.textContent);
    expect(words).toEqual([
      'requirement spec',
      'impact analysis',
      'implementation plan',
      'code diff',
      'test results',
      'pull request',
    ]);
    for (const [i, row] of artifacts.entries()) {
      expect(row).toHaveTextContent(`Stage ${d.artifacts[i]!.stage.position}`);
      expect(row).toHaveAttribute('id', `artifact-${d.artifacts[i]!.externalId}`);
    }
    expect(document.getElementById('artifact-s500-001-art3')).toBe(artifacts[2]);
    expect(within(artifacts[5]!).getByRole('link', { name: 'PR #412' })).toHaveAttribute(
      'href',
      'https://example.test/pr/412',
    );
  });

  it('FR-005 renders WAITING_FOR_HUMAN as a saffron decision card with the reason and one direct action, before the pipeline', () => {
    renderApp(<WorkflowDetailScreen initial={detail()} userRole="viewer" />);
    const card = screen.getByRole('region', { name: /Approve — needs you/ });
    expect(card).toHaveClass('cd-decision');
    expect(card).not.toHaveClass('cd-neutral');
    expect(card).toHaveTextContent('Approval required before merge');
    const action = within(card).getByRole('link', { name: 'Open approval' });
    expect(action).toHaveClass('cd-saffron');
    expect(action).toHaveAttribute('href', '/approvals/00000000-0000-7000-8000-0000000000aa');
    expect(document.querySelectorAll('.cd-saffron')).toHaveLength(1);
    expect(card.compareDocumentPosition(screen.getByRole('list', { name: 'Stage pipeline' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(card.closest('[hidden], details')).toBeNull();
  });

  it('FR-005 renders BLOCKED with the same prominence and reason', async () => {
    const { container } = renderApp(
      <WorkflowDetailScreen initial={blockedDetail()} userRole="engineer" />,
    );
    const card = screen.getByRole('region', { name: /Approve — blocked/ });
    expect(card).toHaveTextContent('GitHub is unreachable');
    expect(within(card).getByRole('link', { name: 'Open integrations' })).toHaveClass('cd-saffron');
    await expectNoViolations(container);
  });

  it('FR-006 shows reason, failing stage, last successful stage and retry/escalate/cancel for an engineer', async () => {
    const d = failedDetail();
    const { container } = renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);
    const failure = screen.getByRole('region', { name: 'Workflow failed' });
    expect(failure).toHaveTextContent('Unit tests failed: 3 of 120');
    expect(failure).toHaveTextContent('Stage 5 · Review');
    expect(failure).toHaveTextContent('Last successful stageStage 4 · Test');
    expect(within(failure).getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(within(failure).getByRole('button', { name: 'Escalate' })).toBeEnabled();
    expect(within(failure).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(screen.queryByRole('region', { name: /needs you|blocked/ })).toBeNull();
    await expectNoViolations(container);
  });

  it('FR-006 disables retry and cancel for a viewer and explains why', () => {
    renderApp(
      <WorkflowDetailScreen
        initial={failedDetail({ retry: false, escalate: false, cancel: false })}
        userRole="viewer"
      />,
    );
    const failure = screen.getByRole('region', { name: 'Workflow failed' });
    expect(within(failure).getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(within(failure).getByRole('button', { name: 'Escalate' })).toBeDisabled();
    expect(within(failure).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(failure).toHaveTextContent('Viewers cannot retry, escalate or cancel workflows.');
  });

  it('FR-006 retry posts the action and swaps in the returned detail; cancel needs a second click; escalate sends a note', async () => {
    const user = userEvent.setup();
    const d = failedDetail();
    const retried = detail();
    fetchMock.mockResolvedValueOnce(jsonResponse(retried));
    renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Confirm cancel' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Escalate' }));
    await user.type(screen.getByLabelText('Escalate to (name or group)'), 'platform-leads');
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonResponse(d));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/workflows/${d.workflow.id}/actions`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      action: 'escalate',
      note: 'platform-leads',
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(jsonResponse(retried));
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string),
    ).toEqual({ action: 'retry' });
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Workflow failed' })).toBeNull(),
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(retried.workflow.title);
  });

  it('FR-006 an action failure is announced inline and leaves the page intact', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { type: 'about:blank', title: 'Forbidden', status: 403, detail: 'Not allowed' },
        403,
      ),
    );
    renderApp(<WorkflowDetailScreen initial={failedDetail()} userRole="engineer" />);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed');
    expect(screen.getByRole('region', { name: 'Workflow failed' })).toBeInTheDocument();
  });

  it('FR-034 refetches only on inbox.changed frames for this workflow and keeps content while loading', async () => {
    const d = detail();
    const next = detail();
    next.workflow.title = 'Add rate limiting to /api/auth (updated)';
    fetchMock.mockResolvedValueOnce(jsonResponse(next));
    renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);
    expect(sources).toHaveLength(1);
    const es = sources[0]!;

    es.emit('inbox.changed', JSON.stringify({ workflowId: 'someone-else', table: 'workflows' }));
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();

    es.emit(
      'inbox.changed',
      JSON.stringify({ workflowId: d.workflow.id, table: 'workflow_stages' }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`/api/workflows/${d.workflow.id}`);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(d.workflow.title);
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(next.workflow.title),
    );
  });

  it('FR-034 a stream reconnect refetches once so changes missed while offline are caught up', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const d = detail();
      const next = detail();
      next.workflow.title = 'Add rate limiting to /api/auth (caught up)';
      fetchMock.mockResolvedValue(jsonResponse(next));
      renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);
      const first = sources[0]!;
      first.emit('open', '');
      await vi.advanceTimersByTimeAsync(400);
      expect(fetchMock).not.toHaveBeenCalled();

      first.emit('error', '');
      await vi.advanceTimersByTimeAsync(1000);
      expect(sources).toHaveLength(2);
      const second = sources[1]!;
      second.emit('open', '');
      await vi.advanceTimersByTimeAsync(400);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(next.workflow.title),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('FR-034 a failed refetch shows a retryable notice and keeps the last good detail', async () => {
    const user = userEvent.setup();
    const d = detail();
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);
    sources[0]!.emit('inbox.changed', JSON.stringify({ workflowId: d.workflow.id }));
    const notice = await screen.findByText("Couldn't refresh this workflow.");
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(d.workflow.title);
    fetchMock.mockResolvedValueOnce(jsonResponse(d));
    await user.click(within(notice.closest('.cd-notice')!).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText("Couldn't refresh this workflow.")).toBeNull());
  });

  it('renders completed and empty workflows without actions or prominence and with explicit empty states', async () => {
    const { container, unmount } = renderApp(
      <WorkflowDetailScreen initial={completedDetail()} userRole="engineer" />,
    );
    expect(screen.queryByRole('region', { name: 'Workflow failed' })).toBeNull();
    expect(screen.queryByText(/Open approval/)).toBeNull();
    expect(screen.getByText('7 of 7 stages complete')).toBeInTheDocument();
    expect(screen.getByText('None — workflow complete')).toBeInTheDocument();
    await expectNoViolations(container);
    unmount();

    renderApp(<WorkflowDetailScreen initial={emptyDetail()} userRole="engineer" />);
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    expect(screen.getByText('No artifacts yet.')).toBeInTheDocument();
    expect(screen.getByText('No stages recorded yet.')).toBeInTheDocument();
  });

  it('FR-020 Workflow Detail links to the review', async () => {
    const d = detail({ pullRequest: workflowPullRequest() });
    const { container } = renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);
    const card = screen.getByRole('region', { name: 'Pull request' });
    expect(card).toHaveTextContent('#1821 PAY-1391 Refund processing');
    expect(within(card).getByText('complete')).toHaveClass('cd-pill');
    expect(within(card).getByRole('link', { name: 'Open review' })).toHaveAttribute(
      'href',
      `/reviews/${PR_ID}`,
    );
    expect(within(card).getByRole('link', { name: /Open pull request/ })).toHaveAttribute(
      'href',
      d.pullRequest!.href,
    );
    // FR-022 marker on Workflow Detail, never hidden.
    expect(card).toHaveTextContent('Not ready for merge approval — 1 blocking finding open');
    expect(within(card).getByText('not ready')).toHaveClass('cd-pill');
    expect(card.querySelector('.cd-saffron')).toBeNull();
    await expectNoViolations(container);
  });

  it('FR-022 Workflow Detail shows the ready marker when the pull request has no blocking findings', () => {
    const d = detail({
      pullRequest: workflowPullRequest({ readyForMerge: true, blockingOpenCount: 0 }),
    });
    renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);
    const card = screen.getByRole('region', { name: 'Pull request' });
    expect(card).toHaveTextContent('Ready for merge approval');
    expect(within(card).queryByText(/Not ready/)).toBeNull();
  });

  it('FR-020 Workflow Detail keeps the pullRequestRef fallback when pullRequest is null', () => {
    const d = detail();
    expect(d.pullRequest).toBeNull();
    renderApp(<WorkflowDetailScreen initial={d} userRole="engineer" />);
    expect(screen.queryByRole('region', { name: 'Pull request' })).toBeNull();
    expect(screen.getByText(d.workflow.pullRequestRef!)).toBeInTheDocument();
  });
});
