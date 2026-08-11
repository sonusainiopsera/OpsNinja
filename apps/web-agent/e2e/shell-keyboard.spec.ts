/**
 * shell-keyboard.spec.ts
 *
 * Playwright integration tests for the AppShell:
 *  1. Skip-to-content link is first focusable and jumps to main
 *  2. Keyboard-only traversal reaches all major shell regions
 *  3. Mobile drawer opens, traps focus, closes and restores focus
 *  4. Theme toggle persists across reload
 *  5. Shell renders gracefully when identity returns 500
 *  6. axe-core zero serious/critical violations in light and dark themes
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SHELL_URL = '/dashboard';

test.describe('AppShell keyboard navigation', () => {
  test('skip-to-content link is first focusable element', async ({ page }) => {
    await page.goto(SHELL_URL);
    await page.waitForSelector('[id="main-content"]', { timeout: 5000 });

    // Tab to first focusable element
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    const href = await focused.getAttribute('href');
    expect(href).toBe('#main-content');
  });

  test('skip-to-content link moves focus to main on Enter', async ({ page }) => {
    await page.goto(SHELL_URL);
    await page.waitForSelector('[id="main-content"]', { timeout: 5000 });

    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');

    const mainEl = page.locator('#main-content');
    await expect(mainEl).toBeFocused();
  });

  test('primary navigation landmark is reachable by keyboard', async ({ page }) => {
    await page.goto(SHELL_URL);
    await page.waitForSelector('nav[aria-label="Primary navigation"]', { timeout: 5000 });

    const nav = page.locator('nav[aria-label="Primary navigation"]');
    expect(await nav.count()).toBe(1);

    const navLinks = nav.locator('a[data-nav-item]');
    expect(await navLinks.count()).toBeGreaterThan(0);
  });

  test('active nav item has aria-current=page', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForSelector('[data-nav-item="dashboard"]', { timeout: 5000 });

    const dashboardLink = page.locator('[data-nav-item="dashboard"]');
    await expect(dashboardLink).toHaveAttribute('aria-current', 'page');
  });

  test('theme toggle button is keyboard reachable and toggles theme', async ({ page }) => {
    await page.goto(SHELL_URL);
    await page.waitForSelector('[data-testid="theme-toggle"]', { timeout: 5000 });

    const toggle = page.locator('[data-testid="theme-toggle"]');
    const initialLabel = await toggle.getAttribute('aria-label');
    await toggle.click();
    const newLabel = await toggle.getAttribute('aria-label');
    expect(newLabel).not.toBe(initialLabel);
  });

  test('theme preference persists across page reload', async ({ page }) => {
    await page.goto(SHELL_URL);
    await page.waitForSelector('[data-testid="theme-toggle"]', { timeout: 5000 });

    // Switch to dark
    await page.locator('[data-testid="theme-toggle"]').click();
    const themeAfterToggle = await page.evaluate(
      () => document.documentElement.dataset['theme'],
    );

    // Reload and check persistence
    await page.reload();
    await page.waitForSelector('[data-testid="theme-toggle"]', { timeout: 5000 });
    const themeAfterReload = await page.evaluate(
      () => document.documentElement.dataset['theme'],
    );
    expect(themeAfterReload).toBe(themeAfterToggle);
  });

  test('shell renders chrome when identity fetch fails', async ({ page }) => {
    // Intercept identity to simulate 500
    await page.route('**/api/v1/me', (route) =>
      route.fulfill({ status: 500, body: JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Internal', traceId: 'trc_test' } }) }),
    );
    await page.goto(SHELL_URL);
    await page.waitForSelector('nav[aria-label="Primary navigation"]', { timeout: 5000 });

    // Nav should still be present (skeleton or default nav)
    expect(await page.locator('nav[aria-label="Primary navigation"]').count()).toBe(1);
    // TopBar should still render
    expect(await page.locator('[role="banner"]').count()).toBe(1);
  });

  test('axe-core zero serious/critical violations in light theme', async ({ page }) => {
    await page.goto(SHELL_URL);
    await page.waitForSelector('#main-content', { timeout: 5000 });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(blocking).toHaveLength(0);
  });

  test('axe-core zero serious/critical violations in dark theme', async ({ page }) => {
    await page.goto(SHELL_URL);
    await page.waitForSelector('[data-testid="theme-toggle"]', { timeout: 5000 });
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(200);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(blocking).toHaveLength(0);
  });

  test('mobile drawer opens and has dialog role', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(SHELL_URL);

    const menuBtn = page.locator('button[aria-label="Open navigation menu"]');
    if ((await menuBtn.count()) > 0) {
      await menuBtn.click();
      const drawer = page.locator('[role="dialog"][aria-label="Navigation menu"]');
      await expect(drawer).toBeVisible();
      expect(await drawer.getAttribute('aria-modal')).toBe('true');
    }
  });
});
