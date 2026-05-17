// Auth helpers — log in via the JSON API (avoids racing the login UI in every
// test) and write the returned cookies into the Playwright context. After
// `loginAs(page, 'ADMIN')` the page is fully authenticated and can navigate
// directly to /dashboard, /ftc, etc.

import { expect } from '@playwright/test';
import { USERS } from './users.js';

/**
 * Authenticate the given browser context as a seeded user.
 * Returns the parsed login response (incl. accessToken + user).
 */
export async function loginAs(page, role) {
  const creds = USERS[role];
  if (!creds) throw new Error(`Unknown role: ${role}`);

  const res = await page.request.post('/api/auth/login', {
    data: { email: creds.email, password: creds.password },
  });
  expect(res.ok(), `login failed for ${role}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** UI-driven login — used by the auth spec to verify the actual login form. */
export async function loginViaForm(page, role) {
  const creds = USERS[role];
  await page.goto('/login');
  await page.getByLabel(/email address/i).fill(creds.email);
  await page.getByLabel(/^password$/i).fill(creds.password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
}

/** Log out by hitting the API; clears cookies. */
export async function logout(page) {
  await page.request.post('/api/auth/logout').catch(() => {});
  await page.context().clearCookies();
}
