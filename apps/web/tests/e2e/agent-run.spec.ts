import { createPool } from '@cdevi/db';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';
import { API, expectAxeClean, measureLcp, signIn, uniq } from './helpers';

// Agent Run Inspector Independent Test (specs/001 US5, quickstart §6, plan §7): the seeded showcase run
// `s500-001-r7` (3 decisions, one restricted evidence) is read as-is; anything that mutates is done on a workflow
// ingested by the test so the seed stays intact for the other suites.

const HEADERS = {
  authorization: `Bearer ${E2E.ingestToken}`,
  'content-type': 'application/json',
};
const SHOWCASE_WORKFLOW = 's500-001';
const SHOWCASE_RUN = 's500-001-r7';
const MIN = 60_000;
const at = (minsBeforeBase: number) =>
  new Date(new Date(E2E.base).getTime() - minsBeforeBase * MIN).toISOString();
const later = (secs: number) => new Date(Date.now() + secs * 1000).toISOString();
/** Wall-clock timestamps: the browser judges run freshness by its own clock, not the API's fixed one. */
const agoMin = (mins: number) => later(-mins * 60);

async function rowId(table: 'workflows' | 'agent_runs', externalId: string): Promise<string> {
  const pool = createPool({ connectionString: process.env['DATABASE_MIGRATOR_URL'], max: 1 });
  try {
    const r = await pool.query<{ id: string }>(`SELECT id FROM ${table} WHERE external_id = $1`, [
      externalId,
    ]);
    expect(r.rows[0], `${table} ${externalId} is seeded`).toBeTruthy();
    return r.rows[0]!.id;
  } finally {
    await pool.end();
  }
}

async function put(request: APIRequestContext, path: string, data: unknown) {
  const res = await request.put(`${API}${path}`, { headers: HEADERS, data });
  expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
  return (await res.json()) as { id: string };
}

type Step = { label: string; status: 'completed' | 'running' | 'pending' | 'failed' };
const STEPS_BEFORE: Step[] = [
  { label: 'Read the implementation plan', status: 'completed' },
  { label: 'Implement the limiter', status: 'running' },
  { label: 'Run the unit suite', status: 'pending' },
];
const STEPS_AFTER: Step[] = [
  { label: 'Read the implementation plan', status: 'completed' },
  { label: 'Implement the limiter', status: 'completed' },
  { label: 'Run the unit suite', status: 'running' },
];

/**
 * A RUNNING workflow in payments-api whose stage 3 has one RUNNING run with structured progress and no decisions.
 * `runBody(steps, lastActivityMin)` rebuilds the upsert so a test can advance steps or age the activity.
 */
async function ingestLiveRun(request: APIRequestContext) {
  const ext = uniq('us5');
  const runExt = `${ext}-run3`;
  const w = await put(request, `/api/ingest/workflows/${ext}`, {
    projectKey: 'payments-api',
    title: `US5 live run ${ext}`,
    agent: 'Implementation Agent',
    state: 'RUNNING',
    stage: { index: 3, count: 7, name: 'Implement' },
    observedAt: at(40),
  });
  await put(request, `/api/ingest/workflows/${ext}/stages/3`, {
    name: 'Implement',
    state: 'RUNNING',
    observedAt: at(39),
    agent: 'Implementation Agent',
    count: 7,
  });
  const runBody = (steps: Step[], lastActivityMin = 2) => ({
    workflowExternalId: ext,
    stagePosition: 3,
    agent: 'Implementation Agent',
    model: 'cdevi-orchestrator-1',
    state: 'RUNNING',
    startedAt: agoMin(lastActivityMin + 8),
    summary: 'Implementing the sliding-window limiter.',
    timeline: [
      { at: agoMin(lastActivityMin), kind: 'tool', message: 'Created src/auth/limiter.ts' },
    ],
    steps,
  });
  const run = await put(request, `/api/ingest/agent-runs/${runExt}`, runBody(STEPS_BEFORE));
  return { ext, runExt, workflowId: w.id, runId: run.id, runBody };
}

const decision = (position: number, extra: Record<string, unknown> = {}) => ({
  position,
  decidedAt: at(35 - position),
  action: `Decision ${position}: kept the limiter inside the auth module`,
  reason: 'The plan recommends a single-purpose module that can be unit-tested in isolation.',
  confidence: 'HIGH',
  policyOutcome: 'ALLOWED',
  evidence: [
    {
      kind: 'file',
      label: 'src/auth/limiter.ts',
      href: 'https://git.cdevi.demo/payments-api/blob/main/src/auth/limiter.ts',
      locator: 'src/auth/limiter.ts:1',
      accessible: true,
    },
  ],
  ...extra,
});

