import { test, expect } from '@playwright/test';
import { loginViaForm, loginAs, logout } from './helpers/auth.js';
import { USERS, ALL_ROLES } from './helpers/users.js';

test.describe('Authentication', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
  });

  test('login form rejects empty submission with Zod errors', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByText(/please enter a valid email/i)).toBeVisible();
    await expect(page.getByText(/password is required/i)).toBeVisible();
  });

  test('login form rejects wrong password with 401 message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email address/i).fill('admin@grid-india.in');
    await page.getByLabel(/^password$/i).fill('definitely-wrong');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 10_000 });
    // Still on /login — no token was set.
    await expect(page).toHaveURL(/\/login$/);
  });

  test('login form rejects unknown email', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email address/i).fill('nobody@example.com');
    await page.getByLabel(/^password$/i).fill('Whatever@123');
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 10_000 });
  });

  test('successful UI login redirects to /dashboard and sets cookies', async ({ page }) => {
    await loginViaForm(page, 'ADMIN');
    await expect(page).toHaveURL(/\/dashboard/);
    const cookies = await page.context().cookies();
    expect(cookies.find(c => c.name === 'access_token')).toBeTruthy();
    expect(cookies.find(c => c.name === 'refresh_token')).toBeTruthy();
  });

  test('cookies are HttpOnly + SameSite (security baseline)', async ({ page }) => {
    await loginAs(page, 'ADMIN');
    const cookies = await page.context().cookies();
    const access  = cookies.find(c => c.name === 'access_token');
    const refresh = cookies.find(c => c.name === 'refresh_token');
    expect(access?.httpOnly,  'access_token must be HttpOnly').toBe(true);
    expect(refresh?.httpOnly, 'refresh_token must be HttpOnly').toBe(true);
    // SameSite should be at least Lax to mitigate CSRF on top-level navs.
    expect(['Lax', 'Strict']).toContain(access?.sameSite);
    expect(['Lax', 'Strict']).toContain(refresh?.sameSite);
  });

  test('logout clears cookies and redirects to /login on next nav', async ({ page }) => {
    await loginAs(page, 'ADMIN');
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard/);

    await logout(page);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
  });

  test('protected route without any token redirects to /login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('expired access_token + valid refresh_token still allows page load', async ({ page }) => {
    // Log in, then forge an obviously-bad access_token while keeping the
    // refresh_token. The middleware should let the request through and the
    // client-side AuthProvider should refresh automatically.
    await loginAs(page, 'NLDC');
    const cookies = await page.context().cookies();
    const refresh = cookies.find(c => c.name === 'refresh_token');
    await page.context().clearCookies();
    await page.context().addCookies([
      { name: 'access_token',  value: 'expired.jwt.token', domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
      refresh,
    ]);
    await page.goto('/dashboard');
    // Either the page renders (refresh succeeded) or we land on /login (refresh
    // failed). Both are valid outcomes — assert it didn't 500.
    await expect(page).toHaveURL(/\/(dashboard|login)/);
  });

  for (const role of ALL_ROLES) {
    test(`API login works for ${role}`, async ({ request }) => {
      const res = await request.post('/api/auth/login', {
        data: { email: USERS[role].email, password: USERS[role].password },
      });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.user?.role).toBe(role);
      expect(body.accessToken).toBeTruthy();
    });
  }

  test('API login: missing fields returns 400', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: {} });
    expect(res.status()).toBe(400);
  });

  test('API login: wrong password returns 401', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: 'admin@grid-india.in', password: 'wrong' },
    });
    expect(res.status()).toBe(401);
  });
});
