import AxeBuilder from '@axe-core/playwright';
import { createPool } from '@cdevi/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';
import { API, me, measureLcp, signIn, uniq } from './helpers';

// Dashboard Independent Test (specs/001 US3, quickstart §4.2): administrator, project "Dashboard Demo", window 7d.
// The seed is deterministic (seed/dashboard.ts); the API clock is pinned to E2E.base so windows are stable.

const HEADERS = {
  authorization: `Bearer ${E2E.ingestToken}`,
  'content-type': 'application/json',
};
const DEMO_KEY = 'dashboard-demo';
const STAGES = [
  'Requirement',
  'Analysis',
  'Architecture',
  'Implementation',
  'Testing',
  'Review',
  'PR',
] as const;
const ACTIVE_HREF =
  '/workflows?state=QUEUED,RUNNING,RETRYING,WAITING,WAITING_FOR_HUMAN,BLOCKED,FAILED';

async function demoProjectId(page: Page): Promise<string> {
  const { projects } = await me(page);
  const demo = projects.find((p) => p.key === DEMO_KEY);
  expect(demo, `administrator sees the ${DEMO_KEY} project`).toBeTruthy();
  return demo!.id;
}

/** Quickstart §4.2 steps 1–2: open the Dashboard (All projects, Last 7 days) and choose Dashboard Demo in the selector. */
async function openDemoDashboard(page: Page) {
  await signIn(page, 'admin@cdevi.demo');
  const demo = await demoProjectId(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');
  await expect(page.getByRole('combobox', { name: 'Window' })).toHaveValue('7d');
  await page.getByRole('combobox', { name: 'Project' }).selectOption({ label: 'Dashboard Demo' });
  await expect(page).toHaveURL(new RegExp(`project=${demo}`));
  await expect(figure(page, '18 active workflows')).toBeVisible();
  return demo;
}

/** A dashboard figure is a link whose accessible name is "{value} {label}" (ui-dashboard.md §6). */
const figure = (page: Page, name: string) => page.getByRole('link', { name, exact: true });

async function transition(
  request: APIRequestContext,
  externalId: string,
  toState: string,
  reason: string,
) {
  const res = await request.post(`${API}/api/ingest/workflows/${externalId}/transitions`, {
    headers: HEADERS,
    data: { toState, observedAt: new Date(Date.now() + 60_000).toISOString(), reason },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Marks the document so a later check proves the page was not reloaded (FR-034 "without refresh"). */
async function markDocument(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __cdeviNoReload: number }).__cdeviNoReload = performance.now();
  });
}
async function expectNotReloaded(page: Page) {
  expect(
    await page.evaluate(
      () => typeof (window as unknown as { __cdeviNoReload?: number }).__cdeviNoReload === 'number',
    ),
    'the document was replaced (full reload) instead of updating in place',
  ).toBe(true);
}

/**
 * SC-007 workload: 500 workflows / 5 000 agent runs / 5 000 test runs / 50 000 HIGH–LOW audit events in a fresh
 * organization (same shape as apps/api/tests/helpers.ts seedSc007Org) so the aggregate queries hit realistic
 * table sizes while the administrator's own figures stay the seeded ones.
 */
