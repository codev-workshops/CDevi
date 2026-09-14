import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe('Keyboard and accessible names (FR-029, SC-005, ui-inbox-screen.md §6)', () => {
  test('walk-through: Sign out → project → tab list → arrows → row → stub → back with focus restored', async ({
    page,
  }) => {
    await signIn(page, 'approver1@cdevi.demo');

    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el
          ? `${el.tagName.toLowerCase()}${el.getAttribute('role') ? `[${el.getAttribute('role')}]` : ''}:${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)}`
          : 'none';
      });

    // Tab through the shell until the Sign out button, then the project selector, then the tab list.
    const seen: string[] = [];
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const f = await focused();
      seen.push(f);
      if (f.startsWith('select')) break;
    }
    expect(seen.some((f) => f.includes('Sign out'))).toBeTruthy();
    expect(seen[seen.length - 1]).toMatch(/^select/);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tab', { name: /Needs you/ })).toBeFocused();

    // Arrow keys move and select; Home/End jump.
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /Running/ })).toBeFocused();
    await expect(page.getByRole('tab', { name: /Running/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: /Done/ })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: /Needs you/ })).toBeFocused();
    await expect(page.getByRole('tab', { name: /Needs you/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('list', { name: 'Needs you' })).not.toHaveAttribute(
      'aria-busy',
      'true',
    );

    // Into the panel and onto the first row link; Enter opens it.
    await page.keyboard.press('Tab'); // tabpanel
    await expect(page.getByRole('tabpanel')).toBeFocused();
    await page.keyboard.press('Tab'); // first row link
    const first = page
      .getByRole('list', { name: 'Needs you' })
      .getByRole('listitem')
      .first()
      .getByRole('link');
    await expect(first).toBeFocused();
    const focusRing = await first.evaluate(
      (el) =>
        getComputedStyle(el).outlineStyle !== 'none' || getComputedStyle(el).boxShadow !== 'none',
    );
    expect(focusRing).toBeTruthy();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/(approvals|workflows)\//);
    await page.getByRole('link', { name: 'Back to Inbox' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: /Needs you/ })).toBeFocused();
  });

  test('accessible names: nav count, tab counts, row link = title, ask via aria-describedby, badge ends with "risk"', async ({
    page,
  }) => {
    await signIn(page, 'admin@cdevi.demo');
    const needsYou = page.getByRole('tab', { name: /Needs you/ });
    const n = Number((await needsYou.textContent())!.replace(/\D/g, ''));
    await expect(
      page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('link', { name: `Inbox ${n} pending` }),
    ).toBeVisible();
    await expect(needsYou).toHaveAccessibleName(new RegExp(`Needs you\\s*${n}`));
    const row = page.getByRole('list', { name: 'Needs you' }).getByRole('listitem').first();
    const link = row.getByRole('link');
    await expect(link).toHaveText(/\S/);
    const describedBy = await row.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toContainText(
      /^(Approve|Question|Blocked|Failed|Waiting)/,
    );
    for (const t of await page.locator('.cd-risk').allTextContents()) expect(t).toMatch(/risk$/);
    const words = new Set(await page.locator('.cd-list .cd-pill').allTextContents());
    for (const w of words)
      expect([
        'needs you',
        'blocked',
        'failed',
        'stale',
        'expired',
        'recommended answer',
      ]).toContain(w);
  });

  test('no sticky or fixed page header (DR-05) and the layout reflows at narrower widths without hiding rows', async ({
    page,
  }) => {
    await signIn(page, 'admin@cdevi.demo');
    for (const sel of ['.cd-topbar', 'main', '.cd-tabs']) {
      const pos = await page
        .locator(sel)
        .first()
        .evaluate((el) => getComputedStyle(el).position);
      expect(pos, sel).not.toMatch(/sticky|fixed/);
    }
    for (const width of [1440, 1024, 640]) {
      await page.setViewportSize({ width, height: 900 });
      const rows = page.getByRole('list', { name: 'Needs you' }).getByRole('listitem');
      await expect(rows.first()).toBeVisible();
      await rows.first().getByRole('link').focus();
      await expect(rows.first().getByRole('link')).toBeFocused();
      await expect(page.getByLabel('Today')).toBeAttached();
    }
  });
});
