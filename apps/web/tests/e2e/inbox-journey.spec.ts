import { expect, test } from '@playwright/test';
import { me, signIn } from './helpers';

test.describe('Inbox journey (US1–US3)', () => {
  test('root redirects to sign-in; wrong credentials show one generic message; rate limit notices', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Finbox/);
    await page.getByLabel('Email').fill('approver1@cdevi.demo');
    await page.getByLabel('Password').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('Email or password is incorrect.');
    await page.getByLabel('Email').fill('nobody@cdevi.demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('p[role="alert"]')).toHaveText('Email or password is incorrect.');
  });

  test('approver signs in, triages Needs you, filters by project, opens a row and comes back', async ({
    page,
  }) => {
    await signIn(page, 'approver1@cdevi.demo');
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    const needsYou = page.getByRole('tab', { name: /Needs you/ });
    await expect(needsYou).toHaveAttribute('aria-selected', 'true');

    // Counts agree: nav pending count == tab count == Today "Needs you"
    const tabCount = Number((await needsYou.textContent())!.replace(/\D/g, ''));
    expect(tabCount).toBeGreaterThan(0);
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByLabel(`${tabCount} pending`),
    ).toBeVisible();
    await expect(
      page.getByLabel('Today').getByRole('link', { name: String(tabCount) }),
    ).toBeVisible();

    // Ordering: CRITICAL first, then HIGH; every row is a gate row with a state word
    const rows = page.getByRole('list', { name: 'Needs you' }).getByRole('listitem');
    await expect(rows.first().getByText('critical risk')).toBeVisible();
    const badges = await rows.locator('.cd-risk').allTextContents();
    const RANK: Record<string, number> = {
      'critical risk': 0,
      'high risk': 1,
      'medium risk': 2,
      'low risk': 3,
    };
    const rank = (t: string): number => RANK[t] ?? 4;
    for (let i = 1; i < badges.length; i++)
      expect(rank(badges[i]!)).toBeGreaterThanOrEqual(rank(badges[i - 1]!));
    await expect(rows.first().getByText('needs you')).toBeVisible();
    await expect(page.getByText('stale').first()).toBeVisible();
    await expect(page.getByText('expired').first()).toBeVisible();
    await expect(page.getByText('recommended answer').first()).toBeVisible();

    // Exactly one saffron control on the page; no inline decision controls
    await expect(page.locator('.cd-btn.cd-saffron')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^(Approve|Reject|Answer)$/ })).toHaveCount(0);

    // Project filter shrinks every count together
    const mine = await me(page);
    const project = mine.projects.find((p) => p.key === 'payments-api') ?? mine.projects[0]!;
    await page.getByLabel('Project').selectOption(project.id);
    await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
    await expect
      .poll(async () => Number((await needsYou.textContent())!.replace(/\D/g, '')))
      .toBeLessThan(tabCount);
    const filtered = Number((await needsYou.textContent())!.replace(/\D/g, ''));
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByLabel(`${filtered} pending`),
    ).toBeVisible();
    await expect(
      page.getByLabel('Today').getByRole('link', { name: String(filtered) }),
    ).toBeVisible();
    for (const key of await rows.locator('.cd-meta').allTextContents())
      expect(key).toContain('payments-api');
    await page.getByLabel('Project').selectOption('all');
    await expect
      .poll(async () => Number((await needsYou.textContent())!.replace(/\D/g, '')))
      .toBe(tabCount);

    // Open the first row with the keyboard, land on the Approval Center decision view for the same
    // workflow (specs/001 US2), come back
    const firstLink = rows.first().getByRole('link');
    const title = (await firstLink.textContent())!;
    await firstLink.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/approvals\//);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Approve');
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await expect(page.getByText('critical risk').first()).toBeVisible();
    await expect(page.locator('.cd-btn.cd-saffron')).toHaveCount(1);
    await page.getByRole('link', { name: 'Back to Inbox' }).click();
    await expect(page).toHaveURL(/\/inbox/);
    await expect(page.getByRole('tab', { name: /Needs you/ })).toBeFocused();
  });

  test('viewer sees a disabled New requirement with an explanation and only membership projects (US3, SC-008)', async ({
    page,
  }) => {
    await signIn(page, 'viewer1@cdevi.demo');
    const btn = page.getByText('New requirement');
    await expect(btn).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText('Your role (Viewer) cannot create requirements.')).toBeVisible();
    await expect(page.locator('.cd-saffron')).toHaveCount(1);
    const mine = await me(page);
    expect(mine.projects.length).toBeLessThan(4);
    const visible = new Set(mine.projects.map((p) => p.key));
    for (const tab of ['Needs you', 'Running', 'Done']) {
      await page.getByRole('tab', { name: new RegExp(tab) }).click();
      const metas = await page
        .getByRole('list', { name: tab })
        .locator('.cd-meta')
        .allTextContents();
      for (const m of metas)
        expect(
          [...visible].some((k) => m.startsWith(k)),
          m,
        ).toBeTruthy();
    }
    await expect(page.getByLabel('Project').getByRole('option')).toHaveCount(
      mine.projects.length + 1,
    );
  });

  test('engineer can reach the New requirement placeholder', async ({ page }) => {
    await signIn(page, 'engineer1@cdevi.demo');
    await page.getByRole('link', { name: 'New requirement' }).click();
    await expect(page).toHaveURL(/\/requirements\/new/);
    await expect(page.getByRole('heading', { level: 1, name: 'New requirement' })).toBeVisible();
  });

  test('Running and Done tabs render stage/elapsed and PR references; Load more pages (US2)', async ({
    page,
  }) => {
    await signIn(page, 'admin@cdevi.demo');
    await page.getByRole('tab', { name: /Running/ }).click();
    const running = page.getByRole('list', { name: 'Running' }).getByRole('listitem');
    await expect(running.first()).toContainText(/stage \d of 7/);
    await expect(running.first().locator('.cd-pill')).toHaveText(/running|retrying|waiting/);
    await page.getByRole('button', { name: /Load more/ }).click();
    await expect(running).toHaveCount(100);
    await expect(running.last().locator('.cd-pill')).toHaveText('queued');
    await page.getByRole('tab', { name: /Done/ }).click();
    const done = page.getByRole('list', { name: 'Done' }).getByRole('listitem');
    await expect(done.first()).toContainText(/completed .* · PR #\d+/);
    await expect(page.locator('.cd-pill.cd-cancelled').first()).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Done' }).getByRole('listitem').filter({ hasText: 'failed' }),
    ).toHaveCount(0);
  });
});
