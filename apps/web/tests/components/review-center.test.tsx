import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVIEW_LANE_WORDS, REVIEW_LANES } from '@cdevi/contracts/review-model';
import { ReviewCenterScreen } from '../../app/(app)/reviews/[id]/ReviewCenterScreen';
import { expectNoViolations, renderApp } from '../a11y';
import { fetchMock, installLiveMocks, jsonResponse, problem, sources } from '../live';
import {
  FINDING_IDS,
  NOW,
  PR_ID,
  REQUIREMENT_ID,
  WORKFLOW_ID,
  applyFixResult,
  createIssueResult,
  dismissResult,
  readyView,
  reviewView,
} from '../fixtures/reviews';

beforeEach(() => {
  installLiveMocks();
  window.location.hash = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const changed = (workflowId: string) =>
  sources[0]!.emit('inbox.changed', JSON.stringify({ workflowId, table: 'review_findings' }));

const findingsTab = () => screen.getByRole('tab', { name: /^Findings \(\d+\)$/ });
const cyclesTab = () => screen.getByRole('tab', { name: /^Cycles \(\d+\)$/ });
const finding = (position: number) => document.getElementById(`finding-${position}`)!;
const findingRows = () =>
  Array.from(screen.getByRole('list', { name: 'Findings' }).children).filter(
    (el) => el.tagName === 'LI',
  );
const saffron = (c: Element) => c.querySelectorAll('.cd-saffron').length;
const lastCall = () => fetchMock.mock.calls.at(-1) as [string, RequestInit];

describe('PR Review Center (specs/001 US6)', () => {
  it('FR-020 Review Center renders PR id, requirement, status and 7 lane results', () => {
    const view = reviewView();
    renderApp(<ReviewCenterScreen initial={view} userRole="engineer" now={NOW} />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'PR #1821 — PAY-1391 Refund processing',
    );
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Reviews' })).toHaveAttribute(
      'href',
      '/reviews',
    );

    const header = screen.getByRole('region', { name: 'Pull request' });
    expect(within(header).getByRole('link', { name: view.requirement!.title })).toHaveAttribute(
      'href',
      `/requirements/${REQUIREMENT_ID}`,
    );
    expect(within(header).getByRole('link', { name: view.workflow.name })).toHaveAttribute(
      'href',
      `/workflows/${WORKFLOW_ID}`,
    );
    expect(
      within(header).getByRole('link', { name: /#1821 on GitHub|Open pull request/ }),
    ).toHaveAttribute('href', view.pullRequest.href);
    expect(header).toHaveTextContent('Review cycle #3');
    expect(header.querySelector(`time[datetime="${view.latestReview!.startedAt}"]`)).not.toBeNull();
    expect(
      header.querySelector(`time[datetime="${view.latestReview!.finishedAt}"]`),
    ).not.toBeNull();
    expect(screen.getAllByText('AI review complete').length).toBeGreaterThan(0);

    const lanes = screen.getByRole('group', { name: 'Review lanes' });
    const checks = Array.from(lanes.querySelectorAll('.cd-check'));
    expect(checks).toHaveLength(7);
    expect(checks.map((c) => c.querySelector('span:nth-of-type(2)')?.textContent)).toEqual(
      REVIEW_LANES.map((l) => REVIEW_LANE_WORDS[l]),
    );
    expect(within(lanes).getAllByRole('img', { name: 'passed' })).toHaveLength(5);
    expect(within(lanes).getAllByRole('img', { name: 'waiting' })).toHaveLength(1);
    expect(within(lanes).getAllByRole('img', { name: 'failed' })).toHaveLength(1);
    expect(checks[1]).toHaveTextContent('Authorization gap on the refund endpoint');
    expect(lanes.querySelectorAll('.cd-src')).toHaveLength(7);
  });

  it('FR-020 finding shows severity, blocking, lane, impact, evidence locator and recommended fix', () => {
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    expect(findingsTab()).toHaveAttribute('aria-selected', 'true');
    // Direct children only: each finding's evidence is a nested list of its own.
    expect(findingRows()).toHaveLength(7);

    const f2 = finding(2);
    expect(f2).toHaveTextContent('critical');
    expect(f2).toHaveTextContent('blocking');
    expect(f2).toHaveTextContent('Security');
    expect(f2).toHaveTextContent(
      'Refund endpoint does not verify authorization against the original payment owner',
    );
    expect(f2).toHaveTextContent('POST /refunds loads the payment by id');
    expect(f2).toHaveTextContent("A user may potentially refund another user's payment.");
    expect(within(f2).getByRole('link', { name: /RefundController\.java:84/ })).toHaveAttribute(
      'href',
      expect.stringContaining('RefundController.java#L84'),
    );
    expect(f2).toHaveTextContent('Validate payment ownership before processing.');

    // Non-open findings show their state as a word; dismissed shows the reason.
    expect(finding(4)).toHaveTextContent('fixed');
    expect(finding(5)).toHaveTextContent('dismissed');
    expect(finding(5)).toHaveTextContent('Covered by the payments-ledger contract suite');
    expect(within(finding(5)).queryByRole('button', { name: 'Apply Fix' })).toBeNull();
  });

  it('evidence with accessible:false renders access restricted text', () => {
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    const f2 = finding(2);
    expect(f2).toHaveTextContent('Threat model — refunds');
    expect(f2).toHaveTextContent('access restricted');
    expect(within(f2).queryByRole('link', { name: /Threat model/ })).toBeNull();
  });

  it('FR-022 blocking notice is rendered when readyForMerge is false and never hidden', async () => {
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    const notice = screen.getByRole('alert');
    expect(notice).toHaveTextContent('Not ready for merge approval — 1 blocking finding open');
    expect(notice).toHaveTextContent('not ready');
    // Above the tabs and still there after switching tabs.
    const tablist = screen.getByRole('tablist');
    expect(notice.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(cyclesTab());
    expect(screen.getByRole('alert')).toHaveTextContent('Not ready for merge approval');
  });

  it('FR-022 ready notice is shown when there are no blocking findings open', () => {
    renderApp(<ReviewCenterScreen initial={readyView()} userRole="engineer" now={NOW} />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Ready for merge approval — no blocking findings open/)).toBeVisible();
  });

  it('FR-021 Dismiss requires a reason before submitting', async () => {
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    const f2 = finding(2);
    await userEvent.click(within(f2).getByRole('button', { name: 'Dismiss' }));
    const reason = within(f2).getByLabelText('Reason');
    expect(reason).toBeRequired();
    expect(reason).toHaveAttribute('maxlength', '240');

    await userEvent.click(within(f2).getByRole('button', { name: 'Confirm dismiss' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(within(f2).getByText('A reason is required.')).toBeInTheDocument();
    expect(reason).toHaveFocus();

    fetchMock.mockResolvedValueOnce(jsonResponse(dismissResult('False positive')));
    await userEvent.type(reason, 'False positive');
    await userEvent.click(within(f2).getByRole('button', { name: 'Confirm dismiss' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = lastCall();
    expect(url).toBe(`/api/reviews/${PR_ID}/findings/${FINDING_IDS[1]}/dismiss`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'False positive' });
    await waitFor(() => expect(finding(2)).toHaveTextContent('dismissed'));
    expect(finding(2)).toHaveTextContent('False positive');
    expect(within(finding(2)).queryByRole('button', { name: 'Apply Fix' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Ready for merge approval/)).toBeInTheDocument();
  });

  it('FR-021 Dismiss Cancel closes the form without a request', async () => {
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    const f1 = finding(1);
    await userEvent.click(within(f1).getByRole('button', { name: 'Dismiss' }));
    expect(within(f1).getByLabelText('Reason')).toBeInTheDocument();
    await userEvent.click(within(f1).getByRole('button', { name: 'Cancel' }));
    expect(within(f1).queryByLabelText('Reason')).toBeNull();
    expect(within(f1).getByRole('button', { name: 'Dismiss' })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('FR-021 Apply Fix posts and shows the new review cycle counts', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(applyFixResult()));
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    expect(cyclesTab()).toHaveTextContent('Cycles (3)');
    await userEvent.click(within(finding(2)).getByRole('button', { name: 'Apply Fix' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = lastCall();
    expect(url).toBe(`/api/reviews/${PR_ID}/findings/${FINDING_IDS[1]}/fix`);
    expect(init.method).toBe('POST');

    await waitFor(() => expect(cyclesTab()).toHaveTextContent('Cycles (4)'));
    expect(cyclesTab()).toHaveAttribute('aria-selected', 'true');
    const cycles = screen.getByRole('list', { name: 'Review cycles' });
    const cards = within(cycles).getAllByRole('listitem');
    expect(cards[0]).toHaveTextContent('Review Cycle #4');
    expect(cards[0]).toHaveTextContent('running');
    const terms = within(cards[0]!)
      .getAllByRole('term')
      .map((t) => t.textContent);
    expect(terms).toEqual(expect.arrayContaining(['Findings', 'Fixed', 'Remaining']));
    const defs = within(cards[0]!)
      .getAllByRole('definition')
      .map((d) => d.textContent);
    expect(defs.slice(0, 3)).toEqual(['5', '0', '5']);
    const meter = within(cards[0]!).getByRole('meter', { name: 'Iteration 4 of 5' });
    expect(meter).toHaveAttribute('aria-valuenow', '4');
    expect(meter).toHaveAttribute('aria-valuemax', '5');
    await waitFor(() => expect(cards[0]).toHaveFocus());

    await userEvent.click(findingsTab());
    expect(finding(2)).toHaveTextContent('fix requested');
    expect(within(finding(2)).queryByRole('button', { name: 'Apply Fix' })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('1 blocking finding open');
  });

  it('FR-021 Create Issue shows Issue requested pill', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(createIssueResult(1)));
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    await userEvent.click(within(finding(1)).getByRole('button', { name: 'Create Issue' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(lastCall()[0]).toBe(`/api/reviews/${PR_ID}/findings/${FINDING_IDS[0]}/issue`);
    await waitFor(() => expect(finding(1)).toHaveTextContent('issue requested'));
    expect(within(finding(1)).queryByRole('button', { name: 'Create Issue' })).toBeNull();
    expect(finding(1).querySelector('.cd-saffron')).toBeNull();
  });

  it('FR-021 409 shows the recorded outcome', async () => {
    const recorded = reviewView({
      findings: reviewView().findings.map((f) =>
        f.position === 1 ? { ...f, state: 'ISSUE_REQUESTED' as const, issueRequestedAt: NOW } : f,
      ),
    });
    fetchMock
      .mockResolvedValueOnce(problem(409, 'Finding already has outcome ISSUE_REQUESTED'))
      .mockResolvedValueOnce(jsonResponse(recorded));
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    await userEvent.click(within(finding(1)).getByRole('button', { name: 'Apply Fix' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![0]).toBe(`/api/reviews/${PR_ID}`);
    const notice = await screen.findByText(/already/);
    expect(notice.closest('[role="status"], [role="alert"]')).toHaveTextContent(
      'Finding already has outcome ISSUE_REQUESTED',
    );
    await waitFor(() => expect(finding(1)).toHaveTextContent('issue requested'));
  });

  it('FR-032 viewer sees disabled actions with explanation', () => {
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="viewer" now={NOW} />);
    const f2 = finding(2);
    for (const name of ['Apply Fix', 'Dismiss', 'Create Issue']) {
      const b = within(f2).getByRole('button', { name });
      expect(b).toBeDisabled();
      const describedBy = b.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy!)).toHaveTextContent(
        'Viewers can read findings but cannot act on them',
      );
    }
    expect(screen.getByText('Viewers can read findings but cannot act on them')).toBeVisible();
  });

  it('FR-021 a 403 shows the problem detail and keeps the finding open', async () => {
    fetchMock.mockResolvedValueOnce(problem(403, 'Viewers cannot act on findings'));
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    await userEvent.click(within(finding(1)).getByRole('button', { name: 'Create Issue' }));
    expect(await screen.findByText('Viewers cannot act on findings')).toBeInTheDocument();
    expect(within(finding(1)).getByRole('button', { name: 'Create Issue' })).toBeEnabled();
  });

  it('filters findings by lane, severity and state', async () => {
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    const list = findingRows;
    await userEvent.selectOptions(screen.getByLabelText('Lane'), 'security');
    expect(list()).toHaveLength(1);
    expect(list()[0]).toHaveTextContent('Refund endpoint does not verify authorization');
    await userEvent.selectOptions(screen.getByLabelText('Lane'), 'all');
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'MEDIUM');
    expect(list()).toHaveLength(2);
    await userEvent.selectOptions(screen.getByLabelText('State'), 'DISMISSED');
    expect(list()).toHaveLength(1);
    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'all');
    await userEvent.selectOptions(screen.getByLabelText('State'), 'FIXED');
    expect(list()).toHaveLength(1);
    expect(list()[0]).toHaveTextContent('Partial refund amount');
    await userEvent.selectOptions(screen.getByLabelText('State'), 'FIX_REQUESTED');
    expect(screen.getByText(/No findings match/)).toBeInTheDocument();
  });

  it('deep link #finding-2 targets the finding', async () => {
    window.location.hash = '#finding-2';
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    expect(findingsTab()).toHaveAttribute('aria-selected', 'true');
    const target = finding(2);
    expect(target).not.toBeNull();
    await waitFor(() => expect(target).toHaveFocus());
    expect(target).toHaveTextContent('Refund endpoint does not verify authorization');
  });

  it('a later #finding-n hash re-selects Findings after the user chose Cycles', async () => {
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    await userEvent.click(cyclesTab());
    expect(cyclesTab()).toHaveAttribute('aria-selected', 'true');
    window.location.hash = '#finding-3';
    act(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
    expect(findingsTab()).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(finding(3)).toHaveFocus());
  });

  it('cycles tab lists cycles newest first with counts and an iteration meter', async () => {
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    await userEvent.click(cyclesTab());
    const cards = within(screen.getByRole('list', { name: 'Review cycles' })).getAllByRole(
      'listitem',
    );
    expect(cards.map((c) => within(c).getByRole('heading', { level: 3 }).textContent)).toEqual([
      'Review Cycle #3',
      'Review Cycle #2',
      'Review Cycle #1',
    ]);
    expect(within(cards[0]!).getByRole('meter', { name: 'Iteration 3 of 5' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    expect(cards[0]).toHaveTextContent('completed');
    expect(screen.queryByRole('button', { name: /Run Again|Escalate/ })).toBeNull();
  });

  it('no saffron button on the Review Center', async () => {
    const { container } = renderApp(
      <ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />,
    );
    expect(saffron(container)).toBe(0);
    await userEvent.click(within(finding(2)).getByRole('button', { name: 'Dismiss' }));
    expect(saffron(container)).toBe(0);
    await userEvent.click(cyclesTab());
    expect(saffron(container)).toBe(0);
  });

  it('FR-034 refetches on inbox.changed without scroll reset', async () => {
    const view = reviewView();
    const next = reviewView({
      findings: view.findings.map((f) =>
        f.position === 2 ? { ...f, state: 'FIXED' as const } : f,
      ),
      readyForMerge: true,
      blockingOpenCount: 0,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(next));
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    renderApp(<ReviewCenterScreen initial={view} userRole="engineer" now={NOW} />);
    expect(sources).toHaveLength(1);

    await userEvent.click(cyclesTab());
    expect(cyclesTab()).toHaveFocus();

    changed('someone-else');
    await new Promise((r) => setTimeout(r, 400));
    expect(fetchMock).not.toHaveBeenCalled();

    const t0 = Date.now();
    changed(WORKFLOW_ID);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(lastCall()[0]).toBe(`/api/reviews/${PR_ID}`);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByText(/Ready for merge approval/)).toBeInTheDocument();
    expect(cyclesTab()).toHaveAttribute('aria-selected', 'true');
    expect(cyclesTab()).toHaveFocus();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('FR-034 a new review cycle keeps the reading position and focused finding across the live refetch', async () => {
    // A new review row gives every finding a new uuid (same externalId); the blocking notice goes away.
    const view = reviewView();
    const next = reviewView({
      findings: view.findings.map((f) => ({
        ...f,
        id: `${f.id.slice(0, -4)}beef`,
        state: f.blocking === 'BLOCKING' ? ('FIXED' as const) : f.state,
      })),
      readyForMerge: true,
      blockingOpenCount: 0,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(next));
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderApp(<ReviewCenterScreen initial={view} userRole="engineer" now={NOW} />);
    expect(screen.getByText(/Not ready for merge approval/)).toBeInTheDocument();

    const row = finding(2);
    act(() => row.focus());
    expect(row).toHaveFocus();
    const rowCount = findingRows().length;

    changed(WORKFLOW_ID);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByText(/Ready for merge approval/);

    expect(document.getElementById('finding-2')).toBe(row);
    expect(row).toBeInTheDocument();
    expect(row).toHaveFocus();
    expect(within(row).getByText(/^fixed$/)).toBeInTheDocument();
    expect(findingRows()).toHaveLength(rowCount);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(findingsTab()).toHaveAttribute('aria-selected', 'true');
  });

  it('FR-034 an action result that arrives after a newer review snapshot does not overwrite it', async () => {
    const view = reviewView();
    const newer = reviewView({
      findings: view.findings.map((f) => ({
        ...f,
        id: `${f.id.slice(0, -4)}beef`,
        state: f.blocking === 'BLOCKING' ? ('FIXED' as const) : f.state,
      })),
      readyForMerge: true,
      blockingOpenCount: 0,
    });
    let resolveFix: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolveFix = r)));
    renderApp(<ReviewCenterScreen initial={view} userRole="engineer" now={NOW} />);

    await userEvent.click(within(finding(2)).getByRole('button', { name: 'Apply Fix' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockResolvedValueOnce(jsonResponse(newer));
    changed(WORKFLOW_ID);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(finding(2)).toHaveTextContent('fixed'));

    resolveFix(jsonResponse(applyFixResult()));
    await waitFor(() =>
      expect(within(finding(2)).queryByRole('button', { name: 'Apply Fix' })).toBeNull(),
    );
    expect(finding(2)).toHaveTextContent('fixed');
    expect(finding(2)).not.toHaveTextContent('fix requested');
    expect(screen.getByText(/Ready for merge approval/)).toBeInTheDocument();
    expect(cyclesTab()).toHaveTextContent('Cycles (3)');
  });

  it('FR-034 a failed refetch shows a retryable error notice and keeps the last good model', async () => {
    fetchMock
      .mockResolvedValueOnce(problem(500, 'boom'))
      .mockResolvedValueOnce(jsonResponse(reviewView()));
    renderApp(<ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />);
    changed(WORKFLOW_ID);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('PR #1821');
    await userEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull());
  });

  it('FR-022 no latest review yet renders pending lanes, an empty findings notice and no readiness verdict', () => {
    renderApp(
      <ReviewCenterScreen
        initial={reviewView({
          latestReview: null,
          findings: [],
          cycles: [],
          readyForMerge: true,
          blockingOpenCount: 0,
        })}
        userRole="engineer"
        now={NOW}
      />,
    );
    const lanes = screen.getByRole('group', { name: 'Review lanes' });
    expect(within(lanes).getAllByRole('img', { name: 'not yet checked' })).toHaveLength(7);
    expect(screen.getByText(/No findings reported yet/)).toBeInTheDocument();
    expect(screen.getByText(/Merge readiness is unknown/)).toBeInTheDocument();
    expect(screen.queryByText(/Ready for merge approval/)).toBeNull();
    expect(screen.queryByText(/Not ready for merge approval/)).toBeNull();
  });

  it('axe: no violations', async () => {
    const { container } = renderApp(
      <ReviewCenterScreen initial={reviewView()} userRole="engineer" now={NOW} />,
    );
    await expectNoViolations(container);
    await userEvent.click(within(finding(2)).getByRole('button', { name: 'Dismiss' }));
    await expectNoViolations(container);
    await userEvent.click(cyclesTab());
    await expectNoViolations(container);
  });

  it('axe: no violations for the viewer', async () => {
    const { container } = renderApp(
      <ReviewCenterScreen initial={reviewView()} userRole="viewer" now={NOW} />,
    );
    await expectNoViolations(container);
  });
});
