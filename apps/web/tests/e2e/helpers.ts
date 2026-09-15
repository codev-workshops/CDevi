import AxeBuilder from '@axe-core/playwright';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { E2E } from '../../playwright.config';

export const API = `http://localhost:${E2E.apiPort}`;

export async function signIn(page: Page, email: string, password: string = E2E.password) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/inbox/);
}

export async function me(page: Page) {
  const res = await page.request.get(`/api/auth/me`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { projects: { id: string; key: string }[]; user: { role: string } };
}

let n = 0;
export const uniq = (p: string) => `${p}-${Date.now().toString(36)}-${(n++).toString(36)}`;

/** Ingests a workflow that immediately needs a human (CRITICAL approval) and returns its external id and title. */
export async function ingestNeedsYou(
  request: APIRequestContext,
  title: string,
  projectKey = 'payments-api',
) {
  const ext = uniq('e2e');
  const now = new Date(Date.now() + 60_000).toISOString(); // strictly newer than the fixed seed clock
  const headers = {
    authorization: `Bearer ${E2E.ingestToken}`,
    'content-type': 'application/json',
  };
  const w = await request.put(`${API}/api/ingest/workflows/${ext}`, {
    headers,
    data: {
      projectKey,
      title,
      agent: 'Implementation Agent',
      state: 'RUNNING',
      stage: { index: 6, count: 7, name: 'Review' },
      observedAt: now,
    },
  });
  expect(w.ok(), await w.text()).toBeTruthy();
  const a = await request.put(`${API}/api/ingest/approvals/${ext}-a`, {
    headers,
    data: {
      workflowExternalId: ext,
      ask: `Approve: merge \`${ext}\` into main`,
      riskLevel: 'CRITICAL',
      requestedAt: now,
      expiresAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
    },
  });
  expect(a.ok(), await a.text()).toBeTruthy();
  const t = await request.post(`${API}/api/ingest/workflows/${ext}/transitions`, {
    headers,
    data: {
      toState: 'WAITING_FOR_HUMAN',
      observedAt: new Date(Date.now() + 120_000).toISOString(),
    },
  });
  expect(t.ok(), await t.text()).toBeTruthy();
  return { ext, title, workflowId: (await w.json()).id as string };
}

export interface AnalysisInput {
  agent?: string;
  observedAt?: string;
  summary?: string | null;
  acceptanceCriteria?: string[];
  rules?: string[];
  openQuestions?: string[];
}

/** Simulates the agent runtime delivering a requirement analysis (US4 scope decision 1) and returns the ingest result. */
export async function ingestAnalysis(
  request: APIRequestContext,
  externalId: string,
  input: AnalysisInput = {},
) {
  const res = await request.put(`${API}/api/ingest/requirements/${externalId}/analysis`, {
    headers: {
      authorization: `Bearer ${E2E.ingestToken}`,
      'content-type': 'application/json',
    },
    data: {
      agent: input.agent ?? 'Requirement Agent',
      observedAt: input.observedAt ?? new Date(Date.now() + 60_000).toISOString(),
      summary: input.summary ?? null,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      rules: input.rules ?? [],
      openQuestions: input.openQuestions ?? [],
    },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()) as { outcome: 'accepted' | 'stale'; id: string; state: string };
}

/** Page-level axe scan (WCAG 2.2 AA); fails with every violation and its offending nodes listed. */
export async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.html).join(' | ')}`),
    label,
  ).toEqual([]);
}

/**
 * Largest Contentful Paint of the current document in ms (SC-003/SC-007). Falls back to the navigation
 * `responseEnd` when the browser has not reported an LCP entry within 300 ms.
 */
export function measureLcp(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let value = 0;
        const po = new PerformanceObserver((list) => {
          for (const e of list.getEntries()) value = e.startTime;
        });
        po.observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => {
          po.disconnect();
          const nav = performance.getEntriesByType('navigation')[0] as
            PerformanceNavigationTiming | undefined;
          resolve(Math.max(value, nav?.responseEnd ?? 0));
        }, 300);
      }),
  );
}
