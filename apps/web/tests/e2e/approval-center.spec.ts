import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';
import { API, signIn, uniq } from './helpers';

const HEADERS = {
  authorization: `Bearer ${E2E.ingestToken}`,
  'content-type': 'application/json',
};

async function put(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.put(`${API}${path}`, { headers: HEADERS, data });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

/** Ingests a RUNNING workflow, attaches one approval or clarification and moves it to WAITING_FOR_HUMAN. */
async function ingestWaiting(
  request: APIRequestContext,
  kind: 'approval' | 'clarification',
  data: Record<string, unknown>,
) {
  const ext = uniq('us2');
  const now = new Date(Date.now() + 60_000).toISOString();
  const w = await put(request, `/api/ingest/workflows/${ext}`, {
    projectKey: 'payments-api',
    title: `US2 ${kind} ${ext}`,
    agent: 'Implementation Agent',
    state: 'RUNNING',
    stage: { index: 6, count: 7, name: 'Approve' },
    observedAt: now,
  });
  const item = await put(request, `/api/ingest/${kind}s/${ext}-${kind[0]}`, {
    workflowExternalId: ext,
    requestedAt: now,
    ...data,
  });
  const t = await request.post(`${API}/api/ingest/workflows/${ext}/transitions`, {
    headers: HEADERS,
    data: {
      toState: 'WAITING_FOR_HUMAN',
      observedAt: new Date(Date.now() + 120_000).toISOString(),
    },
  });
  expect(t.ok(), await t.text()).toBeTruthy();
  return { ext, workflowId: w.id, itemId: item.id };
}

async function workflowState(page: Page, workflowId: string) {
  const res = await page.request.get(`/api/workflows/${workflowId}`);
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { workflow: { state: string } }).workflow.state;
}

test.describe('Approval Center — Independent Test (specs/001 US2)', () => {
  test('resolves a requirement approval, a MEDIUM PR-merge approval and a clarification; every workflow leaves WAITING_FOR_HUMAN', async ({
    page,
    request,
  }) => {
    const requirement = await ingestWaiting(request, 'approval', {
      ask: 'Approve: requirement spec for rate limiting',
      riskLevel: 'HIGH',
      context: 'The requirement agent drafted the specification from the ticket.',
      links: { requirement: '/requirements/REQ-42' },
    });
    const merge = await ingestWaiting(request, 'approval', {
      ask: 'Approve: merge PR #482 into `main`',
      riskLevel: 'MEDIUM',
      links: { pullRequest: 'https://github.com/acme/payments-api/pull/482' },
    });
    const clarification = await ingestWaiting(request, 'clarification', {
      question: 'Should the limiter apply per IP or per account?',
      requestedByAgent: 'Analysis Agent',
      hasRecommendedAnswer: true,
      whyItMatters: 'Determines whether shared office IPs lock out whole teams.',
      options: [
        { value: 'ip', label: 'Per IP only' },
        { value: 'ip-account', label: 'Per IP and per authenticated account', recommended: true },
      ],
    });

    await signIn(page, 'approver1@cdevi.demo');
    await page.goto('/approvals');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Approval Center');
    await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'All projects' });

    // Scenario 1: highest risk first, then oldest; clarifications after risk-ranked approvals.
    const list = page.getByRole('list', { name: 'Needs a decision' });
    const titles = await list.getByRole('link').allTextContents();
    const idx = (ask: string) => titles.findIndex((t) => t.includes(ask));
    expect(idx('requirement spec for rate limiting')).toBeGreaterThanOrEqual(0);
    expect(idx('requirement spec for rate limiting')).toBeLessThan(idx('merge PR #482'));
    expect(idx('merge PR #482')).toBeLessThan(idx('Should the limiter apply'));
    expect(
      await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze(),
    ).toHaveProperty('violations', []);

    // Scenario 4: HIGH approval requires an explicit confirmation restating the action and risk.
    await list.getByRole('link', { name: /requirement spec for rate limiting/ }).click();
    await page.waitForURL(new RegExp(`/approvals/${requirement.itemId}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText('requirement spec');
    await page.getByRole('button', { name: 'Approve' }).click();
    const confirm = page.getByRole('button', { name: 'Confirm approval' });
    await expect(confirm).toBeFocused();
    const restated = page.getByRole('status').filter({ hasText: 'Confirm:' });
    await expect(restated).toContainText('requirement spec for rate limiting');
    await expect(restated).toContainText('high risk');
    expect(
      await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze(),
    ).toHaveProperty('violations', []);
    await confirm.click();
    await expect(page.getByRole('status').filter({ hasText: 'Approved by' })).toContainText(
      'Approver 1',
    );
    expect(await workflowState(page, requirement.workflowId)).toBe('RUNNING');

    // Scenario 5: reject the MEDIUM PR merge with a reason and a target state.
    await page.goto(`/approvals/${merge.itemId}`);
    await page.getByRole('button', { name: 'Reject…' }).click();
    await page
      .getByRole('textbox', { name: 'Reason' })
      .fill('CI on main is red; merge after the fix lands');
    const targets = page.getByRole('group', { name: 'Then move the workflow to' });
    await targets.getByText(/^BLOCKED/).click();
    await expect(targets.getByRole('radio', { name: /BLOCKED/ })).toBeChecked();
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Rejected by' })).toContainText(
      'Approver 1',
    );
    await expect(page.getByText('CI on main is red; merge after the fix lands')).toBeVisible();
    expect(await workflowState(page, merge.workflowId)).toBe('BLOCKED');

    // Scenarios 2–3: answer the clarification with the recommended option; answer shows in the audit.
    await page.goto(`/approvals/${clarification.itemId}`);
    await expect(page.getByRole('heading', { name: 'Why this matters' })).toBeVisible();
    const answers = page.getByRole('group', { name: 'Suggested answers' });
    await answers.getByText('Per IP and per authenticated account').click();
    await expect(
      answers.getByRole('radio', { name: /Per IP and per authenticated account/ }),
    ).toBeChecked();
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Answered by' })).toContainText(
      'Approver 1',
    );
    await expect(page.getByRole('table', { name: 'Audit' })).toContainText(
      'clarification.answered',
    );
    expect(await workflowState(page, clarification.workflowId)).toBe('RUNNING');

    // Scenario 6: the resolved items are gone from the Approval Center.
    await page.goto('/approvals');
    await expect(list.getByRole('link', { name: /merge PR #482/ })).toHaveCount(0);
    await expect(list.getByRole('link', { name: /Should the limiter apply/ })).toHaveCount(0);
    await expect(
      list.getByRole('link', { name: /requirement spec for rate limiting/ }),
    ).toHaveCount(0);
  });

  test('FR-032 an engineer sees the decision but cannot act on it', async ({ page, request }) => {
    const { itemId } = await ingestWaiting(request, 'approval', {
      ask: 'Approve: rotate signing keys',
      riskLevel: 'CRITICAL',
    });
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/approvals/${itemId}`);
    await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Reject…' })).toBeDisabled();
    await expect(page.getByText('Only approvers and administrators can decide.')).toBeVisible();
  });
});
