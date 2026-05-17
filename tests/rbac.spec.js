import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth.js';
import { USERS, RLDC_ROLES, READ_ALL_ROLES } from './helpers/users.js';

test.describe('RBAC — region scoping', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  // NLDC + ADMIN see "All India view" badge. RLDCs see "Showing your region".
  for (const role of READ_ALL_ROLES) {
    test(`${role} sees All India view label on dashboard`, async ({ page }) => {
      await loginAs(page, role);
      await page.goto('/dashboard');
      await expect(page.getByText(/all india view/i)).toBeVisible({ timeout: 15_000 });
    });
  }

  for (const role of RLDC_ROLES) {
    test(`${role} dashboard is scoped to their region (${USERS[role].region})`, async ({ page }) => {
      await loginAs(page, role);
      await page.goto('/dashboard');
      await expect(page.getByText(/showing your region/i)).toBeVisible({ timeout: 15_000 });
      // The user should not see the All India view label
      await expect(page.getByText(/all india view/i)).toHaveCount(0);
    });
  }

  // /dashboard/users page is admin-only — the page should either redirect
  // non-admins or render a "Forbidden / Unauthorized" message.
  test('non-admin cannot access /dashboard/users', async ({ page }) => {
    await loginAs(page, 'NRLDC');
    const res = await page.goto('/dashboard/users');
    // Acceptable outcomes: redirected away, 403 status, or visible "forbidden" copy.
    const url    = page.url();
    const status = res?.status();
    const body   = await page.content();
    const ok =
      /\/(login|dashboard\/?$)/.test(url) ||
      status === 403 ||
      /forbid|not auth|unauthor/i.test(body);
    expect(ok, `Expected non-admin to be blocked from /dashboard/users (url=${url} status=${status})`).toBeTruthy();
  });

  test('admin can access /dashboard/users', async ({ page }) => {
    await loginAs(page, 'ADMIN');
    const res = await page.goto('/dashboard/users');
    expect(res?.status()).toBeLessThan(400);
    // The url should still be /dashboard/users (no kick to /dashboard)
    expect(page.url()).toMatch(/\/dashboard\/users/);
  });
});
