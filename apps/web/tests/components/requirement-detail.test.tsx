import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequirementDetail } from '@cdevi/contracts';
import { REQUIREMENT_STATES, REQUIREMENT_STATE_WORDS } from '@cdevi/contracts/requirement-rules';
import { requirementStateToPill } from '@cdevi/design-system';
import { RequirementDetailScreen } from '../../app/(app)/requirements/[id]/RequirementDetailScreen';
import { expectNoViolations, renderApp } from '../a11y';
import {
  AGENT_NAME,
  APPROVER,
  ENGINEER,
  PROJECT,
  detailAnalyzing,
  detailApproved,
  detailCompleted,
  detailDraft,
  detailFlagged,
  detailNeedsClarification,
  detailReady,
  detailRejected,
  me,
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
const problem = (status: number, title = 'Nope') =>
  jsonResponse({ type: 'about:blank', title, status }, status);
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null };
};
const saffron = (c: Element) => c.querySelectorAll('.cd-saffron').length;
const region = (name: string) => screen.getByRole('region', { name });
const statePill = (d: RequirementDetail) => {
  const pill = screen
    .getAllByText(requirementStateToPill[d.requirement.state].word)
    .find((el) => el.getAttribute('data-state') === d.requirement.state)!;
  expect(pill).toHaveClass('cd-pill');
  return pill;
};

