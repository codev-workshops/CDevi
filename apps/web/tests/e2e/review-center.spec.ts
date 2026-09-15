import { createPool } from '@cdevi/db';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';
import { API, expectAxeClean, signIn } from './helpers';

// Review Center Independent Test (specs/001 US6, plan Part F, UI spec §20–22): the seeded pull request `pr-1821`
// (#1821 "PAY-1391 Refund processing" on `s500-001`, findings `find-1821-1…7`, cycles #1–#3) is read as-is first;
// the tests that act on it (Dismiss, Create Issue, Apply Fix + runtime ingest) run after the read-only ones, in
// file order, and leave the fix loop closed — no later suite reads this PR's state.

const HEADERS = {
  authorization: `Bearer ${E2E.ingestToken}`,
  'content-type': 'application/json',
};
const PR_EXT = 'pr-1821';
const PR_TITLE = 'PAY-1391 Refund processing';
const LANE_KEYS = [
  'correctness',
  'security',
  'dependencies',
  'edge_cases',
  'testing',
  'architecture',
  'general',
] as const;
const LANES = [
  'Correctness',
  'Security',
  'Dependencies',
  'Edge Cases',
  'Testing',
  'Architecture',
  'General',
] as const;
const NOT_READY = 'Not ready for merge approval — 1 blocking finding open';
const READY = 'Ready for merge approval — no blocking findings open.';
const VIEWER_EXPLANATION = 'Viewers can read findings but cannot act on them';
const MIN = 60_000;
/** Runtime watermarks after the seeded cycle-3 review (which finished before `E2E.base`). */
const after = (mins: number) => new Date(new Date(E2E.base).getTime() + mins * MIN).toISOString();

interface Seeded {
  workflowId: string;
  prId: string;
}

async function seeded(): Promise<Seeded> {
  const pool = createPool({ connectionString: process.env['DATABASE_MIGRATOR_URL'], max: 1 });
  try {
    const r = await pool.query<{ id: string; workflow_id: string }>(
      `SELECT id, workflow_id FROM pull_requests WHERE external_id = $1`,
      [PR_EXT],
    );
    expect(r.rows[0], `pull request ${PR_EXT} is seeded`).toBeTruthy();
    return { prId: r.rows[0]!.id, workflowId: r.rows[0]!.workflow_id };
  } finally {
    await pool.end();
  }
}

interface AuditRow {
  actor_name: string;
  result: string;
  target_type: string;
  details: { findingExternalId?: string; reason?: string; cycleNumber?: number };
}

async function auditEvents(action: string, findingId: string): Promise<AuditRow[]> {
  const pool = createPool({ connectionString: process.env['DATABASE_MIGRATOR_URL'], max: 1 });
  try {
    const r = await pool.query<AuditRow>(
      `SELECT actor_name, result, target_type, details FROM audit_events WHERE action = $1 AND target_id = $2 ORDER BY occurred_at`,
      [action, findingId],
    );
    return r.rows;
  } finally {
    await pool.end();
  }
}

interface FindingView {
  id: string;
  externalId: string;
  position: number;
  lane: string;
  severity: string;
  blocking: string;
  state: string;
  title: string;
  description: string;
  impact: string;
  evidence: unknown[];
  recommendedFix: string;
  dismissedReason: string | null;
}
interface ReviewView {
  latestReview: { cycleNumber: number; status: string } | null;
  findings: FindingView[];
  cycles: { id: string; cycleNumber: number; iteration: number; state: string }[];
  readyForMerge: boolean;
  blockingOpenCount: number;
}