async function seedSc007Fixture(base: string) {
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
        [uniq('SC-007 e2e')],
      )
    ).rows[0]!.id;
    const projectIds = (
      await client.query<{ id: string }>(
        `INSERT INTO projects (organization_id, key, name)
         SELECT $1, 'sc7e-' || g, 'SC7 e2e ' || g FROM generate_series(1, 4) g RETURNING id`,
        [organizationId],
      )
    ).rows.map((r) => r.id);
    await client.query(
      `INSERT INTO workflows (organization_id, project_id, external_id, title, agent, state, state_observed_at, stage_index, stage_count, stage_name, pull_request_ref, started_at, finished_at)
       SELECT $1, ($2::uuid[])[(g % 4) + 1], 'sc7e-w' || g, 'Workflow ' || g, 'Implementation Agent',
              CASE WHEN g % 10 = 0 THEN 'RUNNING' ELSE 'COMPLETED' END::workflow_state,
              $3::timestamptz - (g % 60) * interval '1 day',
              (g % 7) + 1, 7, 'Implementation',
              CASE WHEN g % 10 = 0 THEN NULL ELSE 'PR #' || g END,
              $3::timestamptz - (g % 60) * interval '1 day' - interval '2 hours',
              CASE WHEN g % 10 = 0 THEN NULL ELSE $3::timestamptz - (g % 60) * interval '1 day' END
         FROM generate_series(1, 500) g`,
      [organizationId, projectIds, base],
    );
    await client.query(
      `INSERT INTO workflow_stages (organization_id, project_id, workflow_id, position, name, state, state_observed_at)
       SELECT organization_id, project_id, id, 1, 'Implementation', 'COMPLETED', state_observed_at
         FROM workflows WHERE organization_id = $1`,
      [organizationId],
    );
    await client.query(
      `WITH s AS (SELECT id, project_id, workflow_id, row_number() OVER (ORDER BY id) rn FROM workflow_stages WHERE organization_id = $1)
       INSERT INTO agent_runs (organization_id, project_id, workflow_id, stage_id, external_id, agent, state, started_at, finished_at)
       SELECT $1, s.project_id, s.workflow_id, s.id, 'sc7e-r' || g, 'Implementation Agent',
              CASE WHEN g % 10 = 0 THEN 'FAILED' ELSE 'COMPLETED' END::workflow_state,
              $2::timestamptz - (g % 60) * interval '1 day' - interval '1 hour',
              $2::timestamptz - (g % 60) * interval '1 day'
         FROM generate_series(1, 5000) g JOIN s ON s.rn = (g % 500) + 1`,
      [organizationId, base],
    );
    await client.query(
      `WITH s AS (SELECT id, project_id, workflow_id, row_number() OVER (ORDER BY id) rn FROM workflow_stages WHERE organization_id = $1)
       INSERT INTO test_runs (organization_id, project_id, workflow_id, stage_id, external_id, category, status, total, passed, failed, started_at, finished_at)
       SELECT $1, s.project_id, s.workflow_id, s.id, 'sc7e-t' || g, 'unit', 'PASSED', 100, 97, 3,
              $2::timestamptz - (g % 60) * interval '1 day' - interval '1 hour',
              $2::timestamptz - (g % 60) * interval '1 day'
         FROM generate_series(1, 5000) g JOIN s ON s.rn = (g % 500) + 1`,
      [organizationId, base],
    );
    await client.query(
      `INSERT INTO audit_events (organization_id, project_id, actor_type, actor_name, action, target_type, target_id, risk_level, result, occurred_at)
       SELECT $1, ($2::uuid[])[(g % 4) + 1], 'user', 'Tess Approver', 'approval.approved', 'approval', gen_random_uuid(),
              (ARRAY['LOW','MEDIUM','HIGH','CRITICAL']::risk_level[])[(g % 4) + 1], 'RUNNING',
              $3::timestamptz - (g % 60) * interval '1 day'
         FROM generate_series(1, 50000) g`,
      [organizationId, projectIds, base],
    );
    await client.query('COMMIT');
    await client.query('ANALYZE workflows, workflow_stages, agent_runs, test_runs, audit_events');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

