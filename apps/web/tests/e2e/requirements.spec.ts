import { createHmac } from 'node:crypto';
import { createPool, hashPassword } from '@cdevi/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';
import { API, expectAxeClean, ingestAnalysis, me, signIn, uniq } from './helpers';

// Requirements Independent Test (specs/001 US4, quickstart §5.5): engineer1 creates and submits a requirement, the
// agent runtime is simulated through PUT /api/ingest/requirements/{externalId}/analysis, approver1 approves it and
// the workflow appears on Workflow Detail, in GET /api/workflows?requirement= and on the Dashboard active cards.
// The spec creates its own requirement and never mutates the seeded req-seed-00n rows.

const HEADERS = {
  authorization: `Bearer ${E2E.ingestToken}`,
  'content-type': 'application/json',
};
const SEED = {
  draft: 'req-seed-001',
  needsClarification: 'req-seed-003',
  ready: 'req-seed-004',
  inImplementation: 'req-seed-006',
} as const;
const JIRA_SEED_KEY = 'PAY-231';
const STAGES = [
  'Requirement',
  'Analysis',
  'Architecture',
  'Implementation',
  'Testing',
  'Review',
  'PR',
] as const;

interface Detail {
  requirement: {
    id: string;
    externalId: string;
    state: string;
    href: string;
    externalFlag: string | null;
    workflow: { id: string; externalId: string; state: string; href: string } | null;
  };
  actions: { canSubmit: boolean; canApprove: boolean; canReject: boolean };
}

const statePill = (page: Page) => page.locator('.cd-pill[data-state]').first();

async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __cdeviMark: number }).__cdeviMark = 1;
  });
}
async function expectNotReloaded(page: Page) {
  expect(
    await page.evaluate(() => (window as unknown as { __cdeviMark?: number }).__cdeviMark),
  ).toBe(1);
}

async function detail(page: Page, id: string): Promise<Detail> {
  const res = await page.request.get(`/api/requirements/${id}`);
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as Detail;
}

async function detailByExternalId(page: Page, externalId: string): Promise<Detail> {
  const res = await page.request.get(`/api/requirements?project=all`);
  expect(res.ok()).toBeTruthy();
  const list = (await res.json()) as { items: { id: string; externalId: string }[] };
  const row = list.items.find((r) => r.externalId === externalId);
  expect(row, `${externalId} is on the first page`).toBeTruthy();
  return detail(page, row!.id);
}

async function post(page: Page, path: string, data?: unknown) {
  const res = await page.request.post(path, {
    headers: { 'content-type': 'application/json' },
    data: data ?? {},
  });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as Detail;
}

async function seedProjectId(page: Page, key = 'payments-api') {
  const { projects } = await me(page);
  const p = projects.find((x) => x.key === key);
  expect(p, `${key} is visible`).toBeTruthy();
  return p!.id;
}

/** Signs a Jira webhook body exactly as the route verifies it (HMAC-SHA256 over the raw body, `x-hub-signature`). */
async function jiraWebhook(
  request: APIRequestContext,
  event: unknown,
  secret: string = E2E.jiraWebhookSecret,
) {
  const raw = JSON.stringify(event);
  const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return request.post(`${API}/api/integrations/jira/webhook`, {
    headers: { 'content-type': 'application/json', 'x-hub-signature': signature },
    data: raw,
  });
}

function jiraIssue(
  key: string,
  event: string,
  summary: string,
  extra: Record<string, unknown> = {},
) {
  return {
    webhookEvent: event,
    timestamp: Date.now(),
    issue: {
      id: '10001',
      key,
      fields: {
        summary,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `Business objective imported from Jira ${key}.` }],
            },
          ],
        },
        updated: new Date(Date.now() - 60_000).toISOString(),
        project: { key: 'PAY', name: 'Payments' },
        status: { name: 'To Do', statusCategory: { key: 'new' } },
        assignee: { emailAddress: 'engineer1@cdevi.demo' },
        ...extra,
      },
    },
  };
}

