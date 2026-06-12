// Smoke-level coverage for the main feature pages: FTC tracker, CONTD-4,
// Transmission, Generation, Hybrid FTC, Import. These tests verify that each
// page renders for an authenticated user without server errors, and that
// the core scaffolding (heading + table or empty-state) is present.
//
// CRUD-level tests (create/edit/delete) are deliberately NOT in this file —
// they need controllable test data and would mutate the dev DB. Layer those
// on top by using a transactional fixture or a dedicated test DB.

import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth.js';

const PAGES = [
  { path: '/ftc',          heading: /ftc|first time charging|cleared|tracker/i },
  { path: '/hybrid-ftc',   heading: /hybrid/i },
  { path: '/contd4',       heading: /contd-?4|application/i },
  { path: '/transmission', heading: /transmission|element/i },
  { path: '/generation',   heading: /generation|project/i },
  { path: '/import',       heading: /import|excel|wizard|upload/i },
];

test.describe('Feature pages — smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await loginAs(page, 'ADMIN');
  });

  for (const { path, heading } of PAGES) {
    test(`GET ${path} renders without error`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), `${path} returned ${res?.status()}`).toBeLessThan(400);
      // No Next.js error overlay
      await expect(page.getByText(/unhandled runtime error|application error/i)).toHaveCount(0);
      // Some recognisable copy on the page. Filter to visible matches — the
      // first DOM match can be hidden text (e.g. collapsed sidebar labels).
      await expect(page.getByText(heading).filter({ visible: true }).first()).toBeVisible({ timeout: 15_000 });
    });
  }

  // CSS and text engines can't be mixed inside one selector string — combine
  // the two alternatives with locator.or() instead.
  test('FTC page renders a table or an empty state', async ({ page }) => {
    await page.goto('/ftc');
    const tableOrEmpty = page.locator('table').or(page.getByText(/no data|empty|no projects/i)).first();
    await expect(tableOrEmpty).toBeVisible({ timeout: 15_000 });
  });

  test('CONTD-4 page renders a table or empty state', async ({ page }) => {
    await page.goto('/contd4');
    const tableOrEmpty = page.locator('table').or(page.getByText(/no data|empty|no applications/i)).first();
    await expect(tableOrEmpty).toBeVisible({ timeout: 15_000 });
  });

  test('Transmission page renders a table or empty state', async ({ page }) => {
    await page.goto('/transmission');
    const tableOrEmpty = page.locator('table').or(page.getByText(/no data|empty|no elements/i)).first();
    await expect(tableOrEmpty).toBeVisible({ timeout: 15_000 });
  });

  test('Generation list links to a project detail page', async ({ page }) => {
    await page.goto('/generation');
    // Find the first project row link if any exist
    const firstLink = page.locator('a[href^="/generation/"]').first();
    if (await firstLink.count() === 0) {
      test.info().annotations.push({ type: 'skip-reason', description: 'No generation projects seeded' });
      return;
    }
    const href = await firstLink.getAttribute('href');
    expect(href).toMatch(/^\/generation\/.+/);
    const res = await page.goto(href);
    expect(res?.status()).toBeLessThan(400);
    await expect(page.getByText(/unhandled runtime error/i)).toHaveCount(0);
  });
});

test.describe('Print view', () => {
  test('printable summary renders for admin', async ({ page }) => {
    await loginAs(page, 'ADMIN');
    const res = await page.goto('/dashboard/print');
    expect(res?.status()).toBeLessThan(400);
    await expect(page.locator('table, h1, h2').first()).toBeVisible({ timeout: 15_000 });
  });
});