test.describe('Dashboard — Independent Test (specs/001 US3)', () => {
  test('FR-023 dashboard shows 18 active workflows, 4 approvals, 2 clarifications, 97.4 % test pass rate and security findings not connected yet', async ({
    page,
  }) => {
    await openDemoDashboard(page);

    // Scenario 1: header counts and the pipeline.
    await expect(figure(page, '18 active workflows')).toBeVisible();
    await expect(figure(page, '7 running agents')).toBeVisible();
    await expect(figure(page, '6 PRs generated · Last 7 days')).toBeVisible();
    await expect(figure(page, '2 open failures')).toBeVisible();
    const pipeline = page.getByRole('list', { name: 'Pipeline' });
    const counts = [3, 2, 1, 4, 3, 3, 2];
    for (const [i, name] of STAGES.entries()) {
      const row = pipeline.getByRole('listitem').filter({ has: page.getByRole('link', { name }) });
      await expect(row).toContainText(`Stage ${i + 1}`);
      await expect(row.locator('.cd-trailing')).toHaveText(String(counts[i]));
    }
    await expect(pipeline.getByRole('listitem')).toHaveCount(7);
    await expect(
      page.getByRole('img', { name: /^Workflows per SDLC stage: 3 Requirement, 2 Analysis/ }),
    ).toBeVisible();

    // Scenario 2: what needs me, counted separately.
    await expect(figure(page, '4 approvals')).toBeVisible();
    await expect(figure(page, '2 clarifications')).toBeVisible();
    await expect(figure(page, '1 failed workflows')).toBeVisible();
    await expect(figure(page, '1 blocked workflows')).toBeVisible();

    // Scenario 3: health for the selected window.
    const health = page.getByRole('region', { name: 'Health · Last 7 days' });
    await expect(health.getByRole('link', { name: '97.4 %' })).toHaveAccessibleDescription(
      '974 / 1000',
    );
    await expect(health.getByRole('link', { name: '94.6 %' })).toHaveAccessibleDescription(
      '35 / 37',
    );
    await expect(health.getByRole('link', { name: '33.3 %' })).toHaveAccessibleDescription(
      '8 / 24',
    );
    await expect(health.getByRole('meter', { name: 'Test pass rate' })).toBeVisible();

    // Scenario 4 (risk) and the not-connected security findings (approved scope decision 1).
    const risk = page.getByRole('region', { name: 'Risk' });
    await expect(risk.getByRole('link', { name: '2 pending approvals' })).toBeVisible();
    await expect(risk.getByRole('link', { name: '0 audit events · Last 7 days' })).toBeVisible();
    await expect(risk.getByText('—', { exact: true })).toBeVisible();
    await expect(risk.getByRole('status')).toContainText(
      'Not connected yet — review findings arrive with PR Review (User Story 6).',
    );

    // Scenario 5: 12 cards of 18, each with identifier, stage, progress, agent, elapsed and a state word.
    await expect(page.getByRole('heading', { name: 'Active workflows (18)' })).toBeVisible();
    const cards = page.getByRole('list', { name: 'Active workflows' }).getByRole('listitem');
    await expect(cards).toHaveCount(12);
    const first = cards.first();
    await expect(first).toContainText(/s500-d\d\d/);
    await expect(first).toContainText(/Stage \d of 7/);
    await expect(first.getByRole('meter', { name: 'Progress' })).toBeVisible();
    await expect(first.locator('.cd-pill')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Show all 18' })).toHaveAttribute(
      'href',
      ACTIVE_HREF,
    );
  });

  test('FR-023 every figure links to its filtered list: stage 1 → /workflows?stage=1 (query preserved on the placeholder), 4 approvals → Approval Center listing the four Dashboard Demo items, a card → Workflow Detail', async ({
    page,
  }) => {
    const demo = await openDemoDashboard(page);

    // Every figure carries the R25 href (asserted, not navigated: most targets are placeholders today).
    const hrefs: Record<string, string> = {
      '18 active workflows': ACTIVE_HREF,
      '7 running agents': '/workflows?state=RUNNING,RETRYING',
      '6 PRs generated · Last 7 days': '/workflows?hasPr=true&window=7d',
      '2 open failures': '/workflows?state=FAILED,BLOCKED',
      '4 approvals': '/approvals',
      '2 clarifications': '/approvals?kind=clarification',
      '1 failed workflows': '/workflows?state=FAILED',
      '1 blocked workflows': '/workflows?state=BLOCKED',
      '97.4 %': '/testing?window=7d',
      '94.6 %': '/agents?window=7d',
      '33.3 %': '/workflows?intervention=human&window=7d',
      '2 pending approvals': '/approvals?risk=HIGH,CRITICAL',
      '0 audit events · Last 7 days': '/audit?risk=HIGH,CRITICAL&window=7d',
      'Open Reviews': '/reviews',
    };
    for (const [name, href] of Object.entries(hrefs)) {
      await expect(figure(page, name), name).toHaveAttribute('href', href);
    }
    const pipeline = page.getByRole('list', { name: 'Pipeline' });
    for (const [i, name] of STAGES.entries()) {
      await expect(pipeline.getByRole('link', { name })).toHaveAttribute(
        'href',
        `/workflows?stage=${i + 1}`,
      );
    }

    // Stage link → Workflow Center placeholder with the query string preserved (approved scope decision 2).
    await pipeline.getByRole('link', { name: 'Requirement' }).click();
    await expect(page).toHaveURL(/\/workflows\?stage=1$/);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');

    // 4 approvals → Approval Center scoped to Dashboard Demo through the shared project cookie.
    await figure(page, '4 approvals').click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Approval Center');
    await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue(demo);
    const decisions = page.getByRole('list', { name: 'Needs a decision' });
    await expect(decisions.getByRole('listitem')).toHaveCount(6); // 4 approvals + 2 clarifications
    await expect(decisions.getByRole('link', { name: /Approve/ })).toHaveCount(4);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');

    // A card → Workflow Detail.
    const firstCard = page
      .getByRole('list', { name: 'Active workflows' })
      .getByRole('listitem')
      .first();
    const externalId = (await firstCard.locator('.cd-mono').first().textContent())!.trim();
    const href = await firstCard.getByRole('link').getAttribute('href');
    expect(href).toMatch(/^\/workflows\/[0-9a-f-]{36}$/);
    await firstCard.getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByText(externalId).first()).toBeVisible();
  });

  test('FR-025 All projects shows the organization-wide counts equal to the header count', async ({
    page,
  }) => {
    await signIn(page, 'admin@cdevi.demo');
    await page.goto('/dashboard');
    await expect(page.getByRole('combobox', { name: 'Project' })).toHaveValue('all');
    await expect(page.getByRole('combobox', { name: 'Window' })).toHaveValue('7d');

    const value = async (pattern: RegExp) => {
      const link = page.getByRole('link', { name: pattern });
      await expect(link).toBeVisible();
      return Number((await link.getAttribute('aria-label'))!.match(/^(\d+) /)![1]);
    };
    const approvals = await value(/^\d+ approvals$/);
    const clarifications = await value(/^\d+ clarifications$/);
    const active = await value(/^\d+ active workflows$/);
    // S-500 (100 running + …) plus the 18 Dashboard Demo workflows: the organization, not one project.
    expect(active).toBeGreaterThanOrEqual(118);
    expect(approvals).toBeGreaterThanOrEqual(28);
    expect(clarifications).toBeGreaterThanOrEqual(14);

    // The Approvals nav count is approvals + clarifications for the same scope (FR-035).
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const navCount = nav.getByRole('link', { name: /^Approvals/ }).locator('.cd-count');
    await expect(navCount).toHaveText(String(approvals + clarifications));
  });

  test('FR-026 HIGH and CRITICAL badges are visible in the risk region', async ({ page }) => {
    await openDemoDashboard(page);
    const risk = page.getByRole('region', { name: 'Risk' });
    const high = risk.locator('[data-risk="HIGH"][data-prominent]');
    const critical = risk.locator('[data-risk="CRITICAL"][data-prominent]');
    await expect(high.first()).toBeVisible();
    await expect(critical.first()).toBeVisible();
    await expect(high).toHaveCount(2);
    await expect(critical).toHaveCount(2);
    await expect(high.first()).toHaveText(/high risk/i);
    await expect(critical.first()).toHaveText(/critical risk/i);
  });

  test('SC-010 page-level axe passes and Tab reaches every figure link in the §5 order, Enter on Requirement navigates to /workflows?stage=1', async ({
    page,
  }) => {
    await openDemoDashboard(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.html).join(' | ')}`,
      ),
    ).toEqual([]);

    // Keyboard walk (ui-dashboard.md §5): selects, four header links, seven stage links, four needs-me links,
    // three health links, risk links, then the cards.
    await page.getByRole('combobox', { name: 'Project' }).focus();
    const expected = [
      'Window',
      '18 active workflows',
      '7 running agents',
      '6 PRs generated · Last 7 days',
      '2 open failures',
      ...STAGES,
      '4 approvals',
      '2 clarifications',
      '1 failed workflows',
      '1 blocked workflows',
      '97.4 %',
      '94.6 %',
      '33.3 %',
      '2 pending approvals',
      '0 audit events · Last 7 days',
      'Open Reviews',
    ];
    const visited: string[] = [];
    for (let i = 0; i < expected.length; i++) {
      await page.keyboard.press('Tab');
      visited.push(
        await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return (
            el?.getAttribute('aria-label') ??
            el
              ?.getAttribute('aria-labelledby')
              ?.split(' ')
              .map((id) => document.getElementById(id)?.textContent?.trim())
              .join(' ') ??
            (el?.tagName === 'SELECT'
              ? document.querySelector(`label[for="${el.id}"]`)?.textContent?.trim()
              : el?.textContent?.trim()) ??
            ''
          );
        }),
      );
    }
    expect(visited).toEqual(expected);
    const cardLink = page
      .getByRole('list', { name: 'Active workflows' })
      .getByRole('listitem')
      .first()
      .getByRole('link');
    await page.keyboard.press('Tab');
    await expect(cardLink).toBeFocused();

    // Enter on "Requirement" follows the stage link.
    await page
      .getByRole('list', { name: 'Pipeline' })
      .getByRole('link', { name: 'Requirement' })
      .focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/workflows\?stage=1$/);
  });

  test('SC-007 initial content within 2 s p95 over 10 runs at the seeded database plus the SC-007 fixture', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await seedSc007Fixture(E2E.base);
    const demo = await openDemoDashboard(page);
    const url = `/dashboard?project=${demo}&window=7d`;
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      await page.goto('about:blank');
      await page.goto(url, { waitUntil: 'load' });
      await expect(figure(page, '18 active workflows')).toBeVisible();
      const ms = await measureLcp(page);
      samples.push(ms);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.ceil(samples.length * 0.95) - 1]!;
    console.log(`/dashboard initial content ms: median ${samples[5]}, p95 ${p95}`);
    expect(p95).toBeLessThanOrEqual(2_000);
  });

  // The two ingestion tests mutate the seeded Dashboard Demo figures, so they run last (workers: 1, in-file order).
  test('FR-034 an ingested WAITING_FOR_HUMAN transition updates running agents and the card pill within 5 s without reload (SC-003)', async ({
    page,
    request,
  }) => {
    await openDemoDashboard(page);
    await expect(figure(page, '7 running agents')).toBeVisible();
    const card = page
      .getByRole('list', { name: 'Active workflows' })
      .getByRole('listitem')
      .filter({ hasText: 's500-d05' });
    await expect(card.locator('.cd-pill')).toHaveText('running');
    await expect(page.getByRole('status').filter({ hasText: 'live' })).toBeVisible();

    await markDocument(page);
    const sent = Date.now();
    await transition(request, 's500-d05', 'WAITING_FOR_HUMAN', 'needs sign-off');
    await expect(figure(page, '6 running agents')).toBeVisible({ timeout: 5_000 });
    const elapsed = Date.now() - sent;
    await expect(card.locator('.cd-pill')).toHaveText('needs you');
    await expect(figure(page, '18 active workflows')).toBeVisible();
    await expectNotReloaded(page);
    console.log(`SC-003 dashboard refreshed ${elapsed} ms after the ingest`);
    expect(elapsed).toBeLessThanOrEqual(5_000);
  });

  test('SC-002 an ingested BLOCKED transition raises the blocked workflows count in What needs me within 5 s', async ({
    page,
    request,
  }) => {
    await openDemoDashboard(page);
    const needsMe = page.getByRole('region', { name: 'What needs me' });
    await expect(needsMe.getByRole('link', { name: '1 blocked workflows' })).toBeVisible();
    await markDocument(page);
    const sent = Date.now();
    await transition(request, 's500-d06', 'BLOCKED', 'vendor sandbox unavailable');
    await expect(needsMe.getByRole('link', { name: '2 blocked workflows' })).toBeVisible({
      timeout: 5_000,
    });
    const elapsed = Date.now() - sent;
    await expect(figure(page, '3 open failures')).toBeVisible();
    await expectNotReloaded(page);
    console.log(`SC-002 needs-me refreshed ${elapsed} ms after the ingest`);
    expect(elapsed).toBeLessThanOrEqual(5_000);
  });
});
