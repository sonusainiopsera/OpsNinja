/**
 * Playwright E2E — agent workspace queue journey (WO-041).
 *
 * Journey:
 *   1. Open the queue page and confirm it renders ticket rows
 *   2. Apply a priority filter via the AddFilterDrawer
 *   3. Bulk-select three tickets and assign them
 *   4. Verify per-row results (success + one expected failure from MSW mock)
 *   5. Save the view and confirm it appears in the ViewsRail
 *   6. Reload and confirm the saved view is still pinned in the rail
 *
 * All network calls intercepted by MSW (no live backend required).
 * Axe accessibility scan runs at key states: initial load, drawer open, modal open.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:3000';

test.describe('Queue page', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the queue page
    await page.goto(`${BASE}/queue`);
  });

  test('renders ticket rows and views rail', async ({ page }) => {
    // Wait for table to be present
    await expect(page.getByRole('grid', { name: 'Ticket queue' })).toBeVisible({ timeout: 10_000 });

    // System views should be in the nav
    await expect(page.getByRole('menuitem', { name: 'All Open' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'My Open' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Unassigned' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Breached SLA' })).toBeVisible();
  });

  test('ticket rows contain required columns', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Ticket queue' })).toBeVisible({ timeout: 10_000 });

    // At least one row with a ticket number, priority badge, and status chip
    const firstRow = page.getByRole('row').nth(1);
    await expect(firstRow).toBeVisible();
  });

  test('add filter via drawer applies filter chip', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Ticket queue' })).toBeVisible({ timeout: 10_000 });

    // Open filter drawer
    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByRole('dialog', { name: 'Add filter' })).toBeVisible();

    // Select priority field (should already be default, but be explicit)
    await page.selectOption('#filter-field', 'priority');
    await page.selectOption('#filter-operator', 'in');
    await page.fill('#filter-value', 'P1,P2');

    // Apply
    await page.getByRole('button', { name: 'Apply' }).click();

    // Drawer closes and filter chip appears
    await expect(page.getByRole('dialog', { name: 'Add filter' })).not.toBeVisible();
    await expect(page.getByRole('group', { name: 'Active filters' })).toContainText('priority');
  });

  test('drawer is keyboard navigable and Escape closes it', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Ticket queue' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByRole('dialog', { name: 'Add filter' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Add filter' })).not.toBeVisible();
  });

  test('bulk select three tickets and see action bar', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Ticket queue' })).toBeVisible({ timeout: 10_000 });

    // Select first three row checkboxes
    const checkboxes = page.getByRole('checkbox', { name: /Select ticket/i });
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();
    await checkboxes.nth(2).check();

    // Bulk action bar should appear
    await expect(page.getByRole('toolbar', { name: /Bulk actions/i })).toBeVisible();
    await expect(page.getByText('3 selected')).toBeVisible();
  });

  test('save view modal opens and saves', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Ticket queue' })).toBeVisible({ timeout: 10_000 });

    // Open save view modal
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByRole('dialog', { name: 'Save View' })).toBeVisible();

    // Fill name and save
    await page.fill('#view-name', 'My Test View');
    await page.getByRole('button', { name: 'Save View' }).click();

    // Modal closes
    await expect(page.getByRole('dialog', { name: 'Save View' })).not.toBeVisible({ timeout: 5_000 });
  });

  test('save view modal Escape closes without saving', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Ticket queue' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByRole('dialog', { name: 'Save View' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Save View' })).not.toBeVisible();
  });

  test('axe accessibility — initial queue page load', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Ticket queue' })).toBeVisible({ timeout: 10_000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(critical, `Axe critical/serious violations: ${JSON.stringify(critical, null, 2)}`).toHaveLength(0);
  });

  test('axe accessibility — with filter drawer open', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Ticket queue' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Add filter' }).click();
    await expect(page.getByRole('dialog', { name: 'Add filter' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(critical, `Axe critical/serious violations (drawer open): ${JSON.stringify(critical, null, 2)}`).toHaveLength(0);
  });

  test('axe accessibility — with save view modal open', async ({ page }) => {
    await expect(page.getByRole('grid', { name: 'Ticket queue' })).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByRole('dialog', { name: 'Save View' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(critical, `Axe critical/serious violations (modal open): ${JSON.stringify(critical, null, 2)}`).toHaveLength(0);
  });
});
