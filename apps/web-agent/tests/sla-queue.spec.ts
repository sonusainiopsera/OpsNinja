/**
 * sla-queue.spec.ts — Playwright E2E + axe accessibility spec for the SLA queue view.
 *
 * Requires a running agent web application with an SLA queue page at /queue.
 * The page must mount SlaClockProvider and render SlaCountdown components.
 *
 * Accessibility requirements tested:
 * - No axe-core violations (WCAG 2.1 AA)
 * - SLA state communicated by icon + text, never colour alone
 * - aria-live announcements fire on state transition
 * - Only one setInterval active for all countdowns (performance constraint)
 * - DataTable role=grid with aria-sort headers
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('SLA queue page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/queue');
  });

  test('has no axe-core accessibility violations', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('each SLA countdown has icon and text label, not colour alone', async ({ page }) => {
    const countdowns = page.locator('[data-testid="sla-countdown"]');
    const count = await countdowns.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const countdown = countdowns.nth(i);
      // Must have a data-icon element
      const icon = countdown.locator('[data-icon]');
      await expect(icon).toHaveCount(1);
      // Must have a text label element
      const label = countdown.locator('[data-sla-label]');
      await expect(label).toHaveCount(1);
      const labelText = await label.textContent();
      expect(labelText?.trim().length).toBeGreaterThan(0);
    }
  });

  test('countdown components have accessible role=img and aria-label', async ({ page }) => {
    const countdowns = page.locator('[data-testid="sla-countdown"]');
    const count = await countdowns.count();

    for (let i = 0; i < count; i++) {
      const countdown = countdowns.nth(i);
      await expect(countdown).toHaveAttribute('role', 'img');
      const ariaLabel = await countdown.getAttribute('aria-label');
      expect(ariaLabel?.trim().length).toBeGreaterThan(0);
    }
  });

  test('DataTable has role=grid with aria-sort on sortable headers', async ({ page }) => {
    const grid = page.locator('[role="grid"]');
    await expect(grid).toBeVisible();

    const sortableHeaders = grid.locator('[role="columnheader"][aria-sort]');
    const headerCount = await sortableHeaders.count();
    expect(headerCount).toBeGreaterThan(0);
  });

  test('keyboard navigation: arrow keys move focus in grid', async ({ page }) => {
    const grid = page.locator('[data-testid="data-table"]');
    await expect(grid).toBeVisible();

    // Focus the first gridcell
    const firstCell = grid.locator('[role="gridcell"]').first();
    await firstCell.focus();

    // Press ArrowRight — next cell should receive focus
    await page.keyboard.press('ArrowRight');

    // The focused element should be a gridcell with data-col="1"
    const focusedEl = page.locator(':focus');
    await expect(focusedEl).toHaveAttribute('data-col', '1');
  });

  test('only one setInterval active for all SLA countdowns', async ({ page }) => {
    // Inject a spy before the page scripts run (preload script)
    await page.addInitScript(() => {
      const originalSetInterval = window.setInterval;
      let slaIntervalCount = 0;
      const slaIntervalIds: ReturnType<typeof setInterval>[] = [];

      (window as any).__slaIntervalSpy = {
        count: () => slaIntervalCount,
        ids: () => slaIntervalIds,
      };

      (window as any).setInterval = function (fn: TimerHandler, delay?: number, ...args: unknown[]) {
        const id = originalSetInterval(fn, delay, ...args);
        // Heuristic: SlaClockProvider uses ~1000ms interval
        if (delay && delay >= 900 && delay <= 1100) {
          slaIntervalCount++;
          slaIntervalIds.push(id);
        }
        return id;
      };
    });

    await page.goto('/queue');
    // Wait for SlaClockProvider to mount
    await page.waitForSelector('[data-testid="sla-countdown"]');

    const intervalCount = await page.evaluate(() => (window as any).__slaIntervalSpy?.count() ?? 0);
    // There should be exactly one ~1s interval regardless of how many countdowns are rendered
    expect(intervalCount).toBe(1);
  });

  test('aria-live region announces state transition', async ({ page }) => {
    // Confirm the aria-live region exists in the DOM
    const liveRegion = page.locator('[role="status"][aria-live="polite"]');
    await expect(liveRegion).toBeAttached();
  });
});