/** The Review Center read model through the signed-in page's cookies (the web rewrites `/api/*` to the API). */
async function view(page: Page, prId: string): Promise<ReviewView> {
  const res = await page.request.get(`/api/reviews/${prId}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as ReviewView;
}

async function findingByExt(page: Page, prId: string, externalId: string): Promise<FindingView> {
  const f = (await view(page, prId)).findings.find((x) => x.externalId === externalId);
  expect(f, `${externalId} is in the latest review`).toBeTruthy();
  return f!;
}

const problemHeaders = (h: Record<string, string>) =>
  expect(h['content-type']).toContain('application/problem+json');

const findingLi = (page: Page, position: number) => page.locator(`#finding-${position}`);
/** The `<dd>` that follows the `<dt>` `term` inside `scope`'s KeyValue list. */
const kv = (scope: Locator, term: string) =>
  scope
    .locator('dt', { hasText: new RegExp(`^${term}$`) })
    .locator('xpath=following-sibling::dd[1]');
const reviewStagePill = (page: Page) =>
  page.getByRole('list', { name: 'Stage pipeline' }).locator('#stage-6 .cd-pill[data-state]');
const readinessNotice = (page: Page) =>
  page.locator('.cd-notice').filter({ hasText: /merge approval/ });

async function ingestOk(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.put(`${API}${path}`, { headers: HEADERS, data });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { outcome: string };
  expect(body.outcome).toBe('accepted');
}

const lane = (l: string, status: 'PASS' | 'WARN' | 'FAIL', summary: string) => ({
  lane: l,
  status,
  summary,
});

/** The runtime's cycle-4 review: the security fix landed, the other findings are reported as before. */
function cycle4Review(findings: FindingView[], observedAt: string) {
  return {
    externalId: 'rev-1821-4',
    status: 'COMPLETE',
    lanes: [
      lane('correctness', 'WARN', 'One unchecked null path in RefundService'),
      lane('security', 'PASS', 'Ownership check added in cycle 4'),
      lane('dependencies', 'PASS', 'No new dependencies'),
      lane('edge_cases', 'PASS', 'Partial refund bound fixed in cycle 3'),
      lane('testing', 'PASS', 'Refund paths covered; one negative test dismissed as tracked'),
      lane('architecture', 'PASS', 'Follows the payments module boundaries'),
      lane('general', 'PASS', 'Minor naming inconsistencies only'),
    ],
    findings: findings.map((f) => ({
      externalId: f.externalId,
      position: f.position,
      lane: f.lane,
      severity: f.severity,
      blocking: f.blocking,
      title: f.title,
      description: f.description,
      impact: f.impact,
      evidence: f.evidence,
      recommendedFix: f.recommendedFix,
      status: f.externalId === 'find-1821-2' || f.state === 'FIXED' ? 'fixed' : 'open',
    })),
    startedAt: after(5),
    finishedAt: after(9),
    observedAt,
  };
}

test.describe('US6 Review Center and fix loop', () => {
  let ids: Seeded;
  test.beforeAll(async () => {
    ids = await seeded();
  });

  test('US6 AS-1 / FR-020: from Workflow Detail, Open review shows the PR, its links, review status, the seven lanes in order and the security finding with restricted evidence as text', async ({
    page,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/workflows/${ids.workflowId}`);
    const card = page.getByRole('region', { name: 'Pull request' });
    await expect(card).toContainText(`#1821 ${PR_TITLE}`);
    await expect(card).toContainText('AI review complete');
    await expect(card).toContainText(NOT_READY);
    const open = card.getByRole('link', { name: 'Open review' });
    await expect(open).toHaveAttribute('href', `/reviews/${ids.prId}`);
    await open.click();
    await page.waitForURL(`/reviews/${ids.prId}`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`PR #1821 — ${PR_TITLE}`);
    const meta = page.locator('.cd-page-meta').first();
    await expect(meta).toContainText('AI review complete');
    await expect(meta).toContainText(PR_EXT);
    await expect(meta).toContainText('open');
    const header = page.getByRole('region', { name: 'Pull request' });
    await expect(
      header.getByRole('link', { name: 'Open pull request #1821 on GitHub (opens in a new tab)' }),
    ).toHaveAttribute('href', 'https://github.com/acme/payments-api/pull/1821');
    await expect(
      header.getByRole('link', { name: 'Ledger export for month-end close' }),
    ).toHaveAttribute('href', /^\/requirements\/[0-9a-f-]{36}$/);
    await expect(
      header.getByRole('link', { name: 'Add rate limiting to /api/auth' }),
    ).toHaveAttribute('href', `/workflows/${ids.workflowId}`);
    await expect(header).toContainText('Review cycle #3');
    await expect(page.getByRole('link', { name: 'Back to workflow' })).toHaveAttribute(
      'href',
      `/workflows/${ids.workflowId}`,
    );

    // Seven lanes in the fixed order, each with its platform-evidence source line.
    const lanes = page.getByRole('group', { name: 'Review lanes' }).locator('.cd-check');
    await expect(lanes).toHaveCount(7);
    for (const [i, name] of LANES.entries()) await expect(lanes.nth(i)).toContainText(name);
    await expect(lanes.nth(1)).toContainText(
      'Fail · review agent · Authorization gap on the refund endpoint',
    );
    await expect(lanes.nth(0)).toContainText('Warn · review agent');

    // No saffron anywhere on the Review Center (merge approval lives in the Approval Center).
    await expect(page.locator('main .cd-saffron')).toHaveCount(0);

    await expect(page.getByRole('tab', { name: 'Findings (7)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: 'Cycles (3)' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Findings' }).locator(':scope > li')).toHaveCount(
      7,
    );

    // The security finding: severity and blocking class as words, impact, locator, recommended fix.
    const security = findingLi(page, 2);
    await expect(security.locator('article')).toHaveAttribute('data-severity', 'CRITICAL');
    await expect(security.locator('article')).toHaveAttribute('data-blocking', 'BLOCKING');
    const headPills = security.locator('.cd-finding-head .cd-pill');
    await expect(headPills.nth(0)).toHaveText('critical');
    await expect(headPills.nth(1)).toHaveText('blocking');
    await expect(headPills.nth(2)).toHaveText('Security');
    await expect(security.getByRole('heading', { level: 3 })).toHaveText(
      '2. Refund endpoint does not verify authorization against the original payment owner',
    );
    await expect(security).toContainText("A user may potentially refund another user's payment.");
    await expect(security).toContainText('Validate payment ownership before processing.');
    const evidence = security.locator('.cd-finding-evidence li');
    await expect(evidence).toHaveCount(2);
    await expect(evidence.nth(0)).toContainText('RefundController.java:84');
    await expect(evidence.nth(0).getByRole('link')).toHaveAttribute(
      'href',
      /RefundController\.java#L84$/,
    );
    // Restricted evidence (`accessible:false`, no href): text only, never a link.
    await expect(evidence.nth(1)).toContainText('Threat model — refunds');
    await expect(evidence.nth(1)).toContainText('access restricted');
    await expect(evidence.nth(1).locator('a')).toHaveCount(0);

    // Seeded human outcomes are words in pills, with the dismissal reason and who recorded it.
    await expect(findingLi(page, 4).locator('.cd-acts .cd-pill')).toHaveText('fixed');
    await expect(findingLi(page, 5).locator('.cd-acts .cd-pill')).toHaveText('dismissed');
    await expect(findingLi(page, 5)).toContainText('Reason:');
    // Open findings offer the three neutral actions.
    for (const name of ['Apply Fix', 'Dismiss', 'Create Issue'])
      await expect(security.getByRole('button', { name })).toBeEnabled();

    await expectAxeClean(page, 'review center (findings)');
    await page.getByRole('tab', { name: 'Cycles (3)' }).click();
    const cycles = page.getByRole('list', { name: 'Review cycles' }).getByRole('listitem');
    await expect(cycles).toHaveCount(3);
    await expect(cycles.nth(0)).toContainText('Review Cycle #3');
    await expect(cycles.nth(0)).toContainText('Iteration 3 of 5');
    await expectAxeClean(page, 'review center (cycles)');
  });

  test('US6 AS-4 / FR-022: the seeded open blocking finding makes the not-ready notice prominent above the tabs, on the Review Center and on Workflow Detail', async ({
    page,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/reviews/${ids.prId}`);
    const notice = readinessNotice(page);
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText(NOT_READY);
    await expect(notice.locator('.cd-pill')).toHaveText('not ready');
    await expect(notice).toHaveAttribute('role', 'alert');
    const noticeBox = (await notice.boundingBox())!;
    const tabsBox = (await page.getByRole('tablist').boundingBox())!;
    expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(tabsBox.y);
    const v = await view(page, ids.prId);
    expect(v.readyForMerge).toBe(false);
    expect(v.blockingOpenCount).toBe(1);

    await page.goto(`/workflows/${ids.workflowId}`);
    const card = page.getByRole('region', { name: 'Pull request' });
    await expect(card).toContainText(NOT_READY);
    await expect(card.locator('.cd-pill').filter({ hasText: 'not ready' })).toHaveCount(1);
  });

  test('FR-020 /reviews: the list is scoped by the project selector, shows #1821 with its status and the not-ready marker and links to the Review Center', async ({
    page,
  }) => {
    await signIn(page, 'admin@cdevi.demo');
    await page.goto('/reviews');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reviews');
    const project = page.getByLabel('Project');
    await project.selectOption({ label: 'Payments API' });
    const list = page.getByRole('list', { name: 'Pull requests under review' });
    const row = list.getByRole('listitem').filter({ hasText: `#1821 ${PR_TITLE}` });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('link', { name: `#1821 ${PR_TITLE}` })).toHaveAttribute(
      'href',
      `/reviews/${ids.prId}`,
    );
    await expect(row).toContainText('AI review complete');
    await expect(row.locator('.cd-pill').filter({ hasText: 'Not ready for merge' })).toHaveCount(1);
    await expect(row).toContainText(PR_EXT);
    await expect(row).toContainText('payments-api');
    await expect(row).toContainText('5 open findings');
    await expect(row).toContainText('1 blocking');
    await expect(row.getByRole('link', { name: 'Add rate limiting to /api/auth' })).toHaveAttribute(
      'href',
      `/workflows/${ids.workflowId}`,
    );
    await expectAxeClean(page, 'reviews list');

    // Another project shows nothing: the selector scopes the list.
    await project.selectOption({ label: 'Dashboard Demo' });
    await expect(page.getByRole('status')).toContainText(
      'No pull requests under review match these filters',
    );
    await expect(list).toHaveCount(0);
    await expect(page).toHaveURL(/project=/);

    await project.selectOption({ label: 'Payments API' });
    await row.getByRole('link', { name: `#1821 ${PR_TITLE}` }).click();
    await page.waitForURL(`/reviews/${ids.prId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`PR #1821 — ${PR_TITLE}`);
  });

  test('FR-032: a viewer reads the findings with every action disabled and explained; the API answers 403 problem+json', async ({
    page,
  }) => {
    await signIn(page, 'viewer1@cdevi.demo');
    await page.goto(`/reviews/${ids.prId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`PR #1821 — ${PR_TITLE}`);
    await expect(page.getByRole('list', { name: 'Findings' }).locator(':scope > li')).toHaveCount(
      7,
    );
    const explanation = page.locator('.cd-help').filter({ hasText: VIEWER_EXPLANATION });
    await expect(explanation).toBeVisible();
    const explanationId = await explanation.getAttribute('id');
    const security = findingLi(page, 2);
    for (const name of ['Apply Fix', 'Dismiss', 'Create Issue']) {
      const button = security.getByRole('button', { name });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('aria-describedby', explanationId!);
    }
    await expect(page.locator('main .cd-saffron')).toHaveCount(0);
    await expectAxeClean(page, 'review center as viewer');

    const finding = await findingByExt(page, ids.prId, 'find-1821-2');
    const base = `/api/reviews/${ids.prId}/findings/${finding.id}`;
    for (const [path, data] of [
      ['fix', {}],
      ['dismiss', { reason: 'viewer tries' }],
      ['issue', {}],
    ] as const) {
      const res = await page.request.post(`${base}/${path}`, { data });
      expect(res.status(), path).toBe(403);
      problemHeaders(res.headers());
      const body = (await res.json()) as { status: number; detail: string };
      expect(body.status).toBe(403);
      expect(body.detail).toContain('read-only');
    }
    expect((await findingByExt(page, ids.prId, 'find-1821-2')).state).toBe('OPEN');
  });

  test('FR-018: a review or cycle ingest payload carrying a reasoning field is rejected with 400 problem+json and never echoed', async ({
    request,
  }) => {
    const secret = 'CHAIN-OF-THOUGHT-MUST-NOT-LEAK';
    const finding = {
      externalId: 'find-x-1',
      position: 1,
      lane: 'general',
      severity: 'LOW',
      blocking: 'SUGGESTION',
      title: 'x',
      description: 'x',
      impact: 'x',
      evidence: [],
      recommendedFix: 'x',
    };
    const review = {
      externalId: 'rev-1821-3',
      status: 'COMPLETE',
      lanes: LANE_KEYS.map((l) => lane(l, 'PASS', 'x')),
      findings: [finding],
      startedAt: after(1),
      observedAt: after(2),
    };
    for (const key of ['reasoning', 'chainOfThought', 'thoughts']) {
      const nested = await request.put(`${API}/api/ingest/pull-requests/${PR_EXT}/reviews/3`, {
        headers: HEADERS,
        data: { ...review, findings: [{ ...finding, [key]: secret }] },
      });
      expect(nested.status(), `finding.${key}`).toBe(400);
      problemHeaders(nested.headers());
      expect(await nested.text()).not.toContain(secret);
      const top = await request.put(`${API}/api/ingest/pull-requests/${PR_EXT}/reviews/3`, {
        headers: HEADERS,
        data: { ...review, [key]: secret },
      });
      expect(top.status(), key).toBe(400);
      expect(await top.text()).not.toContain(secret);
    }
    const cycle = await request.put(`${API}/api/ingest/pull-requests/${PR_EXT}/cycles/3`, {
      headers: HEADERS,
      data: {
        findingsCount: 7,
        fixedCount: 6,
        remainingCount: 1,
        iteration: 3,
        state: 'COMPLETED',
        startedAt: after(1),
        observedAt: after(2),
        reasoning: secret,
      },
    });
    expect(cycle.status()).toBe(400);
    problemHeaders(cycle.headers());
    expect(await cycle.text()).not.toContain(secret);
  });

  test('US6 AS-2 / FR-021 Dismiss: a reason is required, the finding shows the Dismissed pill with the reason, and a repeat via the API is a 409 with the recorded outcome', async ({
    page,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/reviews/${ids.prId}`);
    const li = findingLi(page, 1);
    await li.getByRole('button', { name: 'Dismiss' }).click();
    const form = li.getByRole('form', {
      name: /^Dismiss finding: Null `originalPayment` not handled/,
    });
    await expect(form.getByLabel('Reason')).toBeFocused();
    await form.getByRole('button', { name: 'Confirm dismiss' }).click();
    await expect(form).toContainText('A reason is required.');
    await expect(form.getByLabel('Reason')).toBeFocused();
    expect((await findingByExt(page, ids.prId, 'find-1821-1')).state).toBe('OPEN');

    const reason = 'Repository lookup already returns 404 upstream';
    await form.getByLabel('Reason').fill(reason);
    await form.getByRole('button', { name: 'Confirm dismiss' }).click();
    await expect(li.locator('.cd-acts .cd-pill')).toHaveText('dismissed');
    await expect(li).toContainText(`Reason: ${reason} — Engineer 1`);
    await expect(li.getByRole('button')).toHaveCount(0);
    // Dismissing a non-blocking finding does not change merge readiness.
    await expect(readinessNotice(page)).toContainText(NOT_READY);

    const finding = await findingByExt(page, ids.prId, 'find-1821-1');
    expect(finding.state).toBe('DISMISSED');
    expect(finding.dismissedReason).toBe(reason);
    const repeat = await page.request.post(
      `/api/reviews/${ids.prId}/findings/${finding.id}/dismiss`,
      { data: { reason: 'second attempt' } },
    );
    expect(repeat.status()).toBe(409);
    problemHeaders(repeat.headers());
    const problem = (await repeat.json()) as {
      detail: string;
      state: string;
      dismissedReason: string;
    };
    expect(problem.detail).toBe('This finding is already dismissed.');
    expect(problem.state).toBe('DISMISSED');
    expect(problem.dismissedReason).toBe(reason);
    expect((await findingByExt(page, ids.prId, 'find-1821-1')).dismissedReason).toBe(reason);

    const audit = await auditEvents('finding.dismissed', finding.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_name: 'Engineer 1',
      result: 'DISMISSED',
      target_type: 'review_finding',
      details: { findingExternalId: 'find-1821-1', reason },
    });
  });

  test('US6 AS-3 / FR-021 Create Issue: the finding shows the neutral Issue requested pill and one audit event is recorded', async ({
    page,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/reviews/${ids.prId}`);
    const li = findingLi(page, 3);
    await li.getByRole('button', { name: 'Create Issue' }).click();
    const pill = li.locator('.cd-acts .cd-pill');
    await expect(pill).toHaveText('issue requested');
    // Neutral: not the saffron "needs you" treatment, not a link — Jira stays inbound-only.
    await expect(pill).not.toHaveClass(/cd-saffron|cd-needs-you/);
    await expect(li.locator('.cd-acts a')).toHaveCount(0);
    await expect(li.getByRole('button')).toHaveCount(0);
    await expect(page.locator('main .cd-saffron')).toHaveCount(0);

    const finding = await findingByExt(page, ids.prId, 'find-1821-3');
    expect(finding.state).toBe('ISSUE_REQUESTED');
    const audit = await auditEvents('finding.issue_requested', finding.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_name: 'Engineer 1',
      result: 'ISSUE_REQUESTED',
      target_type: 'review_finding',
      details: { findingExternalId: 'find-1821-3' },
    });
    const repeat = await page.request.post(
      `/api/reviews/${ids.prId}/findings/${finding.id}/issue`,
      { data: {} },
    );
    expect(repeat.status()).toBe(409);
    expect(((await repeat.json()) as { state: string }).state).toBe('ISSUE_REQUESTED');
  });

  test('US6 AS-2 / FR-021 Apply Fix + FR-022 FR-034: Apply Fix opens RUNNING cycle #4 (iteration 4) and sets the Review stage RUNNING; the runtime then reports the fix and the Review Center flips live to FIXED and ready', async ({
    page,
    request,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/reviews/${ids.prId}`);
    await expect(readinessNotice(page)).toContainText(NOT_READY);
    const before = await view(page, ids.prId);
    const openBefore = before.findings.filter(
      (f) => f.state === 'OPEN' || f.state === 'FIX_REQUESTED',
    ).length;

    const li = findingLi(page, 2);
    await li.getByRole('button', { name: 'Apply Fix' }).click();
    // Apply Fix lands on the Cycles tab, on the cycle it opened.
    await expect(page.getByRole('tab', { name: 'Cycles (4)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const cycles = page.getByRole('list', { name: 'Review cycles' }).getByRole('listitem');
    await expect(cycles).toHaveCount(4);
    const newest = cycles.nth(0);
    await expect(newest).toBeFocused();
    await expect(newest).toContainText('Review Cycle #4');
    await expect(newest.locator('.cd-pill').first()).toHaveText('running');
    await expect(newest).toContainText('Iteration 4 of 5');
    await expect(kv(newest, 'Findings')).toHaveText(String(openBefore));
    await expect(kv(newest, 'Fixed')).toHaveText('0');
    await expect(kv(newest, 'Remaining')).toHaveText(String(openBefore));
    await expect(kv(newest, 'Requested by')).toHaveText('Engineer 1');
    await expect(kv(newest, 'Finished')).toHaveText('in progress');

    await page.getByRole('tab', { name: 'Findings (7)' }).click();
    await expect(li.locator('.cd-acts .cd-pill')).toHaveText('fix requested');
    await expect(li).toContainText('Fix requested in Review Cycle #4');
    // A fix in flight still blocks the merge.
    await expect(readinessNotice(page)).toContainText(NOT_READY);

    const requested = await findingByExt(page, ids.prId, 'find-1821-2');
    expect(requested.state).toBe('FIX_REQUESTED');
    const afterFix = await view(page, ids.prId);
    const cycle4 = afterFix.cycles.find((c) => c.cycleNumber === 4)!;
    expect(cycle4).toMatchObject({ iteration: 4, state: 'RUNNING' });
    expect(afterFix.readyForMerge).toBe(false);
    const audit = await auditEvents('finding.fix_requested', requested.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.details).toMatchObject({ findingExternalId: 'find-1821-2', cycleNumber: 4 });
    const repeat = await page.request.post(
      `/api/reviews/${ids.prId}/findings/${requested.id}/fix`,
      { data: {} },
    );
    expect(repeat.status()).toBe(409);
    expect((await repeat.json()) as object).toMatchObject({
      state: 'FIX_REQUESTED',
      fixCycleId: cycle4.id,
    });

    // Workflow Detail: the Review stage (6) is RUNNING with the fix as its reason.
    const detail = await page.context().newPage();
    await detail.goto(`/workflows/${ids.workflowId}`);
    await expect(reviewStagePill(detail)).toHaveText('running');
    await expect(detail.getByRole('region', { name: 'Pull request' })).toContainText(NOT_READY);

    // The runtime reports the cycle and re-reviews: the control plane triggered, the runtime reports (FR-036).
    await page.evaluate(() => {
      (window as unknown as { __us6: string }).__us6 = 'no-reload';
    });
    await ingestOk(request, `/api/ingest/pull-requests/${PR_EXT}/cycles/4`, {
      findingsCount: openBefore,
      fixedCount: 1,
      remainingCount: openBefore - 1,
      iteration: 4,
      maxIterations: 5,
      state: 'COMPLETED',
      startedAt: after(5),
      finishedAt: after(8),
      observedAt: after(8),
    });
    await ingestOk(
      request,
      `/api/ingest/pull-requests/${PR_EXT}/reviews/4`,
      cycle4Review(afterFix.findings, after(9)),
    );

    // Live (SSE), no reload: the finding is FIXED, cycle #4 completed, readiness flips to ready.
    await expect(li.locator('.cd-acts .cd-pill')).toHaveText('fixed', { timeout: 15_000 });
    await expect(readinessNotice(page)).toContainText(READY);
    await expect(readinessNotice(page).locator('.cd-pill')).toHaveText('ready');
    await expect(readinessNotice(page)).toHaveAttribute('role', 'status');
    expect(
      await page.evaluate(() => (window as unknown as { __us6?: string }).__us6),
      'the page was not reloaded',
    ).toBe('no-reload');
    // Human outcomes survive the re-review; the seeded FIXED/DISMISSED ones too.
    await expect(findingLi(page, 1).locator('.cd-acts .cd-pill')).toHaveText('dismissed');
    await expect(findingLi(page, 3).locator('.cd-acts .cd-pill')).toHaveText('issue requested');
    await expect(findingLi(page, 4).locator('.cd-acts .cd-pill')).toHaveText('fixed');
    await expect(findingLi(page, 5).locator('.cd-acts .cd-pill')).toHaveText('dismissed');
    const lanes = page.getByRole('group', { name: 'Review lanes' }).locator('.cd-check');
    await expect(lanes.nth(1)).toContainText(
      'Pass · review agent · Ownership check added in cycle 4',
    );
    await expect(page.getByRole('region', { name: 'Pull request' })).toContainText(
      'Review cycle #4',
    );
    await expect(page.getByRole('tab', { name: 'Findings (7)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: 'Cycles (4)' }).click();
    await expect(cycles.nth(0)).toContainText('Review Cycle #4');
    await expect(cycles.nth(0).locator('.cd-pill').first()).toHaveText('completed');
    await expect(kv(cycles.nth(0), 'Fixed')).toHaveText('1');
    await expect(kv(cycles.nth(0), 'Remaining')).toHaveText(String(openBefore - 1));

    const done = await view(page, ids.prId);
    expect(done.readyForMerge).toBe(true);
    expect(done.blockingOpenCount).toBe(0);
    expect(done.latestReview).toMatchObject({ cycleNumber: 4, status: 'COMPLETE' });
    expect(done.findings.find((f) => f.externalId === 'find-1821-2')!.state).toBe('FIXED');

    // Workflow Detail follows live too: Review stage completed, merge readiness ready.
    await expect(reviewStagePill(detail)).toHaveText('completed', { timeout: 15_000 });
    const card = detail.getByRole('region', { name: 'Pull request' });
    await expect(card).toContainText('Ready for merge approval');
    await expect(card.locator('.cd-pill').filter({ hasText: /^ready$/ })).toHaveCount(1);
    await detail.close();

    // /reviews reflects the closed loop: no not-ready marker on #1821.
    await page.goto('/reviews');
    const row = page
      .getByRole('list', { name: 'Pull requests under review' })
      .getByRole('listitem')
      .filter({ hasText: `#1821 ${PR_TITLE}` });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.cd-pill').filter({ hasText: 'Not ready for merge' })).toHaveCount(0);
    await expectAxeClean(page, 'review center after the fix loop');
  });
});
