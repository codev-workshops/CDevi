import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprovalDecisionScreen } from '../../app/(app)/approvals/[id]/ApprovalDecisionScreen';
import { expectNoViolations, renderApp } from '../a11y';
import {
  approvalDetail,
  auditEvent,
  clarificationDetail,
  critical,
  lowRiskDetail,
  resolution,
} from '../fixtures/approval-center';

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
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, body: init.body ? JSON.parse(String(init.body)) : null };
};

beforeEach(() => {
  fetchMock.mockReset();
  sources.length = 0;
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('EventSource', FakeSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('Approval decision screen (specs/001 US2)', () => {
  it('FR-012 shows the ask, risk, requester, workflow, context and links for a pending approval', () => {
    const d = approvalDetail();
    renderApp(<ApprovalDecisionScreen initial={d} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(critical.ask);
    expect(screen.getByRole('link', { name: 'Back to Approval Center' })).toHaveAttribute(
      'href',
      '/approvals',
    );
    expect(screen.getAllByText('critical risk').length).toBeGreaterThan(0);
    expect(screen.getAllByText('needs you').length).toBeGreaterThan(0);

    const context = screen.getByRole('region', { name: 'Context' });
    expect(context).toHaveTextContent('Implementation Agent');
    expect(context).toHaveTextContent('WF-100');
    expect(context).toHaveTextContent('PAY · Payments API');
    expect(within(context).getByRole('heading', { name: 'What is being requested' })).toBeVisible();
    expect(context).toHaveTextContent(d.approval!.context!);

    const links = screen.getByRole('list', { name: 'Links' });
    expect(within(links).getByRole('link', { name: 'Requirement' })).toHaveAttribute(
      'href',
      '/requirements/REQ-42',
    );
    expect(within(links).getByRole('link', { name: 'Pull request' })).toHaveAttribute(
      'href',
      'https://github.com/acme/payments-api/pull/482',
    );
  });

  it('FR-012 approves a LOW-risk approval in one click and shows the resolution', async () => {
    const user = userEvent.setup();
    const d = lowRiskDetail();
    const resolved = lowRiskDetail({
      workflowState: 'RUNNING',
      resolution: resolution({ by: { id: null, name: 'Approver 1' } }),
      audit: [
        auditEvent({ riskLevel: 'LOW', actor: { type: 'user', id: null, name: 'Approver 1' } }),
      ],
    });
    fetchMock.mockResolvedValueOnce(jsonResponse({ detail: resolved }));
    renderApp(<ApprovalDecisionScreen initial={d} />);

    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toHaveClass('cd-saffron');
    expect(
      screen.getAllByRole('button').filter((b) => b.classList.contains('cd-saffron')),
    ).toHaveLength(1);
    await user.click(approve);

    expect(lastCall().url).toBe(`/api/approvals/${d.item.id}/approve`);
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Approved by Approver 1');
    expect(status).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.getAllByText('running').length).toBeGreaterThan(0);
  });

  it('FR-013 requires an explicit confirmation restating the action and risk for HIGH/CRITICAL approvals', async () => {
    const user = userEvent.setup();
    const d = approvalDetail();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        detail: approvalDetail({ workflowState: 'RUNNING', resolution: resolution() }),
      }),
    );
    renderApp(<ApprovalDecisionScreen initial={d} />);

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(fetchMock).not.toHaveBeenCalled();

    const confirm = screen.getByRole('button', { name: 'Confirm approval' });
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveClass('cd-saffron');
    const restated = screen.getByRole('status');
    expect(restated).toHaveTextContent(critical.ask);
    expect(restated).toHaveTextContent('critical risk');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(screen.getByRole('button', { name: 'Confirm approval' }));
    expect(lastCall()).toEqual({
      url: `/api/approvals/${d.item.id}/approve`,
      body: { confirmed: true },
    });
    expect(await screen.findByText(/Approved by/)).toBeInTheDocument();
  });

  it('FR-014 rejecting requires a reason and a BLOCKED / CANCELLED choice', async () => {
    const user = userEvent.setup();
    const d = approvalDetail();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        detail: approvalDetail({
          workflowState: 'CANCELLED',
          resolution: resolution({
            outcome: 'rejected',
            reason: 'Key rotation is scheduled for the maintenance window',
            target: 'CANCELLED',
            workflowState: 'CANCELLED',
          }),
        }),
      }),
    );
    renderApp(<ApprovalDecisionScreen initial={d} />);

    await user.click(screen.getByRole('button', { name: 'Reject…' }));
    const reason = screen.getByRole('textbox', { name: 'Reason' });
    expect(reason).toHaveFocus();
    const group = screen.getByRole('group', { name: 'Then move the workflow to' });
    expect(within(group).getByRole('radio', { name: /BLOCKED/ })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('A reason is required.');
    expect(reason).toHaveAttribute('aria-invalid', 'true');

    await user.type(reason, 'Key rotation is scheduled for the maintenance window');
    await user.click(within(group).getByRole('radio', { name: /CANCELLED/ }));
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(lastCall()).toEqual({
      url: `/api/approvals/${d.item.id}/reject`,
      body: { reason: 'Key rotation is scheduled for the maintenance window', target: 'CANCELLED' },
    });
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Rejected by Approver 2');
    expect(screen.getByText('Key rotation is scheduled for the maintenance window')).toBeVisible();
    expect(screen.getAllByText('cancelled').length).toBeGreaterThan(0);
  });

  it('FR-011 answers a clarification with a suggested option or free text, never neither', async () => {
    const user = userEvent.setup();
    const d = clarificationDetail();
    renderApp(<ApprovalDecisionScreen initial={d} />);
    expect(screen.getByRole('heading', { name: 'Why this matters' })).toBeVisible();
    expect(screen.getByText(d.clarification!.whyItMatters!)).toBeVisible();

    const group = screen.getByRole('group', { name: 'Suggested answers' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(within(group).getByText('Recommended')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Answer' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(group).getByRole('alert')).toHaveTextContent(
      'Choose an option or write an answer.',
    );

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        detail: clarificationDetail({
          workflowState: 'RUNNING',
          resolution: resolution({
            outcome: 'answered',
            answer: { option: 'ip-account', text: 'Per IP and per authenticated account' },
          }),
        }),
      }),
    );
    await user.click(within(group).getByRole('radio', { name: /Per IP and per authenticated/ }));
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(lastCall()).toEqual({
      url: `/api/clarifications/${d.item.id}/answer`,
      body: { option: 'ip-account' },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Answered by Approver 2');
    expect(screen.getByText('Per IP and per authenticated account')).toBeVisible();
  });

  it('FR-011 free-text answers post trimmed text', async () => {
    const user = userEvent.setup();
    const d = clarificationDetail();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        detail: clarificationDetail({
          workflowState: 'RUNNING',
          resolution: resolution({
            outcome: 'answered',
            answer: { option: null, text: 'Per team' },
          }),
        }),
      }),
    );
    renderApp(<ApprovalDecisionScreen initial={d} />);
    await user.click(screen.getByRole('radio', { name: 'Other (write an answer)' }));
    const text = screen.getByRole('textbox', { name: 'Answer' });
    await user.type(text, '  Per team  ');
    await user.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(lastCall()).toEqual({
      url: `/api/clarifications/${d.item.id}/answer`,
      body: { text: 'Per team' },
    });
    expect(await screen.findByText(/Answered by/)).toBeInTheDocument();
  });

  it('FR-032 engineers and viewers see disabled controls with an explanation', () => {
    renderApp(<ApprovalDecisionScreen initial={approvalDetail({ canDecide: false })} />);
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject…' })).toBeDisabled();
    expect(screen.getByText('Only approvers and administrators can decide.')).toBeVisible();
    expect(document.querySelectorAll('.cd-saffron')).toHaveLength(0);
  });

  it('FR-015 a concurrent resolution (409) shows who resolved it first instead of overwriting', async () => {
    const user = userEvent.setup();
    const d = lowRiskDetail();
    const winner = resolution({ by: { id: null, name: 'Admin 1' } });
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          type: 'urn:cdevi:problem:already-resolved',
          title: 'Already resolved',
          status: 409,
          detail: 'This item was already approved by Admin 1.',
          resolution: winner,
        },
        409,
      ),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(lowRiskDetail({ workflowState: 'RUNNING', resolution: winner })),
    );
    renderApp(<ApprovalDecisionScreen initial={d} />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Approved by Admin 1');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]![0])).toBe(`/api/approvals/${d.item.id}`);
  });

  it('shows a submit error and keeps the controls when the decision fails', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        {
          type: 'urn:cdevi:problem:invalid-transition',
          title: 'Invalid transition',
          status: 409,
          detail: 'Workflow is BLOCKED',
        },
        409,
      ),
    );
    renderApp(<ApprovalDecisionScreen initial={lowRiskDetail()} />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Workflow is BLOCKED');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('SC-005 refetches the item when the stream announces a change for its workflow', async () => {
    const d = lowRiskDetail();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(lowRiskDetail({ workflowState: 'RUNNING', resolution: resolution() })),
    );
    renderApp(<ApprovalDecisionScreen initial={d} />);
    await waitFor(() => expect(sources).toHaveLength(1));
    sources[0]!.emit('inbox.changed', JSON.stringify({ workflowId: 'other' }));
    expect(fetchMock).not.toHaveBeenCalled();
    sources[0]!.emit('inbox.changed', JSON.stringify({ workflowId: d.item.workflowId }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Approved by/)).toBeInTheDocument();
  });

  it('WCAG 2.2 AA: pending, confirm, reject, clarification, disabled and resolved states have no axe violations', async () => {
    const user = userEvent.setup();
    const states = [
      approvalDetail(),
      clarificationDetail(),
      approvalDetail({ canDecide: false }),
      approvalDetail({
        workflowState: 'RUNNING',
        resolution: resolution(),
        audit: [auditEvent()],
      }),
    ];
    for (const s of states) {
      const { container, unmount } = renderApp(<ApprovalDecisionScreen initial={s} />);
      await expectNoViolations(container);
      unmount();
    }

    const { container, unmount } = renderApp(<ApprovalDecisionScreen initial={approvalDetail()} />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await expectNoViolations(container);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Reject…' }));
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await expectNoViolations(container);
    unmount();
  });
});
