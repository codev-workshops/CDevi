import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';
import { API, signIn, uniq } from './helpers';

const HEADERS = {
  authorization: `Bearer ${E2E.ingestToken}`,
  'content-type': 'application/json',
};
const MIN = 60_000;
const at = (minsBeforeBase: number) =>
  new Date(new Date(E2E.base).getTime() - minsBeforeBase * MIN).toISOString();
const NAMES = ['Specify', 'Plan', 'Implement', 'Test', 'Review', 'Approve', 'Merge'];

async function put(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.put(`${API}${path}`, { headers: HEADERS, data });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

/** Ingests a 7-stage workflow: stages 1-4 completed, stage 5 in `state`, 6-7 queued, six artifacts and two test runs. */
async function ingestJourney(
  request: APIRequestContext,
  state: 'RUNNING' | 'FAILED' | 'WAITING_FOR_HUMAN',
) {
  const ext = uniq('us1');
  const title = `US1 journey ${ext}`;
  const w = await put(request, `/api/ingest/workflows/${ext}`, {
    projectKey: 'payments-api',
    title,
    agent: 'Review Agent',
    state: 'RUNNING',
    stage: { index: 5, count: 7, name: 'Review' },
    observedAt: at(200),
  });
  const stage = async (position: number, s: string, extra: Record<string, unknown> = {}) =>
    put(request, `/api/ingest/workflows/${ext}/stages/${position}`, {
      name: NAMES[position - 1],
      state: s,
      observedAt: at(200 - position * 20),
      agent: `${NAMES[position - 1]} Agent`,
      count: 7,
      ...extra,
    });
  for (let p = 1; p <= 4; p++) {
    await stage(p, 'RUNNING');
    await put(request, `/api/ingest/workflows/${ext}/stages/${p}`, {
      name: NAMES[p - 1],
      state: 'COMPLETED',
      observedAt: at(190 - p * 20),
      agent: `${NAMES[p - 1]} Agent`,
      count: 7,
    });
  }
  await stage(5, 'RUNNING');
  if (state === 'FAILED') {
    await stage(5, 'FAILED', {
      observedAt: at(80),
      reason: 'Review found a blocking finding',
      errorSummary: 'Review found a blocking finding',
    });
  } else if (state === 'WAITING_FOR_HUMAN') {
    const a = await request.put(`${API}/api/ingest/approvals/${ext}-a`, {
      headers: HEADERS,
      data: {
        workflowExternalId: ext,
        ask: `Approve: merge \`${ext}\` into main`,
        riskLevel: 'HIGH',
        requestedAt: at(80),
        expiresAt: at(-240),
      },
    });
    expect(a.ok(), await a.text()).toBeTruthy();
    await stage(5, 'WAITING_FOR_HUMAN', {
      observedAt: at(80),
      reason: 'Approval required before merge',
      requiresApproval: true,
      approvalExternalId: `${ext}-a`,
    });
  }
  await stage(6, 'QUEUED');
  await stage(7, 'QUEUED');
  if (state !== 'RUNNING') {
    const t = await request.post(`${API}/api/ingest/workflows/${ext}/transitions`, {
      headers: HEADERS,
      data: { toState: state, observedAt: at(79), reason: 'Review found a blocking finding' },
    });
    expect(t.ok(), await t.text()).toBeTruthy();
  }
  await put(request, `/api/ingest/agent-runs/${ext}-run5`, {
    workflowExternalId: ext,
    stagePosition: 5,
    agent: 'Review Agent',
    model: 'cdevi-orchestrator-1',
    state: state === 'RUNNING' ? 'RUNNING' : state,
    startedAt: at(100),
    summary: 'Reviewing the diff against the requirement spec',
    timeline: [{ at: at(99), kind: 'note', message: 'Loaded PR #412' }],
  });
  const artifacts: [number, string, string][] = [
    [1, 'requirement_spec', 'Requirement spec'],
    [2, 'impact_analysis', 'Impact analysis'],
    [2, 'implementation_plan', 'Implementation plan'],
    [3, 'code_diff', 'Code diff'],
    [4, 'test_results', 'Test results'],
    [5, 'pull_request', 'PR #412'],
  ];
  for (const [i, [pos, type, t]] of artifacts.entries()) {
    await put(request, `/api/ingest/artifacts/${ext}-art${i}`, {
      workflowExternalId: ext,
      stagePosition: pos,
      type,
      title: t,
      href: `https://example.test/${ext}/${type}`,
      producedAt: at(180 - pos * 20),
    });
  }
  await put(request, `/api/ingest/test-runs/${ext}-t1`, {
    workflowExternalId: ext,
    stagePosition: 4,
    category: 'unit',
    status: 'PASSED',
    total: 120,
    passed: 120,
    startedAt: at(115),
    finishedAt: at(112),
  });
  return { ext, title, id: w.id };
}

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.html).join(' | ')}`),
    label,
  ).toEqual([]);
}

test.describe('Workflow Detail (specs/001 US1)', () => {
  test('FR-001 FR-003 FR-004 the journey: pipeline, current stage, activity, every artifact and test evidence from one page', async ({
    page,
    request,
  }) => {
    const j = await ingestJourney(request, 'RUNNING');
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/workflows/${j.id}`);
    await expect(page.getByRole('heading', { level: 1, name: j.title })).toBeVisible();

    const pipeline = page.getByRole('list', { name: 'Stage pipeline' });
    const steps = pipeline.getByRole('listitem');
    await expect(steps).toHaveCount(7);
    await expect(steps.locator('b')).toHaveText(NAMES.map((n, i) => `${i + 1}. ${n}`));
    const current = pipeline.locator('[aria-current="step"]');
    await expect(current).toHaveCount(1);
    await expect(current).toContainText('5. Review');
    await expect(current.locator('.cd-pill[data-state]')).toHaveText('running');
    await expect(current).toContainText('Review Agent');

    const meter = page.getByRole('meter', { name: 'Progress' });
    await expect(meter).toHaveAttribute('aria-valuenow', '4');
    await expect(page.getByText('4 of 7 stages complete')).toBeVisible();

    const cur = page.getByRole('region', { name: /Current stage: Review/ });
    await expect(cur).toContainText('cdevi-orchestrator-1');
    await expect(cur).toContainText('6. Approve');
    await expect(cur).toContainText('not evidence');
    await expect(cur).toContainText('Reviewing the diff against the requirement spec');

    const activity = page.getByRole('list', { name: 'Activity' }).getByRole('listitem');
    expect(await activity.count()).toBeGreaterThanOrEqual(10);
    const times = await activity
      .locator('time')
      .evaluateAll((els) => els.map((e) => e.getAttribute('datetime')!));
    expect([...times].sort()).toEqual(times);
    await expect(activity.filter({ hasText: 'Loaded PR #412' })).toHaveCount(1);

    const artifacts = page.getByRole('list', { name: 'Artifacts' }).getByRole('listitem');
    await expect(artifacts).toHaveCount(6);
    await expect(artifacts.locator('.cd-trailing')).toHaveText([
      'requirement spec',
      'impact analysis',
      'implementation plan',
      'code diff',
      'test results',
      'pull request',
    ]);
    for (const [i, pos] of [1, 2, 2, 3, 4, 5].entries()) {
      await expect(artifacts.nth(i)).toContainText(`Stage ${pos}`);
    }
    await expect(page.getByRole('link', { name: 'PR #412' })).toHaveAttribute(
      'href',
      `https://example.test/${j.ext}/pull_request`,
    );
    const rail = page.getByRole('region', { name: 'Test runs' });
    await expect(rail).toContainText('unit');
    await expect(rail).toContainText('120/120 passed');
    await expect(page.getByRole('region', { name: 'Freshness' })).toContainText('live');
    await expectAxeClean(page, 'running workflow');
  });

  test('FR-005 a WAITING_FOR_HUMAN stage is prominent with its reason and one saffron action, above the pipeline', async ({
    page,
    request,
  }) => {
    const j = await ingestJourney(request, 'WAITING_FOR_HUMAN');
    await signIn(page, 'approver1@cdevi.demo');
    await page.goto(`/workflows/${j.id}`);
    const card = page.locator('.cd-decision');
    await expect(card).toBeVisible();
    await expect(card).toContainText('needs you');
    await expect(card).toContainText(`Approve: merge \`${j.ext}\` into main`);
    await expect(card).toContainText('high risk');
    const saffron = page.locator('main .cd-saffron');
    await expect(saffron).toHaveCount(1);
    await expect(saffron).toHaveText('Review approval');
    await expect(saffron).toHaveAttribute('href', /^\/approvals\//);
    const cardBox = (await card.boundingBox())!;
    const pipelineBox = (await page.getByRole('list', { name: 'Stage pipeline' }).boundingBox())!;
    expect(cardBox.y).toBeLessThan(pipelineBox.y);
    await expectAxeClean(page, 'waiting workflow');
  });

  test('FR-006 a failed workflow shows reason, failing and last successful stage; an engineer can retry from the keyboard', async ({
    page,
    request,
  }) => {
    const j = await ingestJourney(request, 'FAILED');
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/workflows/${j.id}`);
    const failure = page.getByRole('region', { name: 'Workflow failed' });
    await expect(failure).toContainText('Review found a blocking finding');
    await expect(failure).toContainText('Stage 5 · Review');
    await expect(failure).toContainText('Stage 4 · Test');
    await expect(failure.getByRole('button', { name: 'Retry' })).toBeEnabled();
    await expect(failure.getByRole('button', { name: 'Escalate' })).toBeEnabled();
    await expect(failure.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    await expectAxeClean(page, 'failed workflow');

    // Keyboard: Cancel is a two-step confirm that Escape backs out of.
    await failure.getByRole('button', { name: 'Cancel' }).focus();
    await page.keyboard.press('Enter');
    await expect(failure.getByRole('button', { name: 'Confirm cancel' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(failure.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await failure.getByRole('button', { name: 'Retry' }).focus();
    await page.keyboard.press('Enter');
    await expect(failure).toHaveCount(0);
    await expect(
      page.getByRole('list', { name: 'Stage pipeline' }).locator('[aria-current="step"] .cd-pill'),
    ).toHaveText('retrying');
    await expect(page.locator('.cd-page-meta .cd-pill[data-state]').first()).toHaveText('retrying');
  });

  test('FR-006 a viewer sees the failure but every action is disabled', async ({
    page,
    request,
  }) => {
    const j = await ingestJourney(request, 'FAILED');
    await signIn(page, 'viewer1@cdevi.demo');
    await page.goto(`/workflows/${j.id}`);
    const failure = page.getByRole('region', { name: 'Workflow failed' });
    await expect(failure.getByRole('button', { name: 'Retry' })).toBeDisabled();
    await expect(failure.getByRole('button', { name: 'Escalate' })).toBeDisabled();
    await expect(failure.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(failure).toContainText('Viewers cannot retry');
  });

  test('FR-034 SC-003 stage, artifact and test-run changes appear within 5 s without a refresh', async ({
    page,
    request,
  }) => {
    const j = await ingestJourney(request, 'RUNNING');
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/workflows/${j.id}`);
    const current = page
      .getByRole('list', { name: 'Stage pipeline' })
      .locator('[aria-current="step"]');
    await expect(current).toContainText('5. Review');
    let reloads = 0;
    page.on('load', () => reloads++);

    const t0 = Date.now();
    await put(request, `/api/ingest/workflows/${j.ext}/stages/5`, {
      name: 'Review',
      state: 'COMPLETED',
      observedAt: at(10),
      agent: 'Review Agent',
      count: 7,
    });
    await put(request, `/api/ingest/workflows/${j.ext}/stages/6`, {
      name: 'Approve',
      state: 'RUNNING',
      observedAt: at(9),
      agent: 'Approve Agent',
      count: 7,
    });
    await expect(current).toContainText('6. Approve', { timeout: 5_000 });
    const stageMs = Date.now() - t0;

    const t1 = Date.now();
    await put(request, `/api/ingest/artifacts/${j.ext}-live`, {
      workflowExternalId: j.ext,
      stagePosition: 6,
      type: 'test_results',
      title: 'Live test results',
      producedAt: at(8),
    });
    await put(request, `/api/ingest/test-runs/${j.ext}-t2`, {
      workflowExternalId: j.ext,
      stagePosition: 6,
      category: 'e2e',
      status: 'FAILED',
      total: 10,
      passed: 9,
      failed: 1,
      startedAt: at(8),
      finishedAt: at(7),
    });
    await expect(page.getByRole('list', { name: 'Artifacts' })).toContainText('Live test results', {
      timeout: 5_000,
    });
    await expect(page.getByRole('region', { name: 'Test runs' })).toContainText('9/10 passed', {
      timeout: 5_000,
    });
    const evidenceMs = Date.now() - t1;
    console.log(`Workflow Detail live update ms: stage ${stageMs}, evidence ${evidenceMs}`);
    expect(stageMs).toBeLessThanOrEqual(5_000);
    expect(evidenceMs).toBeLessThanOrEqual(5_000);
    expect(reloads).toBe(0);
  });

  test('an unknown or foreign workflow renders the same safe message and a way back', async ({
    page,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto('/workflows/00000000-0000-7000-8000-00000000dead');
    await expect(page.getByText("This item isn't available to you.")).toBeVisible();
    await page.goto('/workflows/not-a-uuid');
    await expect(page.getByText("This item isn't available to you.")).toBeVisible();
    await page.getByRole('link', { name: 'Back to Inbox' }).click();
    await page.waitForURL(/\/inbox/);
  });
});