const decisions = (page: Page) =>
  page.getByRole('list', { name: 'Decisions' }).locator('.cd-decision');
const progress = (page: Page) => page.getByRole('list', { name: 'Progress' });

test.describe('Agent Run Inspector — Independent Test (specs/001 US5)', () => {
  test('US5 AS-1/AS-2: engineer opens a run from Workflow Detail and sees header, timeline and three decisions with evidence', async ({
    page,
  }) => {
    const workflowId = await rowId('workflows', SHOWCASE_WORKFLOW);
    const runId = await rowId('agent_runs', SHOWCASE_RUN);
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/workflows/${workflowId}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Add rate limiting to /api/auth',
    );

    // AS-1: the current stage (6. Review) lists its runs; the waiting one is the showcase run.
    const inspect = page
      .getByRole('link', { name: /^Inspect run \d of \d by Review Agent, needs you$/ })
      .first();
    await expect(inspect).toHaveAttribute('href', `/agents/runs/${runId}`);
    await inspect.click();
    await expect(page).toHaveURL(new RegExp(`/agents/runs/${runId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review Agent — Review');

    // FR-016 header: agent, model, state, started, duration.
    const header = page.getByRole('region', { name: 'Run', exact: true });
    await expect(header).toContainText('Review Agent');
    await expect(header).toContainText('cdevi-orchestrator-1');
    await expect(header).toContainText('6. Review');
    await expect(header.locator('.cd-pill[data-state="WAITING_FOR_HUMAN"]')).toHaveText(
      'needs you',
    );
    await expect(header.locator('time[datetime^="2026-"]').first()).toHaveText(
      /^2026-09-1\d \d\d:\d\d UTC \(\d+ [a-z]+ ago\)$/,
    );
    await expect(header.locator('time[datetime^="PT"]')).toHaveText(/\d+ h|\d+ min \d+ s/);
    await expect(header).toContainText('Review complete; waiting for approval to open the PR.');
    await expect(page.locator('main .cd-saffron')).toHaveCount(0);

    // AS-3 structured progress rides the Stepper: 2 done, 1 current, 1 pending.
    const steps = progress(page).getByRole('listitem');
    await expect(steps).toHaveCount(4);
    await expect(progress(page).locator('[aria-current="step"]')).toContainText(
      'Wait for approval to open the PR',
    );
    await expect(page.getByText('2 of 4 steps completed')).toBeVisible();

    // FR-016 timeline: at least one line, each with a time and the event kind.
    await page.getByRole('tab', { name: 'Timeline (2)' }).click();
    const lines = page.getByLabel('Agent activity').locator('time');
    expect(await lines.count()).toBeGreaterThanOrEqual(1);
    await expect(page.getByLabel('Agent activity')).toContainText('note · No blocking findings');
    await expect(page.getByLabel('Agent activity')).toContainText(
      'decision · Opening a pull request needs human approval',
    );

    // FR-017: three decisions, each with action, reason, confidence and policy outcome words.
    await page.getByRole('tab', { name: 'Decisions (3)' }).click();
    await expect(decisions(page)).toHaveCount(3);
    const first = decisions(page).nth(0);
    await expect(first).toContainText('1. Accepted the limiter diff without requesting changes');
    await expect(first).toContainText('All four suites pass');
    await expect(first.locator('.cd-pill').filter({ hasText: 'confidence high' })).toBeVisible();
    await expect(first.locator('.cd-pill').filter({ hasText: /^allowed$/ })).toBeVisible();
    await expect(decisions(page).nth(2)).toContainText('approval required');
    await expect(decisions(page).nth(2)).toContainText('policy POL-AUTH-03');
    for (const i of [0, 1, 2]) {
      await expect(
        decisions(page)
          .nth(i)
          .locator('.cd-pill')
          .filter({ hasText: /^confidence / }),
      ).toHaveCount(1);
    }

    // FR-026: the one decision carrying a risk level shows a RiskBadge.
    const risk = decisions(page).locator('[data-risk]');
    await expect(risk).toHaveCount(1);
    await expect(risk).toHaveText(/medium risk/i);

    // Evidence: accessible refs are links to their targets; the restricted one is text, never an anchor.
    await expect(
      decisions(page).getByRole('link', { name: /PAY-231 — rate limiting for \/api\/auth/ }),
    ).toHaveAttribute('href', 'https://jira.acme.example/browse/PAY-231');
    const artifactRef = decisions(page).getByRole('link', { name: 'Test results — all suites' });
    await expect(artifactRef).toHaveAttribute('href', new RegExp(`^/workflows/${workflowId}(#|$)`));
    await expect(
      decisions(page).getByRole('link', {
        name: /Policy — changes to auth endpoints need approval/,
      }),
    ).toHaveAttribute('href', 'https://wiki.acme.example/policies/auth-changes');
    const restricted = decisions(page)
      .locator('.cd-check')
      .filter({ hasText: 'access restricted' });
    await expect(restricted).toHaveCount(1);
    await expect(restricted).toContainText('perf/auth-load.k6.js');
    await expect(restricted.locator('a')).toHaveCount(0);
    await expect(page.getByText('access restricted')).toHaveCount(1);

    // The artifact evidence opens Workflow Detail (not a broken link).
    await artifactRef.click();
    await expect(page).toHaveURL(new RegExp(`/workflows/${workflowId}`));
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Add rate limiting to /api/auth',
    );
  });

  test('US5 AS-3 / FR-004: a step update from the runtime is reflected live without reload', async ({
    page,
    request,
  }) => {
    const live = await ingestLiveRun(request);
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/agents/runs/${live.runId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Implementation Agent — Implement',
    );
    await expect(progress(page).locator('[aria-current="step"]')).toContainText(
      'Implement the limiter',
    );
    await expect(page.getByText('1 of 3 steps completed')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Decisions (0)' })).toBeVisible();
    let reloads = 0;
    page.on('load', () => reloads++);

    const t0 = Date.now();
    await put(request, `/api/ingest/agent-runs/${live.runExt}`, live.runBody(STEPS_AFTER));
    await expect(progress(page).locator('[aria-current="step"]')).toContainText(
      'Run the unit suite',
      { timeout: 2_000 },
    );
    const ms = Date.now() - t0;
    await expect(page.getByText('2 of 3 steps completed')).toBeVisible();
    await expect(progress(page).getByRole('listitem').nth(1)).toContainText('(done)');
    await expect(progress(page).locator('.cd-spinner, [role="progressbar"]')).toHaveCount(0);
    console.log(`Agent run step update ms: ${ms}`);
    expect(ms).toBeLessThanOrEqual(2_000);

    // Edge case "run exceeds duration": 40 quiet minutes show the stale Notice; the state word does not change.
    const stale = page.getByText(/No activity for .* the runtime has not reported progress/);
    await expect(stale).toHaveCount(0);
    await put(request, `/api/ingest/agent-runs/${live.runExt}`, live.runBody(STEPS_AFTER, 40));
    await expect(stale).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('main .cd-pill[data-state="RUNNING"]').first()).toHaveText('running');
    await put(request, `/api/ingest/agent-runs/${live.runExt}`, live.runBody(STEPS_AFTER, 1));
    await expect(stale).toHaveCount(0, { timeout: 5_000 });
    expect(reloads).toBe(0);
  });

  test('FR-017: a decisions ingest replaces the set and the screen shows the new cards live', async ({
    page,
    request,
  }) => {
    const live = await ingestLiveRun(request);
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto(`/agents/runs/${live.runId}`);
    await expect(page.getByRole('tab', { name: 'Decisions (0)' })).toBeVisible();
    let reloads = 0;
    page.on('load', () => reloads++);

    const res = await request.put(`${API}/api/ingest/agent-runs/${live.runExt}/decisions`, {
      headers: HEADERS,
      data: {
        observedAt: later(60),
        decisions: [
          decision(1),
          decision(2, {
            confidence: 'MEDIUM',
            policyOutcome: 'APPROVAL_REQUIRED',
            policyRef: 'POL-AUTH-03',
            riskLevel: 'HIGH',
            evidence: [{ kind: 'ticket', label: 'PAY-231', locator: 'PAY-231', accessible: false }],
          }),
        ],
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toEqual({ result: 'accepted', count: 2 });

    await page.getByRole('tab', { name: 'Decisions (2)' }).click({ timeout: 5_000 });
    await expect(decisions(page)).toHaveCount(2);
    await expect(decisions(page).nth(1)).toContainText('approval required');
    await expect(decisions(page).nth(1).locator('[data-risk="HIGH"]')).toHaveText(/high risk/i);
    await expect(decisions(page).nth(1)).toContainText('PAY-231 — access restricted');
    await expect(decisions(page).nth(1).locator('a')).toHaveCount(0);
    expect(reloads).toBe(0);

    // Replace-whole: a newer batch with one decision leaves exactly one card; an older one is stale and ignored.
    const one = await request.put(`${API}/api/ingest/agent-runs/${live.runExt}/decisions`, {
      headers: HEADERS,
      data: { observedAt: later(120), decisions: [decision(1)] },
    });
    expect(await one.json()).toEqual({ result: 'accepted', count: 1 });
    await expect(decisions(page)).toHaveCount(1, { timeout: 5_000 });
    const stale = await request.put(`${API}/api/ingest/agent-runs/${live.runExt}/decisions`, {
      headers: HEADERS,
      data: { observedAt: later(30), decisions: [decision(1), decision(2), decision(3)] },
    });
    expect(stale.status()).toBe(200);
    expect(await stale.json()).toEqual({ result: 'stale', count: 1 });
    await expect(decisions(page)).toHaveCount(1);
  });

  test('FR-018: an ingest payload carrying a reasoning field is rejected with 400 and never echoed', async ({
    request,
  }) => {
    const live = await ingestLiveRun(request);
    const secret = 'CHAIN-OF-THOUGHT-MUST-NOT-LEAK';
    for (const key of ['reasoning', 'chainOfThought', 'thoughts']) {
      const res = await request.put(`${API}/api/ingest/agent-runs/${live.runExt}/decisions`, {
        headers: HEADERS,
        data: { observedAt: later(60), decisions: [decision(1, { [key]: secret })] },
      });
      expect(res.status(), key).toBe(400);
      expect(res.headers()['content-type']).toContain('application/problem+json');
      const body = await res.text();
      expect(body, key).not.toContain(secret);
    }
    const top = await request.put(`${API}/api/ingest/agent-runs/${live.runExt}/decisions`, {
      headers: HEADERS,
      data: { observedAt: later(60), reasoning: secret, decisions: [decision(1)] },
    });
    expect(top.status()).toBe(400);
    expect(await top.text()).not.toContain(secret);
  });

  test('FR-032: a viewer opens the run read-only — same content, no saffron and no controls', async ({
    page,
  }) => {
    const runId = await rowId('agent_runs', SHOWCASE_RUN);
    await signIn(page, 'viewer1@cdevi.demo');
    await page.goto(`/agents/runs/${runId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review Agent — Review');
    await expect(decisions(page)).toHaveCount(3);
    await expect(page.locator('main .cd-saffron')).toHaveCount(0);
    await expect(page.locator('main').getByRole('button')).toHaveCount(0);
    await expect(page.locator('main input, main select, main textarea')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Back to workflow' })).toHaveAttribute(
      'href',
      /^\/workflows\/[0-9a-f-]{36}$/,
    );
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
      'Stage 6 · Review',
    );
  });

  test('FR-032: an unknown or foreign run renders the same safe message and a way back', async ({
    page,
  }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.goto('/agents/runs/00000000-0000-7000-8000-00000000dead');
    await expect(page.getByText("This item isn't available to you.")).toBeVisible();
    await page.goto('/agents/runs/not-a-uuid');
    await expect(page.getByText("This item isn't available to you.")).toBeVisible();
    await page.getByRole('link', { name: 'Back to Workflows' }).click();
    await page.waitForURL(/\/workflows$/);
  });

  test('SC-010 page-level axe passes on both tabs and initial content is within 2 s', async ({
    page,
  }) => {
    const runId = await rowId('agent_runs', SHOWCASE_RUN);
    await signIn(page, 'engineer1@cdevi.demo');
    const url = `/agents/runs/${runId}`;
    await page.goto(url);
    await expect(decisions(page)).toHaveCount(3);
    await expectAxeClean(page, 'decisions tab');
    await page.getByRole('tab', { name: 'Timeline (2)' }).click();
    await expect(page.getByLabel('Agent activity')).toBeVisible();
    await expectAxeClean(page, 'timeline tab');
    // FR-018: no reasoning text reaches the page in either tab.
    expect(await page.locator('main').innerText()).not.toMatch(/reasoning|chain.?of.?thought/i);
    // Keyboard: ArrowRight on the tablist moves to Decisions.
    await page.getByRole('tab', { name: 'Timeline (2)' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Decisions (3)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await page.locator('main').innerText()).not.toMatch(/reasoning|chain.?of.?thought/i);

    // Keyboard: the deep link selects Decisions and focuses the card; Tab moves into its evidence links.
    await page.goto(`${url}#decision-3`);
    await expect(page.getByRole('tab', { name: 'Decisions (3)' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#decision-3')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('link', { name: /Policy — changes to auth endpoints need approval/ }),
    ).toBeFocused();

    const samples: number[] = [];
    for (let i = 0; i < 5; i++) {
      await page.goto('about:blank');
      await page.goto(url, { waitUntil: 'load' });
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review Agent — Review');
      samples.push(await measureLcp(page));
    }
    samples.sort((a, b) => a - b);
    console.log(`/agents/runs/{id} initial content ms: ${samples.join(', ')}`);
    expect(samples[samples.length - 1]!).toBeLessThanOrEqual(2_000);
  });
});