beforeEach(() => {
  fetchMock.mockReset();
  sources.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('Requirement detail (specs/001 US4, ui-requirements.md §3/§5.2)', () => {
  it('FR-009 REQUIREMENT_STATE_WORDS[state] from @cdevi/contracts/requirement-rules equals requirementStateToPill[state].word from @cdevi/design-system for every state', () => {
    expect(REQUIREMENT_STATES).toHaveLength(8);
    for (const s of REQUIREMENT_STATES) {
      expect(requirementStateToPill[s].word, s).toBe(REQUIREMENT_STATE_WORDS[s]);
    }
  });

  it('FR-009 header shows RequirementStatePill word, external id, project, assignee, creator (or Jira) and the business objective in a Card, not a Message', async () => {
    const d = detailNeedsClarification();
    const { container } = renderApp(<RequirementDetailScreen me={me('engineer')} initial={d} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(d.requirement.title);
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Requirements' })).toHaveAttribute(
      'href',
      '/requirements',
    );
    expect(crumbs).toHaveTextContent('req-seed-003');

    const pill = statePill(d);
    expect(pill).toHaveTextContent('needs clarification');
    expect(pill.closest('[tabindex="-1"]')).not.toBeNull();
    expect(screen.getAllByText('req-seed-003').length).toBeGreaterThan(0);
    expect(screen.getByText(PROJECT.name)).toBeInTheDocument();
    expect(screen.getByText(`Assignee: ${APPROVER.name}`)).toBeInTheDocument();
    expect(screen.getByText(/Created .* by Jira/)).toBeInTheDocument();
    expect(screen.getByText('live')).toHaveClass('cd-pill');

    const objective = region('Business objective');
    expect(objective).toHaveClass('cd-card');
    expect(objective.querySelector('.cd-msg')).toBeNull();
    expect(within(objective).getByText(d.businessObjective).tagName).toBe('P');
    await expectNoViolations(container);
  });

  it('FR-009 header shows the creator name and "Unassigned" for a manual requirement', () => {
    renderApp(<RequirementDetailScreen me={me('engineer')} initial={detailDraft()} />);
    expect(screen.getByText('Assignee: Unassigned')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`Created .* by ${ENGINEER.name}`))).toBeInTheDocument();
  });

  it('FR-009 analysis renders inside Message "Requirement Agent · analysis" with summary, acceptance criteria, rules and open questions, every AI item labelled "AI-generated" and the human criterion "Authored by Engineer 1"', () => {
    const d = detailNeedsClarification();
    renderApp(<RequirementDetailScreen me={me('engineer')} initial={d} />);
    const analysis = region('Analysis');
    const msg = analysis.querySelector('.cd-msg.cd-summary')!;
    expect(msg).not.toBeNull();
    expect(msg).toHaveTextContent(`${AGENT_NAME} · analysis — not evidence`);
    expect(msg).toHaveTextContent(d.analysis!.summary!);

    const list = (name: string) => {
      const h = within(analysis).getByRole('heading', { level: 3, name });
      return h.nextElementSibling as HTMLElement;
    };
    const criteria = list('Acceptance criteria');
    expect(criteria.tagName).toBe('OL');
    expect(within(criteria).getAllByRole('listitem')).toHaveLength(3);
    const human = within(criteria).getByText('Captures below 1 EUR are rejected').closest('li')!;
    expect(within(human).getByText('Authored by Engineer 1')).toHaveClass('cd-pill');
    expect(within(human).queryByText('AI-generated')).toBeNull();

    const rules = list('Identified business rules');
    expect(within(rules).getAllByRole('listitem')).toHaveLength(1);
    const questions = list('Open questions (2)');
    expect(within(questions).getAllByRole('listitem')).toHaveLength(2);

    const aiItems = [
      ...d.analysis!.acceptanceCriteria,
      ...d.analysis!.rules,
      ...d.analysis!.openQuestions,
    ].filter((i) => i.aiGenerated);
    expect(aiItems).toHaveLength(5);
    // summary + every AI item carries the visible label
    expect(within(msg as HTMLElement).getAllByText('AI-generated')).toHaveLength(
      aiItems.length + 1,
    );
    for (const item of aiItems) {
      const li = within(msg as HTMLElement)
        .getByText(item.text)
        .closest('li')!;
      expect(within(li).getByText('AI-generated')).toHaveClass('cd-pill');
    }
    expect(within(analysis).getByText(/^Observed /)).toHaveClass('cd-mono');
  });

  it('FR-009 an analysis without open questions renders "None" under the heading', () => {
    renderApp(<RequirementDetailScreen me={me('approver')} initial={detailReady()} />);
    const analysis = region('Analysis');
    const h = within(analysis).getByRole('heading', { level: 3, name: 'Open questions (0)' });
    expect(h.nextElementSibling).toHaveTextContent('None');
  });

  it('FR-009 DRAFT shows "No analysis yet" and ANALYZING shows the in-progress notice', async () => {
    const draft = renderApp(
      <RequirementDetailScreen me={me('engineer')} initial={detailDraft()} />,
    );
    const analysis = region('Analysis');
    expect(within(analysis).getByRole('status')).toHaveTextContent(
      'No analysis yet — submit the requirement for analysis.',
    );
    expect(analysis.querySelector('.cd-msg')).toBeNull();
    await expectNoViolations(draft.container);
    draft.unmount();

    const analyzing = renderApp(
      <RequirementDetailScreen me={me('engineer')} initial={detailAnalyzing()} />,
    );
    expect(within(region('Analysis')).getByRole('status')).toHaveTextContent(
      'Analysis in progress — results appear here automatically.',
    );
    expect(statePill(detailAnalyzing())).toHaveTextContent('analyzing');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Analysis is in progress')).toBeInTheDocument();
    expect(saffron(analyzing.container)).toBe(0);
    await expectNoViolations(analyzing.container);
  });

  it('FR-032 actions: engineer on DRAFT sees primary "Submit for analysis" and a disabled "Reject…" with help; engineer on NEEDS_CLARIFICATION sees saffron "Resubmit for analysis"; approver on READY sees saffron "Approve" and ghost "Reject…"; viewer sees no buttons and the read-only help; nobody sees actions on APPROVED/COMPLETED/REJECTED', async () => {
    const draft = renderApp(
      <RequirementDetailScreen me={me('engineer')} initial={detailDraft()} />,
    );
    const submit = screen.getByRole('button', { name: 'Submit for analysis' });
    expect(submit).toBeEnabled();
    expect(submit).not.toHaveClass('cd-saffron', 'cd-ghost');
    const reject = screen.getByRole('button', { name: 'Reject…' });
    expect(reject).toHaveAttribute('aria-disabled', 'true');
    expect(reject).toHaveAttribute('aria-describedby');
    expect(document.getElementById(reject.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Only approvers and administrators can approve',
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(saffron(draft.container)).toBe(0);
    await expectNoViolations(draft.container);
    draft.unmount();

    const nc = renderApp(
      <RequirementDetailScreen me={me('engineer')} initial={detailNeedsClarification()} />,
    );
    expect(screen.getByRole('button', { name: 'Resubmit for analysis' })).toHaveClass('cd-saffron');
    expect(screen.getByRole('button', { name: 'Reject…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(saffron(nc.container)).toBe(1);
    nc.unmount();

    const ready = renderApp(
      <RequirementDetailScreen me={me('approver')} initial={detailReady()} />,
    );
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toHaveClass('cd-saffron');
    expect(approve).toBeEnabled();
    const rejectReady = screen.getByRole('button', { name: 'Reject…' });
    expect(rejectReady).toHaveClass('cd-ghost');
    expect(rejectReady).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Submit for analysis/ })).toBeNull();
    expect(saffron(ready.container)).toBe(1);
    await expectNoViolations(ready.container);
    ready.unmount();

    const approverDraft = renderApp(
      <RequirementDetailScreen me={me('approver')} initial={detailDraft('approver')} />,
    );
    const approveDraft = screen.getByRole('button', { name: 'Approve' });
    expect(approveDraft).toHaveAttribute('aria-disabled', 'true');
    expect(
      document.getElementById(approveDraft.getAttribute('aria-describedby')!),
    ).toHaveTextContent('Analysis has not finished');
    expect(screen.getByRole('button', { name: 'Reject…' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Submit for analysis' })).not.toBeNull();
    expect(saffron(approverDraft.container)).toBe(0);
    approverDraft.unmount();

    const viewer = renderApp(
      <RequirementDetailScreen me={me('viewer')} initial={detailReady('viewer')} />,
    );
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('Your role (viewer) is read-only')).toHaveClass('cd-help');
    expect(saffron(viewer.container)).toBe(0);
    await expectNoViolations(viewer.container);
    viewer.unmount();

    for (const d of [detailApproved(), detailCompleted(), detailRejected()]) {
      const r = renderApp(<RequirementDetailScreen me={me('administrator')} initial={d} />);
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(saffron(r.container)).toBe(0);
      r.unmount();
    }
  });

  it('FR-010 Decision card links the workflow "s500-001 · stage 1 of 7" to /workflows/{id} with StatePill queued, or "Not started"', async () => {
    const d = detailApproved();
    const { container, unmount } = renderApp(
      <RequirementDetailScreen me={me('approver')} initial={d} />,
    );
    const decision = region('Decision');
    const wf = d.requirement.workflow!;
    const link = within(decision).getByRole('link', { name: 's500-001 · stage 1 of 7' });
    expect(link).toHaveAttribute('href', `/workflows/${wf.id}`);
    const queued = within(decision).getByText('queued');
    expect(queued).toHaveClass('cd-pill');
    expect(queued).toHaveAttribute('data-state', 'QUEUED');
    expect(decision).toHaveTextContent('Submitted');
    expect(decision).toHaveTextContent(ENGINEER.name);
    expect(decision).toHaveTextContent('Approved');
    expect(decision).toHaveTextContent(APPROVER.name);
    await expectNoViolations(container);
    unmount();

    renderApp(<RequirementDetailScreen me={me('approver')} initial={detailRejected()} />);
    const rejected = region('Decision');
    expect(rejected).toHaveTextContent('Rejected');
    expect(rejected).toHaveTextContent('Out of scope for this quarter');
    expect(rejected).toHaveTextContent('Not started');
    expect(within(rejected).queryByRole('link')).toBeNull();
  });

  it('FR-008 flagged detail shows the Notice tone="error" (role alert) with the Jira key and flag', async () => {
    const d = detailFlagged();
    const { container } = renderApp(<RequirementDetailScreen me={me('approver')} initial={d} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('cd-notice', 'cd-error');
    expect(alert).toHaveTextContent('The linked Jira issue PAY-241 was deleted on');
    expect(alert).toHaveTextContent(
      'The linked workflow is paused in BLOCKED until a person decides.',
    );
    expect(within(alert).getByRole('link', { name: /s500-001/ })).toHaveAttribute(
      'href',
      d.requirement.workflow!.href,
    );
    const jira = screen.getByRole('link', { name: 'Open PAY-241 in Jira (opens in a new tab)' });
    expect(jira).toHaveAttribute('target', '_blank');
    expect(jira).toHaveAttribute('rel', 'noopener noreferrer');
    expect(jira).toHaveAttribute('href', 'https://jira.example.invalid/browse/PAY-241');
    expect(within(region('Decision')).getByText('blocked')).toHaveClass('cd-pill');
    await expectNoViolations(container);
  });

  it('FR-009 clicking Approve posts to /api/requirements/{id}/approve, replaces the detail, moves focus to the state pill; a 409 renders "This requirement was already decided." and re-enables buttons', async () => {
    const user = userEvent.setup();
    const d = detailReady();
    const approved = detailApproved();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...approved, requirement: { ...approved.requirement, id: d.requirement.id } }),
    );
    const { container, unmount } = renderApp(
      <RequirementDetailScreen me={me('approver')} initial={d} />,
    );
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastCall().url).toBe(`/api/requirements/${d.requirement.id}/approve`);
    expect(lastCall().method).toBe('POST');
    await waitFor(() => expect(screen.getByText('approved')).toHaveClass('cd-pill'));
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    const pillHost = screen.getByText('approved').closest('[tabindex="-1"]')!;
    expect(pillHost).toHaveFocus();
    expect(
      within(region('Decision')).getByRole('link', { name: 's500-001 · stage 1 of 7' }),
    ).toBeInTheDocument();
    expect(saffron(container)).toBe(0);
    unmount();

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(problem(409, 'Invalid transition'));
    const again = renderApp(
      <RequirementDetailScreen me={me('approver')} initial={detailReady()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('This requirement was already decided.'),
    );
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reject…' })).toBeEnabled();
    await expectNoViolations(again.container);
    again.unmount();

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(problem(403, 'Forbidden'));
    renderApp(<RequirementDetailScreen me={me('approver')} initial={detailReady()} />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("You can't do that with your role."),
    );
  });

  it('FR-009 Submit for analysis posts to /submit and the ActionBar is busy while in flight', async () => {
    const user = userEvent.setup();
    const d = detailDraft();
    let resolve: (r: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    const { container } = renderApp(<RequirementDetailScreen me={me('engineer')} initial={d} />);
    await user.click(screen.getByRole('button', { name: 'Submit for analysis' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastCall().url).toBe(`/api/requirements/${d.requirement.id}/submit`);
    const bar = container.querySelector('.cd-actions')!;
    expect(bar).toHaveAttribute('aria-busy', 'true');
    for (const b of within(bar as HTMLElement).getAllByRole('button')) {
      expect(b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true').toBe(true);
    }
    resolve(
      jsonResponse({
        ...detailAnalyzing(),
        requirement: { ...detailAnalyzing().requirement, id: d.requirement.id },
      }),
    );
    await waitFor(() => expect(screen.getByText('analyzing')).toHaveClass('cd-pill'));
    expect(bar).not.toHaveAttribute('aria-busy', 'true');
  });

  it('FR-009 Reject… reveals the reason textarea with focus, Confirm rejection posts the reason, Cancel returns focus', async () => {
    const user = userEvent.setup();
    const d = detailReady();
    const rejected = detailRejected();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...rejected, requirement: { ...rejected.requirement, id: d.requirement.id } }),
    );
    const { container } = renderApp(<RequirementDetailScreen me={me('approver')} initial={d} />);
    expect(screen.queryByRole('textbox', { name: 'Reason' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reject…' }));
    const reason = screen.getByRole('textbox', { name: 'Reason' });
    expect(reason).toHaveFocus();
    expect(reason).toHaveAttribute('id', 'reject-reason');
    expect(screen.getByRole('button', { name: 'Confirm rejection' })).toHaveClass('cd-danger');
    await expectNoViolations(container);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Reason' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reject…' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Reject…' }));
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Reason' })).toHaveAttribute('aria-invalid', 'true');

    await user.type(
      screen.getByRole('textbox', { name: 'Reason' }),
      'Out of scope for this quarter',
    );
    await user.click(screen.getByRole('button', { name: 'Confirm rejection' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastCall().url).toBe(`/api/requirements/${d.requirement.id}/reject`);
    expect(lastCall().body).toEqual({ reason: 'Out of scope for this quarter' });
    await waitFor(() => expect(screen.getByText('rejected')).toHaveClass('cd-pill'));
    expect(screen.getByText('rejected').closest('[tabindex="-1"]')).toHaveFocus();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('FR-034 inbox.changed frames with this requirementId or its workflowId refetch; other frames do not', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const d = detailApproved();
      fetchMock.mockResolvedValue(jsonResponse(d));
      renderApp(<RequirementDetailScreen me={me('approver')} initial={d} />);
      expect(sources).toHaveLength(1);
      const es = sources[0]!;
      es.emit('open', '');

      es.emit('inbox.changed', JSON.stringify({ requirementId: 'someone-else' }));
      es.emit('inbox.changed', JSON.stringify({ workflowId: 'another-workflow' }));
      es.emit('inbox.changed', 'not json');
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchMock).not.toHaveBeenCalled();

      es.emit('inbox.changed', JSON.stringify({ requirementId: d.requirement.id }));
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(lastCall().url).toBe(`/api/requirements/${d.requirement.id}`);

      es.emit(
        'inbox.changed',
        JSON.stringify({ workflowId: d.requirement.workflow!.id, table: 'workflows' }),
      );
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('FR-034 the live pill reports reconnecting while the stream is down', async () => {
    renderApp(<RequirementDetailScreen me={me('approver')} initial={detailReady()} />);
    sources[0]!.emit('error', '');
    await waitFor(() => expect(screen.getByText('reconnecting')).toHaveClass('cd-pill'));
  });

  it('FR-002 History lists transitions as words with the actor and renders the audit table', () => {
    const d = detailApproved();
    renderApp(<RequirementDetailScreen me={me('approver')} initial={d} />);
    const history = screen.getByRole('list', { name: 'Requirement history' });
    const rows = within(history).getAllByRole('listitem');
    expect(rows).toHaveLength(d.transitions.length);
    expect(rows[0]).toHaveTextContent('created → draft');
    expect(rows[0]).toHaveTextContent(ENGINEER.name);
    expect(rows[1]).toHaveTextContent('draft → analyzing');
    const table = screen.getByRole('table', { name: 'Audit' });
    expect(table).toHaveTextContent('requirement.submitted');
    expect(table).toHaveTextContent(ENGINEER.name);
  });

  it('SC-010 exactly one .cd-saffron on READY×approver and NEEDS_CLARIFICATION×engineer, zero otherwise; axe passes in every §5.2 state', async () => {
    const cases: Array<[RequirementDetail, ReturnType<typeof me>, number]> = [
      [detailDraft(), me('engineer'), 0],
      [detailDraft('approver'), me('approver'), 0],
      [detailAnalyzing(), me('engineer'), 0],
      [detailNeedsClarification(), me('engineer'), 1],
      [detailNeedsClarification('approver'), me('approver'), 0],
      [detailNeedsClarification('viewer'), me('viewer'), 0],
      [detailReady('engineer'), me('engineer'), 0],
      [detailReady(), me('approver'), 1],
      [detailReady('administrator'), me('administrator'), 1],
      [detailApproved(), me('approver'), 0],
      [detailCompleted(), me('engineer'), 0],
      [detailRejected(), me('approver'), 0],
      [detailFlagged(), me('approver'), 0],
    ];
    for (const [d, m, expected] of cases) {
      const r = renderApp(<RequirementDetailScreen me={m} initial={d} />);
      expect(saffron(r.container), `${d.requirement.state} × ${m.user.role}`).toBe(expected);
      await expectNoViolations(r.container);
      r.unmount();
    }
  });
});
