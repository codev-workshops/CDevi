import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

async function expectAxeClean(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(
    results.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.html).join(' | ')}`),
    label,
  ).toEqual([]);
}

test.describe('Accessibility (SC-005): zero axe violations on every route and state', () => {
  test('sign-in, populated tabs, record stub, placeholders', async ({ page }) => {
    await page.goto('/sign-in');
    await expectAxeClean(page, '/sign-in');
    await signIn(page, 'admin@cdevi.demo');
    await expectAxeClean(page, '/inbox needsYou');
    await page.getByRole('tab', { name: /Running/ }).click();
    await expect(page.getByRole('list', { name: 'Running' })).toBeVisible();
    await expectAxeClean(page, '/inbox running');
    await page.getByRole('tab', { name: /Done/ }).click();
    await expect(page.getByRole('list', { name: 'Done' })).toBeVisible();
    await expectAxeClean(page, '/inbox done');
    await page.getByRole('tab', { name: /Needs you/ }).click();
    await page
      .getByRole('list', { name: 'Needs you' })
      .getByRole('listitem')
      .first()
      .getByRole('link')
      .click();
    await expect(page).toHaveURL(/\/approvals\//);
    await expectAxeClean(page, '/approvals/[id]');
    await page.goto('/policies');
    await expectAxeClean(page, '/policies');
    await page.goto('/requirements/new');
    await expectAxeClean(page, '/requirements/new');
  });

  test('empty, loading and error states', async ({ page }) => {
    await signIn(page, 'admin@cdevi.demo');
    // One interception with a switchable mode so routes are never double-handled.
    let mode: 'pass' | 'empty' | 'hold' | 'error' = 'pass';
    const gate: { release: (() => void) | null } = { release: null };
    await page.route('**/api/inbox?*', async (route) => {
      if (mode === 'empty') {
        const res = await route.fetch();
        const body = await res.json();
        return route.fulfill({
          response: res,
          json: {
            ...body,
            items: [],
            nextCursor: null,
            counts: { needsYou: 0, running: 0, done: 0 },
          },
        });
      }
      if (mode === 'hold') {
        await new Promise<void>((r) => (gate.release = r));
        return route.continue();
      }
      if (mode === 'error') {
        return route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'urn:cdevi:problem:internal',
            title: 'Something went wrong',
            status: 500,
          }),
        });
      }
      return route.continue();
    });

    mode = 'empty';
    await page.getByRole('tab', { name: /Running/ }).click();
    await expect(page.getByText('No workflows are running.')).toBeVisible();
    await expectAxeClean(page, 'running empty');
    await page.getByRole('tab', { name: /Needs you/ }).click();
    await expect(page.getByText(/Nothing needs you right now/)).toBeVisible();
    await expectAxeClean(page, 'needsYou empty');

    mode = 'hold';
    await page.getByRole('tab', { name: /Done/ }).click();
    await expect(page.locator('.cd-list[aria-busy="true"]')).toBeVisible();
    await expect(page.locator('.cd-skeleton').first()).toBeVisible();
    await expectAxeClean(page, 'loading');
    mode = 'pass';
    gate.release?.();
    await expect(page.getByRole('list', { name: 'Done' })).toBeVisible();

    mode = 'error';
    await page.getByRole('tab', { name: /Running/ }).click();
    const notice = page.locator('.cd-notice[role="alert"]');
    await expect(notice).toContainText("Couldn't load the Inbox.");
    await expectAxeClean(page, 'error');
    mode = 'pass';
    await notice.getByRole('button', { name: 'Retry' }).click();
    await expect(notice).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Running' })).toBeVisible();
  });

  test('viewports 1440 / 1024 / 640 stay clean', async ({ page }) => {
    await signIn(page, 'approver1@cdevi.demo');
    for (const width of [1440, 1024, 640]) {
      await page.setViewportSize({ width, height: 900 });
      await expectAxeClean(page, `width ${width}`);
    }
  });
});
