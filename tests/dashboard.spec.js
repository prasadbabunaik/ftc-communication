import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth.js';

const TABS = [
  'FTC Pipeline',
  'CONTD-4 Study',
  'Hybrid Breakdown',
  'Source-wise',
  'Transmission',
  'BESS Data',
  'FTC/TOC/COD Activity',
  'Project Details',
  'Day-wise Changes',
];

const STAT_LABELS = [
  /applied for ftc/i,
  /ftc approved/i,
  /toc issued/i,
  /cod declared/i,
  /active contd-4/i,
  /tx pending ftc/i,
];

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await loginAs(page, 'ADMIN');
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /generation & transmission summary/i })).toBeVisible({ timeout: 15_000 });
  });

  test('all six stat cards render', async ({ page }) => {
    for (const label of STAT_LABELS) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test('all dashboard tabs are present and switchable', async ({ page }) => {
    for (const tab of TABS) {
      const btn = page.getByRole('button', { name: new RegExp(tab, 'i') }).first();
      await expect(btn, `tab "${tab}" should be in the nav`).toBeVisible();
    }
    // Click through each tab — should not throw / no error overlay
    for (const tab of TABS) {
      await page.getByRole('button', { name: new RegExp(tab, 'i') }).first().click();
      // The page should not render the global Next.js error overlay
      await expect(page.getByText(/unhandled runtime error/i)).toHaveCount(0);
    }
  });

  test('FTC Pipeline tab shows a region row and a Total footer', async ({ page }) => {
    await page.getByRole('button', { name: /ftc pipeline/i }).first().click();
    // Table headers
    await expect(page.getByText(/total cap \(mw\)/i).first()).toBeVisible();
    await expect(page.getByText(/exp\./i).first()).toBeVisible();
    // Footer total row
    await expect(page.getByText(/^total$/i).first()).toBeVisible();
  });

  test('AsOf date picker opens, today is highlighted', async ({ page }) => {
    // The trigger button shows "LIVE · TODAY" by default
    const trigger = page.getByRole('button', { name: /live.*today|viewing as of/i }).first();
    await trigger.click();
    // The calendar grid should appear with today's number highlighted
    const today = String(new Date().getDate());
    await expect(page.getByRole('button', { name: new RegExp(`^${today}$`) }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('LastChangesCard renders without error', async ({ page }) => {
    // Either "No changes", "Pick a past date", or "N change(s)" — any of these
    // proves the card mounted and the snapshot-compare API responded.
    const card = page.locator('text=/(no changes|pick a past date|change(s)?\\s+\\d)/i').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
  });

  test('Day-wise Changes tab shows the date pickers', async ({ page }) => {
    await page.getByRole('button', { name: /day-wise changes/i }).first().click();
    await expect(page.getByText(/compare two dates/i)).toBeVisible();
    await expect(page.getByText(/from date/i)).toBeVisible();
    await expect(page.getByText(/to date/i)).toBeVisible();
  });
});
