import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth.js';

test.describe('Snapshots API + compare UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await loginAs(page, 'ADMIN');
  });

  test('GET /api/grid/snapshots returns a list', async ({ page }) => {
    const res = await page.request.get('/api/grid/snapshots');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    // Each entry has the documented shape
    if (json.data.length > 0) {
      const first = json.data[0];
      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('snapshotDate');
    }
  });

  test('GET /api/grid/snapshots?changesOnly=1 dedupes consecutive identical days', async ({ page }) => {
    const [all, only] = await Promise.all([
      page.request.get('/api/grid/snapshots').then(r => r.json()),
      page.request.get('/api/grid/snapshots?changesOnly=1').then(r => r.json()),
    ]);
    // changes-only must be <= full list
    expect(only.data.length).toBeLessThanOrEqual(all.data.length);
  });

  test('GET /api/grid/snapshots requires auth (401 without cookies)', async ({ request }) => {
    const res = await request.get('/api/grid/snapshots');
    expect(res.status()).toBe(401);
  });

  test('GET /api/grid/snapshots/compare returns t1/t2/t3 diff arrays', async ({ page }) => {
    const list = await page.request.get('/api/grid/snapshots').then(r => r.json());
    if (list.data.length < 2) {
      test.skip(true, 'Need at least 2 snapshots to compare');
    }
    const from = list.data[0].snapshotDate.slice(0, 10);
    const to   = list.data[list.data.length - 1].snapshotDate.slice(0, 10);
    const res  = await page.request.get(`/api/grid/snapshots/compare?from=${from}&to=${to}`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveProperty('t1');
    expect(json.data).toHaveProperty('t2');
    expect(json.data).toHaveProperty('t3');
  });

  test('Day-wise Changes tab: comparing same date shows an inline error or no rows', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /day-wise changes/i }).first().click();
    // Both selects are pre-populated; force them to the same date and click Compare
    const fromSel = page.locator('select').nth(0);
    const toSel   = page.locator('select').nth(1);
    const opts = await fromSel.locator('option').allTextContents();
    // Pick the first real option (skip placeholder)
    const same = opts.find(o => /\d/.test(o)) ?? '';
    if (!same) test.skip(true, 'No snapshot dates available');
    // The select values are ISO dates — Playwright can select by index after first.
    await fromSel.selectOption({ index: 1 });
    await toSel.selectOption({ index: 1 });
    await page.getByRole('button', { name: /compare/i }).click();
    await expect(page.getByText(/select two different dates/i)).toBeVisible({ timeout: 5_000 });
  });

  test('Snapshots POST is forbidden for RLDC users', async ({ browser }) => {
    const ctx = await browser.newContext();
    const p   = await ctx.newPage();
    await loginAs(p, 'NRLDC');
    const res = await p.request.post('/api/grid/snapshots', { data: {} });
    expect([401, 403]).toContain(res.status());
    await ctx.close();
  });
});