async function transition(request: APIRequestContext, externalId: string, toState: string) {
  const res = await request.post(`${API}/api/ingest/workflows/${externalId}/transitions`, {
    headers: HEADERS,
    data: { toState, observedAt: new Date(Date.now() + 120_000).toISOString() },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Creates a requirement through the UI as engineer1 and returns its detail. */
async function createViaUi(page: Page, title: string, criterion: string) {
  await page.goto('/requirements/new');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('New requirement');
  await page.locator('#req-project').selectOption({ label: 'Payments API' });
  await page.locator('#req-title').fill(title);
  await page
    .locator('#req-objective')
    .fill('Reduce failed renewals by retrying soft-declined cards on a nightly schedule.');
  await page.locator('#req-criteria').fill(criterion);
  await page.getByRole('button', { name: 'Create requirement' }).click();
  await page.waitForURL(/\/requirements\/[0-9a-f-]{36}$/);
  const id = page.url().split('/').pop()!;
  return detail(page, id);
}

test.describe('Requirements — Independent Test (specs/001 US4)', () => {
  // One journey: every step depends on the previous one (serial mode skips the rest when a step fails).
  test.describe.configure({ mode: 'serial' });
  let created: Detail;
  let title: string;

  test('FR-007 engineer1 creates a requirement from /requirements/new and lands on the detail in draft with the authored criterion and "Submit for analysis"', async ({
    page,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    title = uniq('e2e-req');
    created = await createViaUi(page, title, 'Soft declines are retried at most three times.');
    expect(created.requirement.state).toBe('DRAFT');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(statePill(page)).toHaveText('draft');
    await expect(statePill(page)).toHaveAttribute('data-state', 'DRAFT');
    await expect(page.getByText('Soft declines are retried at most three times.')).toBeVisible();
    await expect(page.getByText('Authored by Engineer 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit for analysis' })).toBeEnabled();
    await expect(page.getByText('Not started')).toBeVisible();
  });

  test('FR-009 submit shows analyzing; an ingested analysis with one open question shows needs clarification, the AI-generated labels and a saffron "Resubmit for analysis" within 5 s without reload (SC-003)', async ({
    page,
    request,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(created.requirement.href);
    await page.getByRole('button', { name: 'Submit for analysis' }).click();
    await expect(statePill(page)).toHaveText('analyzing');
    await expect(statePill(page)).toHaveAttribute('data-state', 'ANALYZING');
    await expect(page.getByRole('button', { name: /Submit for analysis/ })).toHaveCount(0);
    expect((await detail(page, created.requirement.id)).requirement.state).toBe('ANALYZING');

    await markDocument(page);
    const sent = Date.now();
    const r = await ingestAnalysis(request, created.requirement.externalId, {
      summary: 'Nightly retries of soft declines with a bounded retry budget.',
      acceptanceCriteria: [
        'Retries stop after three attempts.',
        'Hard declines are never retried.',
      ],
      rules: ['Retries respect the issuer retry window.'],
      openQuestions: ['Should the customer be notified before each retry?'],
    });
    expect(r).toMatchObject({ outcome: 'accepted', state: 'NEEDS_CLARIFICATION' });
    await expect(statePill(page)).toHaveText('needs clarification', { timeout: 5_000 });
    const elapsed = Date.now() - sent;
    await expectNotReloaded(page);
    console.log(`SC-003 requirement detail refreshed ${elapsed} ms after the analysis ingest`);
    expect(elapsed).toBeLessThanOrEqual(5_000);

    await expect(page.getByText('Retries stop after three attempts.')).toBeVisible();
    await expect(page.getByText('Retries respect the issuer retry window.')).toBeVisible();
    await expect(
      page.getByText('Should the customer be notified before each retry?'),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open questions (1)' })).toBeVisible();
    // Summary + 2 criteria + 1 rule + 1 question are AI-generated; the authored criterion is not.
    await expect(page.getByText('AI-generated', { exact: true })).toHaveCount(5);
    await expect(page.getByText('Authored by Engineer 1')).toBeVisible();
    const resubmit = page.getByRole('button', { name: 'Resubmit for analysis' });
    await expect(resubmit).toBeEnabled();
    await expect(resubmit).toHaveClass(/cd-saffron/);
    expect(await page.locator('.cd-saffron').count()).toBe(1);
  });

  test('FR-009 resubmit then an analysis without open questions shows ready and no enabled action for engineer1', async ({
    page,
    request,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(created.requirement.href);
    await page.getByRole('button', { name: 'Resubmit for analysis' }).click();
    await expect(statePill(page)).toHaveText('analyzing');
    const r = await ingestAnalysis(request, created.requirement.externalId, {
      observedAt: new Date(Date.now() + 180_000).toISOString(),
      acceptanceCriteria: [
        'Retries stop after three attempts.',
        'Hard declines are never retried.',
      ],
      rules: ['Retries respect the issuer retry window.', 'Customers are notified before a retry.'],
      openQuestions: [],
    });
    expect(r).toMatchObject({ outcome: 'accepted', state: 'READY' });
    await expect(statePill(page)).toHaveText('ready', { timeout: 5_000 });
    await expect(page.getByRole('heading', { name: 'Open questions (0)' })).toBeVisible();
    for (const b of await page.getByRole('main').getByRole('button').all()) {
      const disabled = (await b.isDisabled()) || (await b.getAttribute('aria-disabled')) === 'true';
      expect(disabled, `"${await b.textContent()}" is not an enabled action`).toBeTruthy();
    }
    expect(await page.locator('.cd-saffron').count()).toBe(0);
  });

  test('FR-010 approver1 approves: state approved, Decision links wf-… stage 1 of 7 queued; /workflows/{id} shows seven stages with stage 1 Requirement queued (SC-008)', async ({
    page,
  }) => {
    await signIn(page, 'approver1@cdevi.demo');
    await page.goto(created.requirement.href);
    await expect(statePill(page)).toHaveText('ready');
    const approve = page.getByRole('button', { name: 'Approve' });
    await expect(approve).toBeEnabled();
    await expect(approve).toHaveClass(/cd-saffron/);
    expect(await page.locator('.cd-saffron').count()).toBe(1);
    const started = Date.now();
    await approve.click();
    await expect(statePill(page)).toHaveText('approved');
    const wfExt = `wf-${created.requirement.externalId}`;
    const wfLink = page.getByRole('link', { name: `${wfExt} · stage 1 of 7` });
    await expect(wfLink).toBeVisible();
    const decision = page.getByRole('region', { name: 'Decision' });
    await expect(decision.locator('.cd-pill[data-state="QUEUED"]')).toHaveText('queued');
    await expect(decision).toContainText('Approver 1');
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reject…' })).toHaveCount(0);

    await wfLink.click();
    await page.waitForURL(/\/workflows\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    const pipeline = page.getByRole('list', { name: 'Stage pipeline' });
    await expect(pipeline.getByRole('listitem')).toHaveCount(7);
    for (const [i, name] of STAGES.entries()) {
      await expect(pipeline.getByRole('listitem').nth(i)).toContainText(`${i + 1}. ${name}`);
    }
    await expect(pipeline.locator('[aria-current="step"]')).toContainText('1. Requirement');
    await expect(pipeline.locator('[aria-current="step"] .cd-pill')).toHaveText('queued');
    const journey = Date.now() - started;
    console.log(`SC-008 approve → workflow detail in ${journey} ms`);
    const after = await detail(page, created.requirement.id);
    expect(after.requirement.workflow).toMatchObject({ externalId: wfExt, state: 'QUEUED' });
    created = after;
  });

  test('FR-010 the new workflow appears on the Dashboard active cards for Payments API and in GET /api/workflows?requirement={id} with total 1', async ({
    page,
  }) => {
    await signIn(page, 'approver1@cdevi.demo');
    const res = await page.request.get(`/api/workflows?requirement=${created.requirement.id}`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const list = (await res.json()) as {
      total: number;
      items: {
        id: string;
        externalId: string;
        state: string;
        stage: { index: number | null; count: number };
        requirement: { id: string; href: string } | null;
        href: string;
      }[];
      filters: { requirement: string | null };
    };
    expect(list.total).toBe(1);
    expect(list.items).toHaveLength(1);
    expect(list.filters.requirement).toBe(created.requirement.id);
    expect(list.items[0]).toMatchObject({
      id: created.requirement.workflow!.id,
      externalId: `wf-${created.requirement.externalId}`,
      state: 'QUEUED',
      stage: { index: 1, count: 7 },
      requirement: { id: created.requirement.id, href: created.requirement.href },
      href: created.requirement.workflow!.href,
    });

    await page.goto('/dashboard');
    await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Payments API' });
    const cards = page.getByRole('list', { name: 'Active workflows' });
    const card = cards
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: title }) });
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(`wf-${created.requirement.externalId}`);
    await expect(card).toContainText('Stage 1 of 7');
    await expect(card.locator('.cd-pill[data-state="QUEUED"]')).toHaveText('queued');
    await expect(card.getByRole('link', { name: title })).toHaveAttribute(
      'href',
      created.requirement.workflow!.href,
    );
  });

  test('FR-010 an ingested RUNNING transition on wf-… moves the requirement to in implementation within 5 s', async ({
    page,
    request,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(created.requirement.href);
    await expect(statePill(page)).toHaveText('approved');
    await markDocument(page);
    const sent = Date.now();
    await transition(request, `wf-${created.requirement.externalId}`, 'RUNNING');
    await expect(statePill(page)).toHaveText('in implementation', { timeout: 5_000 });
    const elapsed = Date.now() - sent;
    await expectNotReloaded(page);
    const decision = page.getByRole('region', { name: 'Decision' });
    await expect(decision.locator('.cd-pill[data-state="RUNNING"]')).toHaveText('running');
    console.log(`FR-010 requirement followed its workflow ${elapsed} ms after the transition`);
    expect(elapsed).toBeLessThanOrEqual(5_000);
    await page.goto('/requirements');
    const row = page
      .getByRole('list', { name: 'Requirements' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: title, exact: true }) });
    await expect(row.locator('.cd-pill[data-state="IN_IMPLEMENTATION"]')).toHaveText(
      'in implementation',
    );
    await expect(
      row.getByRole('link', {
        name: `Workflow wf-${created.requirement.externalId}, stage 1 of 7`,
      }),
    ).toBeVisible();
  });
});

test.describe('Requirements list (specs/001 US4 scenario 5)', () => {
  test('FR-009 the list filters by state (needs clarification → req-seed-003 …), project and assignee (Me as approver1 → req-seed-003) and shows the linked StatePill for req-seed-006', async ({
    page,
  }) => {
    await signIn(page, 'approver1@cdevi.demo');
    await page.goto('/requirements');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Requirements');
    const list = page.getByRole('list', { name: 'Requirements' });
    const rowOf = (externalId: string) =>
      list.getByRole('listitem').filter({ hasText: externalId });
    for (const ext of Object.values(SEED)) await expect(rowOf(ext)).toHaveCount(1);
    await expect(rowOf(SEED.needsClarification).locator('.cd-pill[data-state]').first()).toHaveText(
      'needs clarification',
    );

    // Linked workflow state as its own pill link (StatePill inside the row).
    const linked = rowOf(SEED.inImplementation).getByRole('link', { name: /^Workflow s500-/ });
    await expect(linked).toBeVisible();
    await expect(linked.locator('.cd-pill')).toHaveText('needs you');
    await expect(linked.locator('.cd-pill')).toHaveAttribute('data-state', 'WAITING_FOR_HUMAN');
    await expect(linked).toHaveAttribute('href', /^\/workflows\/[0-9a-f-]{36}$/);

    // State filter.
    await page.getByLabel('State').selectOption('NEEDS_CLARIFICATION');
    await expect(page).toHaveURL(/state=NEEDS_CLARIFICATION/);
    await expect(rowOf(SEED.needsClarification)).toHaveCount(1);
    await expect(rowOf(SEED.draft)).toHaveCount(0);
    await expect(rowOf(SEED.ready)).toHaveCount(0);
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText(/1 of 1 requirements · filtered/)).toBeVisible();
    await page.getByLabel('State').selectOption('');

    // Assignee filter: "Me" as approver1 → req-seed-003; Engineer 1 → req-seed-004.
    await page.getByLabel('Assignee').selectOption('me');
    await expect(page).toHaveURL(/assignee=me/);
    await expect(rowOf(SEED.needsClarification)).toHaveCount(1);
    await expect(rowOf(SEED.ready)).toHaveCount(0);
    await page.getByLabel('Assignee').selectOption({ label: 'Engineer 1' });
    await expect(rowOf(SEED.ready)).toHaveCount(1);
    await expect(rowOf(SEED.needsClarification)).toHaveCount(0);
    await page.getByLabel('Assignee').selectOption('');

    // Project filter: Web App has no requirements; Payments API has the seed.
    await page.getByLabel('Project').selectOption({ label: 'Web App' });
    await expect(page.getByText('No requirements yet.')).toBeVisible();
    await page.getByLabel('Project').selectOption({ label: 'Payments API' });
    await expect(rowOf(SEED.draft)).toHaveCount(1);
    await expect(page.getByText(/filtered/)).toBeVisible();
    // The project selection is remembered in the shared cookie.
    await page.reload();
    await expect(page.getByLabel('Project')).toHaveValue(await seedProjectId(page));
    await page.getByLabel('Project').selectOption('all');
  });
});

test.describe('Jira link and flag (specs/001 US4 scenario 2, FR-008)', () => {
  test('FR-008 req-seed-003 shows the PAY-231 Jira link opening a new tab; a signed issue_created webhook for PAY-9nnn creates a draft visible in the list; issue_deleted after approval flags it and the workflow shows blocked on /workflows/{id} and in the Dashboard blocked count within 5 s', async ({
    page,
    request,
  }) => {
    await signIn(page, 'approver1@cdevi.demo');
    const seeded = await detailByExternalId(page, SEED.needsClarification);
    await page.goto(seeded.requirement.href);
    const jira = page.getByRole('link', {
      name: `Open ${JIRA_SEED_KEY} in Jira (opens in a new tab)`,
    });
    await expect(jira).toHaveText(JIRA_SEED_KEY);
    await expect(jira).toHaveAttribute('target', '_blank');
    await expect(jira).toHaveAttribute('rel', /noopener/);
    await expect(jira).toHaveAttribute('href', /^https:\/\/jira\.example\.invalid\//);
    await expect(page.getByText('by Jira')).toBeVisible();

    // An unsigned or wrongly signed body never reaches the requirement.
    const key = `PAY-${9000 + (Date.now() % 1000)}`;
    const bad = await jiraWebhook(request, jiraIssue(key, 'jira:issue_created', 'x'), 'wrong');
    expect(bad.status()).toBe(401);
    const created = await jiraWebhook(
      request,
      jiraIssue(key, 'jira:issue_created', `Jira import ${key}`),
    );
    expect(created.status(), await created.text()).toBe(202);
    const result = (await created.json()) as { outcome: string; requirementId: string };
    expect(result.outcome).toBe('created');

    await page.goto('/requirements');
    const row = page
      .getByRole('list', { name: 'Requirements' })
      .getByRole('listitem')
      .filter({ hasText: `req-${key.toLowerCase()}` });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.cd-pill[data-state="DRAFT"]')).toHaveText('draft');
    await expect(
      row.getByRole('link', { name: `Open ${key} in Jira (opens in a new tab)` }),
    ).toBeVisible();
    await expect(row).toContainText('Engineer 1');

    // Submit → analysis → approve through the API (the UI path is covered by the Independent Test above).
    const d = await detail(page, result.requirementId);
    expect(d.requirement.state).toBe('DRAFT');
    // approver1 may submit too (canCreateRequirement covers Approver/Administrator).
    await post(page, `/api/requirements/${d.requirement.id}/submit`);
    await ingestAnalysis(request, d.requirement.externalId, {
      acceptanceCriteria: ['Imported criterion.'],
    });
    const approved = await post(page, `/api/requirements/${d.requirement.id}/approve`);
    expect(approved.requirement.state).toBe('APPROVED');
    expect(approved.requirement.workflow?.state).toBe('QUEUED');
    const workflowHref = approved.requirement.workflow!.href;

    // The Dashboard blocked count follows the flag within 5 s (SC-003) without a reload.
    await page.goto('/dashboard');
    await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Payments API' });
    // The Payments API figures are in place once the freshly created (QUEUED) workflow card is on screen.
    const jiraCard = page
      .getByRole('list', { name: 'Active workflows' })
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: `Jira import ${key}` }) });
    await expect(jiraCard.locator('.cd-pill[data-state="QUEUED"]')).toHaveText('queued');
    const needsMe = page.getByRole('region', { name: 'What needs me' });
    const dash = await page.request.get(`/api/dashboard?project=${await seedProjectId(page)}`);
    expect(dash.ok()).toBeTruthy();
    const n = ((await dash.json()) as { needsMe: { blocked: { value: number } } }).needsMe.blocked
      .value;
    await expect(needsMe.getByRole('link', { name: `${n} blocked workflows` })).toBeVisible();
    await markDocument(page);
    const sent = Date.now();
    const deleted = await jiraWebhook(
      request,
      jiraIssue(key, 'jira:issue_deleted', `Jira import ${key}`),
    );
    expect(deleted.status(), await deleted.text()).toBe(202);
    expect(await deleted.json()).toEqual({ outcome: 'flagged', requirementId: d.requirement.id });
    await expect(needsMe.getByRole('link', { name: `${n + 1} blocked workflows` })).toBeVisible({
      timeout: 5_000,
    });
    const elapsed = Date.now() - sent;
    await expectNotReloaded(page);
    console.log(`FR-008 blocked count refreshed ${elapsed} ms after the Jira flag`);
    expect(elapsed).toBeLessThanOrEqual(5_000);

    await page.goto(d.requirement.href);
    await expect(statePill(page)).toHaveText('approved'); // the flag never changes the requirement state
    const alert = page.getByRole('alert').filter({ hasText: 'Jira' });
    await expect(alert).toContainText(`The linked Jira issue ${key} was deleted`);
    await expect(alert).toContainText('paused in BLOCKED');
    await expect(
      page.getByRole('region', { name: 'Decision' }).locator('.cd-pill[data-state="BLOCKED"]'),
    ).toHaveText('blocked');

    await page.goto(workflowHref);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Jira import ${key}`);
    await expect(page.locator('.cd-pill[data-state="BLOCKED"]').first()).toHaveText('blocked');
    await expect(
      page.getByRole('list', { name: 'Stage pipeline' }).locator('[aria-current="step"] .cd-pill'),
    ).toHaveText('blocked');
  });
});

test.describe('Roles (FR-032)', () => {
  test('FR-032 viewer1 sees no actions on any requirement and an aria-disabled "New requirement"', async ({
    page,
  }) => {
    await signIn(page, 'viewer1@cdevi.demo');
    await page.goto('/requirements');
    const newReq = page.getByText('New requirement', { exact: true });
    await expect(newReq).toHaveAttribute('aria-disabled', 'true');
    await expect(newReq).not.toHaveAttribute('href');
    await expect(newReq).toHaveAccessibleDescription(/cannot create requirements/);
    expect(await page.locator('.cd-saffron').count()).toBe(0);

    for (const ext of [SEED.draft, SEED.needsClarification, SEED.ready]) {
      const d = await detailByExternalId(page, ext);
      expect(d.actions).toEqual(
        expect.objectContaining({ canSubmit: false, canApprove: false, canReject: false }),
      );
      await page.goto(d.requirement.href);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const b of await page.getByRole('main').getByRole('button').all()) {
        const disabled =
          (await b.isDisabled()) || (await b.getAttribute('aria-disabled')) === 'true';
        expect(
          disabled,
          `"${await b.textContent()}" is not an enabled action for a viewer`,
        ).toBeTruthy();
      }
      await expect(page.getByText(/Your role \(viewer\) is read-only/i)).toBeVisible();
      expect(await page.locator('.cd-saffron').count()).toBe(0);
      const submit = await page.request.post(`/api/requirements/${d.requirement.id}/submit`);
      expect(submit.status()).toBe(403);
      const approve = await page.request.post(`/api/requirements/${d.requirement.id}/approve`);
      expect(approve.status()).toBe(403);
    }
    await page.goto('/requirements/new');
    await expect(page.getByRole('status')).toContainText(
      /Your role \(viewer\) cannot create requirements/i,
    );
    await expect(page.getByRole('button', { name: 'Create requirement' })).toHaveCount(0);
    const create = await page.request.post('/api/requirements', {
      headers: { 'content-type': 'application/json' },
      data: {
        projectId: await seedProjectId(page),
        title: 'Viewer attempt',
        businessObjective: 'Viewers must never be able to create requirements.',
      },
    });
    expect(create.status()).toBe(403);
  });
});

test.describe('Accessibility (SC-010, ui-requirements.md §6)', () => {
  test('SC-010 page-level axe passes on list, detail and create; Tab order follows ui-requirements.md §6 and Enter on a row opens its detail', async ({
    page,
  }) => {
    await signIn(page, 'approver1@cdevi.demo');
    await page.goto('/requirements');
    await expect(page.getByRole('list', { name: 'Requirements' })).toBeVisible();
    await expectAxeClean(page, '/requirements');

    // §6 list order: New requirement → Project → State → Assignee → first row title.
    await page.getByRole('link', { name: 'New requirement' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Project')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('State')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Assignee')).toBeFocused();
    const firstTitle = page
      .getByRole('list', { name: 'Requirements' })
      .getByRole('listitem')
      .first()
      .locator('a.cd-title');
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      if (await firstTitle.evaluate((el) => el === document.activeElement)) break;
    }
    await expect(firstTitle).toBeFocused();
    const href = await firstTitle.getAttribute('href');
    await page.keyboard.press('Enter');
    await page.waitForURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Detail (READY, approver1: Approve → Reject…) and its Tab order: crumbs → actions.
    const ready = await detailByExternalId(page, SEED.ready);
    await page.goto(ready.requirement.href);
    await expect(statePill(page)).toHaveText('ready');
    await expectAxeClean(page, '/requirements/{id}');
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Requirements' })
      .focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Approve' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Reject…' })).toBeFocused();

    // Jira-linked detail: flag-free, the Jira link is a tab stop after the actions.
    const jira = await detailByExternalId(page, SEED.needsClarification);
    await page.goto(jira.requirement.href);
    await expectAxeClean(page, '/requirements/{id} (Jira)');

    // Create form: Project → Title → Objective → Criteria → Create → Cancel.
    await page.goto('/requirements/new');
    await expect(page.getByRole('button', { name: 'Create requirement' })).toBeVisible();
    await expectAxeClean(page, '/requirements/new');
    await page.locator('#req-project').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#req-title')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#req-objective')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#req-criteria')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Create requirement' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Cancel' })).toBeFocused();
    // An invalid submit focuses the first errored control.
    await page.getByRole('button', { name: 'Create requirement' }).click();
    await expect(page.locator('#req-title')).toBeFocused();
    await expect(page.locator('#req-title')).toHaveAttribute('aria-invalid', 'true');
    await expectAxeClean(page, '/requirements/new (invalid)');
  });
});

test.describe('Performance (SC-007)', () => {
  /** A separate organization with 2 000 requirements / 20 000 analysis items (same shape as apps/api seedSc007Org). */
  async function seedSc007Requirements(base: string) {
    const email = `${uniq('sc7-req-admin')}@cdevi.test`;
    const password = 'sc7-fixture-password';
    const pool = createPool({
      connectionString: process.env['DATABASE_MIGRATOR_URL'],
      statementTimeoutMs: 120_000,
      max: 1,
    });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const organizationId = (
        await client.query<{ id: string }>(
          `INSERT INTO organizations (name) VALUES ($1) RETURNING id`,
          [uniq('SC-007 requirements e2e')],
        )
      ).rows[0]!.id;
      const projectIds = (
        await client.query<{ id: string }>(
          `INSERT INTO projects (organization_id, key, name)
           SELECT $1, 'sc7r-' || g, 'SC7 requirements ' || g FROM generate_series(1, 4) g RETURNING id`,
          [organizationId],
        )
      ).rows.map((r) => r.id);
      await client.query(
        `INSERT INTO users (organization_id, email, display_name, password_hash, role) VALUES ($1, $2, 'SC7 Admin', $3, 'administrator')`,
        [organizationId, email, await hashPassword(password)],
      );
      await client.query(
        `INSERT INTO requirements (organization_id, project_id, external_id, title, business_objective, state, created_at)
         SELECT $1, ($2::uuid[])[(g % 4) + 1], 'sc7r-req-' || g, 'Requirement ' || g, 'Business objective of requirement ' || g,
                (ARRAY['DRAFT','ANALYZING','NEEDS_CLARIFICATION','READY','APPROVED','IN_IMPLEMENTATION','COMPLETED','REJECTED']::requirement_state[])[(g % 8) + 1],
                $3::timestamptz - (g % 60) * interval '1 day' - (g % 1440) * interval '1 minute'
           FROM generate_series(1, 2000) g`,
        [organizationId, projectIds, base],
      );
      await client.query(
        `INSERT INTO requirement_analysis_items (organization_id, project_id, requirement_id, kind, position, text, ai_generated, source)
         SELECT r.organization_id, r.project_id, r.id,
                (ARRAY['acceptance_criterion','acceptance_criterion','acceptance_criterion','acceptance_criterion','rule','rule','rule','rule','open_question','open_question']::analysis_item_kind[])[i],
                (ARRAY[1,2,3,4,1,2,3,4,1,2])[i], 'Item ' || i || ' of ' || r.external_id, true, 'agent:Requirement Agent'
           FROM requirements r CROSS JOIN generate_series(1, 10) i WHERE r.organization_id = $1`,
        [organizationId],
      );
      await client.query(
        `INSERT INTO requirement_transitions (organization_id, requirement_id, from_state, to_state, actor_type, actor_name, occurred_at)
         SELECT organization_id, id, NULL, 'DRAFT', 'user', 'SC7 Admin', created_at FROM requirements WHERE organization_id = $1`,
        [organizationId],
      );
      await client.query('COMMIT');
      await client.query(
        'ANALYZE requirements, requirement_analysis_items, requirement_transitions',
      );
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
      await pool.end();
    }
    return { email, password };
  }

  test('SC-007 initial list content within 2 s p95 over 10 runs at the seeded database plus the SC-007 fixture', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const org = await seedSc007Requirements(E2E.base);
    await signIn(page, org.email, org.password);
    const timings: number[] = [];
    for (let i = 0; i < 10; i++) {
      await page.goto('about:blank');
      const t0 = Date.now();
      await page.goto('/requirements', { waitUntil: 'commit' });
      await expect(
        page.getByRole('list', { name: 'Requirements' }).getByRole('listitem'),
      ).toHaveCount(50);
      timings.push(Date.now() - t0);
    }
    await expect(page.getByText(/50 of 2000 requirements/)).toBeVisible();
    timings.sort((a, b) => a - b);
    const p95 = timings[Math.ceil(timings.length * 0.95) - 1]!;
    console.log(`SC-007 /requirements first content ms: ${timings.join(', ')} (p95 ${p95})`);
    expect(p95).toBeLessThanOrEqual(2_000);
  });
});
