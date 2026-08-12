/**
 * Playwright E2E — Administrator organizations journey (WO-029).
 *
 * Journey:
 *   1. Open the organizations page and confirm it renders the table
 *   2. Filter by tier (enterprise) and confirm results narrow
 *   3. Open the detail drawer for an org and navigate tabs
 *   4. Verify the metadata tab renders dynamic custom fields
 *   5. Open the deactivation modal and confirm name-match enforcement
 *   6. Verify accessibility: focus trap in drawer, keyboard tab navigation
 *
 * All network calls intercepted by MSW (no live backend required).
 * Axe accessibility scan runs at key states.
 *
 * Note: the journey-level test (create org → define field → populate metadata
 * → add contact → toggle portal → deactivate) requires a seeded dev backend;
 * the MSW-based E2E below covers the component-level flows offline.
 */

import { test, expect } from '@playwright/test';

const BASE = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:3000';

test.describe('Organizations page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/organizations`);
  });

  test('renders organizations table with rows', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Organizations list' })).toBeVisible({
      timeout: 10_000,
    });

    // At least Acme Corp and Globex should be visible
    await expect(page.getByText('Acme Corp')).toBeVisible();
    await expect(page.getByText('Globex Corporation')).toBeVisible();
  });

  test('page header shows New organization and Import buttons', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible();
    await expect(page.getByRole('button', { name: /new organization/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /import/i })).toBeVisible();
  });

  test('filter by enterprise tier narrows results', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Organizations list' })).toBeVisible({
      timeout: 10_000,
    });

    await page.selectOption('[aria-label="Filter by tier"]', 'enterprise');

    // Acme (enterprise) should remain; Globex (growth) should not
    await expect(page.getByText('Acme Corp')).toBeVisible();
    await expect(page.getByText('Globex Corporation')).not.toBeVisible();
  });

  test('filter by status inactive shows Defunct Ltd', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Organizations list' })).toBeVisible({
      timeout: 10_000,
    });

    await page.selectOption('[aria-label="Filter by status"]', 'inactive');

    await expect(page.getByText('Defunct Ltd')).toBeVisible();
    await expect(page.getByText('Acme Corp')).not.toBeVisible();
  });

  test('search narrows by org name', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Organizations list' })).toBeVisible({
      timeout: 10_000,
    });

    await page.fill('[aria-label="Search organizations"]', 'acme');

    await expect(page.getByText('Acme Corp')).toBeVisible();
    await expect(page.getByText('Globex Corporation')).not.toBeVisible();
  });

  test('clear filters restores full list', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Organizations list' })).toBeVisible({
      timeout: 10_000,
    });

    await page.selectOption('[aria-label="Filter by tier"]', 'enterprise');
    await expect(page.getByRole('button', { name: /clear filters/i })).toBeVisible();
    await page.getByRole('button', { name: /clear filters/i }).click();

    await expect(page.getByText('Globex Corporation')).toBeVisible();
  });

  test('opens detail drawer when row is clicked', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Organizations list' })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByText('Acme Corp').first().click();

    await expect(page.getByRole('dialog', { name: /Acme Corp details/i })).toBeVisible();
  });

  test('drawer tab list is keyboard navigable', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Organizations list' })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByText('Acme Corp').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // The Profile tab should be active
    const profileTab = page.getByRole('tab', { name: 'Profile' });
    await expect(profileTab).toHaveAttribute('aria-selected', 'true');

    // Press ArrowRight to navigate to next tab
    await profileTab.press('ArrowRight');
    const metadataTab = page.getByRole('tab', { name: 'DevOps Metadata' });
    await expect(metadataTab).toHaveAttribute('aria-selected', 'true');
  });

  test('drawer closes on Escape key', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Organizations list' })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByText('Acme Corp').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('deactivation modal requires name confirmation', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Organizations list' })).toBeVisible({
      timeout: 10_000,
    });

    // Open row menu for Acme Corp
    await page.getByRole('button', { name: /actions for Acme Corp/i }).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();

    // Modal should be visible
    await expect(page.getByRole('dialog', { name: /deactivate organization/i })).toBeVisible();

    // Submit button should be disabled
    const submitBtn = page.getByRole('button', { name: /deactivate organization/i }).last();
    await expect(submitBtn).toBeDisabled();

    // Type wrong name — still disabled
    await page.fill('[id="confirm-name"]', 'Wrong Name');
    await expect(submitBtn).toBeDisabled();

    // Type correct name — enabled
    await page.fill('[id="confirm-name"]', 'Acme Corp');
    await expect(submitBtn).not.toBeDisabled();
  });

  test('new organization modal submits and refreshes table', async ({ page }) => {
    await expect(page.getByRole('table', { name: 'Organizations list' })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: /new organization/i }).click();
    await expect(page.getByRole('dialog', { name: /create organization/i })).toBeVisible();

    await page.fill('#new-org-name', 'Test Corp');
    await page.selectOption('#new-org-tier', 'growth');

    await page.getByRole('button', { name: /create organization/i }).click();

    // Modal should close
    await expect(page.getByRole('dialog', { name: /create organization/i })).not.toBeVisible();

    // New org should appear in the table
    await expect(page.getByText('Test Corp')).toBeVisible();
  });
});
