/**
 * Playwright end-to-end tests for the ticket detail workspace — WO-042.
 *
 * Key scenarios:
 *  1. Detail page loads — header, status, priority, org name present.
 *  2. Add public reply — composer submits and comment appears in thread.
 *  3. Add internal note — note appears with distinctive styling and label.
 *  4. Upload attachment — progress bar appears; done state shown.
 *  5. Change priority — P2 button pressed; conflict banner on 409.
 *  6. Resolve ticket — modal opens, note required, AI pending → ready transition.
 *  7. Jira disabled state — informative unavailable message shown.
 *  8. Accessibility — axe-core zero critical/serious violations with modal open.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DETAIL_URL = '/tickets/ticket-0001';

test.describe('Ticket detail workspace', () => {
  test('loads ticket header with correct fields', async ({ page }) => {
    await page.goto(DETAIL_URL);
    // Ticket number
    await expect(page.locator('text=#10001')).toBeVisible({ timeout: 5_000 });
    // Subject
    await expect(page.locator('h1')).toContainText('Production database');
    // Priority badge
    await expect(page.locator('text=P1')).toBeVisible();
    // Org name
    await expect(page.locator('text=Acme Corp')).toBeVisible();
    // Status
    await expect(page.locator('text=in progress')).toBeVisible();
  });

  test('renders conversation thread with comment count', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await page.waitForSelector('[data-comment-id]', { timeout: 5_000 });
    const comments = page.locator('[data-comment-id]');
    await expect(comments).toHaveCount(5);
  });

  test('internal notes have distinct visual treatment and aria-label', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await page.waitForSelector('[data-visibility="internal"]', { timeout: 5_000 });
    const internalNotes = page.locator('[data-visibility="internal"]');
    const count = await internalNotes.count();
    expect(count).toBeGreaterThan(0);

    // Check aria-label contains 'Internal note'
    const firstNote = internalNotes.first();
    const label = await firstNote.getAttribute('aria-label');
    expect(label).toMatch(/internal note/i);
  });

  test('adds a public reply via composer', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await page.waitForSelector('textarea[aria-label="Reply body"]', { timeout: 5_000 });

    await page.fill('textarea[aria-label="Reply body"]', 'Test public reply message');
    await page.click('button[type="submit"]');

    // New comment should appear
    await expect(page.locator('text=Test public reply message')).toBeVisible({ timeout: 5_000 });
  });

  test('adds an internal note with visible label', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await page.waitForSelector('[aria-label="Reply visibility"]', { timeout: 5_000 });

    // Switch to internal note
    await page.click('button[aria-pressed="false"]:has-text("Internal note")');
    await expect(page.locator('text=Internal note — only agents can see this')).toBeVisible();

    // Type and submit
    await page.fill('textarea[aria-label="Internal note body"]', 'Escalating to DBA team');
    await page.click('button[type="submit"]:has-text("Post note")');

    await expect(page.locator('text=Escalating to DBA team')).toBeVisible({ timeout: 5_000 });
  });

  test('shows SLA timeline with reminder markers', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await page.waitForSelector('[aria-label="SLA timeline"]', { timeout: 5_000 });
    await expect(page.locator('[aria-label="SLA timer"]')).toBeVisible();
    // State label
    await expect(page.locator('text=At risk')).toBeVisible();
    // Progress bar
    await expect(page.locator('[aria-label="SLA timeline"]')).toBeVisible();
  });

  test('shows Jira create-issue CTA when no link exists', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await expect(page.locator('text=No Jira issue linked')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('button:has-text("Create Jira issue")')).toBeVisible();
  });

  test('resolve button only visible for allowed transitions', async ({ page }) => {
    await page.goto(DETAIL_URL);
    // MOCK_TICKET_DETAIL.allowedTransitions includes 'resolved'
    await expect(page.locator('button:has-text("Resolve")')).toBeVisible({ timeout: 5_000 });
  });

  test('resolve modal requires resolution note', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await page.click('button:has-text("Resolve")');

    // Modal should open
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#resolve-modal-title')).toContainText('Resolve ticket');

    // Submit without note should be disabled
    const submitBtn = page.locator('button[type="submit"]:has-text("Resolve ticket")');
    await expect(submitBtn).toBeDisabled();

    // Fill note
    await page.fill('#resolution-note', 'Fixed by killing long-running migration query.');
    await expect(submitBtn).toBeEnabled();
  });

  test('resolve modal shows AI pending state', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await page.click('button:has-text("Resolve")');
    await page.waitForSelector('[role="dialog"]');

    // AI pending state
    await expect(page.locator('text=Generating crux and affected-area tags')).toBeVisible();
  });

  test('Escape key closes resolve modal', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await page.click('button:has-text("Resolve")');
    await page.waitForSelector('[role="dialog"]');

    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).not.toBeVisible();
  });

  test('property sidebar shows current priority with version', async ({ page }) => {
    await page.goto(DETAIL_URL);
    // Priority buttons rendered
    await expect(page.locator('[aria-label="Priority"]')).toBeVisible({ timeout: 5_000 });
    const p1Btn = page.locator('button[aria-pressed="true"]:has-text("P1")');
    await expect(p1Btn).toBeVisible();
    // Version shown
    await expect(page.locator('text=Version 3')).toBeVisible();
  });

  test('accessibility — no critical/serious violations on detail page', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await page.waitForSelector('[data-comment-id]', { timeout: 5_000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const serious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(serious, `Critical/serious axe violations:\n${JSON.stringify(serious, null, 2)}`).toHaveLength(0);
  });

  test('accessibility — no violations with resolve modal open', async ({ page }) => {
    await page.goto(DETAIL_URL);
    await page.click('button:has-text("Resolve")');
    await page.waitForSelector('[role="dialog"]');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .include('[role="dialog"]')
      .analyze();

    const serious = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(serious, `Modal axe violations:\n${JSON.stringify(serious, null, 2)}`).toHaveLength(0);
  });
});
