// Real browser walkthrough against a running instance (reCAPTCHA off).
// One login per run (the login route rate-limits per account, 10/10min).
// Run: E2E_BASE_URL=http://localhost:3100 npx playwright test tests/e2e-crud.spec.js
import { test, expect } from '@playwright/test';
import { loginAs } from './helpers/auth.js';

const TEST_NAME = '__PW_TEST_STATION__';

async function login(page) {
  // single retry guards the rare same-second refreshToken collision (P2002)
  try { await loginAs(page, 'ADMIN'); }
  catch { await page.waitForTimeout(1500); await loginAs(page, 'ADMIN'); }
}

test('browser walkthrough: render + create + add + edit + delete FTC event', async ({ page }) => {
  test.setTimeout(90_000);
  await login(page);

  // ── 1. Pages render with real data ──────────────────────────────────
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: /Generation .* Transmission Summary/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Applied for FTC/i).first()).toBeVisible();

  await page.goto('/ftc');
  await expect(page.getByRole('button', { name: /Add Source \/ Component/i })).toBeVisible({ timeout: 15000 });
  await expect(page.locator('table tbody tr').first()).toBeVisible();

  await page.goto('/transmission');
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15000 });

  // ── 2. Create a brand-new station via the inline create form ────────
  await page.goto('/ftc');
  await page.getByRole('button', { name: /Add Source \/ Component/i }).click();
  const createLink = page.getByRole('button', { name: /Create a new generating station/i });
  await expect(createLink).toBeVisible({ timeout: 10000 });
  await createLink.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(/Create New Generating Station/i)).toBeVisible();

  // station name (creatable combobox)
  await dialog.getByRole('button', { name: /Search the station master list/i }).click();
  await page.getByPlaceholder(/Type a station name/i).fill(TEST_NAME);
  await page.getByText(new RegExp(`Add\\s*[“"]?${TEST_NAME}`, 'i')).first().click();

  // region (first <select> inside the dialog)
  const region = dialog.locator('select').first();
  const labels = await region.locator('option').allTextContents();
  await region.selectOption({ index: labels.findIndex(o => /\bNR\b/.test(o)) });

  // plant type + capacity
  await dialog.getByRole('button', { name: /^Solar$/ }).click();
  await dialog.getByLabel(/Total Capacity/i).fill('40');

  // submit
  await dialog.getByRole('button', { name: /Create Project/i }).click();
  // success ⇒ create button gone, compact bar shows the new project
  await expect(dialog.getByRole('button', { name: /Create Project/i })).toHaveCount(0, { timeout: 20000 });
  await expect(dialog.getByText(/40\.0 MW/).first()).toBeVisible({ timeout: 10000 });

  // ── 3. Add an FTC milestone event (MW + date) ───────────────────────
  // The lane needs Capacity Applied set first (FTC ≤ Applied invariant, else
  // the Save button stays disabled).
  await dialog.getByText(/Capacity Applied \(MW\)/i).locator('xpath=following::input[1]').fill('40');
  await dialog.getByRole('button', { name: /Add FTC Completed Event/i }).click();
  await dialog.getByPlaceholder('e.g. 66.66').first().fill('30');
  await dialog.getByRole('button', { name: /Pick a date/i }).last().click();
  await page.getByRole('button', { name: '15', exact: true }).click();
  await dialog.getByRole('button', { name: /^Save( Changes)?$/ }).click();
  // Wait for the save to commit (modal closes on success) before navigating —
  // otherwise goto('/ftc') can race ahead of the server action and render stale.
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15000 });

  // ── 4. Verify the new station now shows in the FTC pipeline table ────
  // Table is paginated + capacity-sorted, so a 40 MW station lands on a later
  // page — search for it instead of scanning page 1.
  await page.goto('/ftc');
  await page.getByPlaceholder(/Search station/i).fill(TEST_NAME);
  const row = () => page.locator('table tbody tr').filter({ hasText: TEST_NAME }).first();
  await expect(row()).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: '/tmp/pw-in-table.png' });

  // ── 5. EDIT the FTC event (30 → 25 MW) via detail → edit form ────────
  await row().click();
  let detail = page.getByRole('dialog');
  await detail.getByRole('button', { name: /Add Source \/ Component/i }).click();
  const mwInput = detail.getByPlaceholder('e.g. 66.66').first();
  await expect(mwInput).toHaveValue('30');               // pre-filled from the saved event
  await mwInput.fill('25');
  await detail.getByRole('button', { name: /^Save( Changes)?$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15000 });
  // the edited value is reflected in the FTC "Approved" column for this row
  await page.getByPlaceholder(/Search station/i).fill(TEST_NAME);
  await expect(row()).toContainText('25.0', { timeout: 15000 });

  // ── 6. DELETE the FTC event via the trash control, then Save ─────────
  await row().click();
  detail = page.getByRole('dialog');
  await detail.getByRole('button', { name: /Add Source \/ Component/i }).click();
  await detail.locator('button:has(.lucide-trash-2)').first().click();
  await detail.getByRole('button', { name: /^Save( Changes)?$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15000 });
});
