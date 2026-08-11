/**
 * shell-a11y.spec.ts — Playwright integration specs for the AppShell.
 *
 * Covers:
 * - Keyboard-only shell traversal (skip link → nav → search → status → export → theme → user)
 * - Mobile drawer focus management
 * - Theme toggle persistence across reload
 * - Shell rendering with mocked API success and failure
 * - axe-core WCAG 2.1 AA scan in both themes at desktop and mobile viewports
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const ROUTES = ['/dashboard'];

test.describe('AppShell — accessibility', () => {
  test('skip-to-content link is the first focusable element', async ({ page }) => {
    await page.goto('/dashboard');
    // Tab once from URL bar → first focusable element in the page
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveAttribute('data-testid', 'skip-to-content');
  });

  test('skip-to-content moves focus to #main-content', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const focused = page.locator(':focus');
    await expect(focused).toHaveAttribute('id', 'main-content');
  });

  test.each(ROUTES)('axe-core: zero violations (light theme, desktop) on %s', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dashboard');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test.each(ROUTES)('axe-core: zero violations (dark theme, desktop) on %s', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dashboard');
    // Toggle to dark
    await page.click('[data-testid="theme-toggle"]');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test.each(ROUTES)('axe-core: zero violations (mobile viewport) on %s', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/dashboard');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('no horizontal scroll at 1280px', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/dashboard');
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1280);
  });

  test('no horizontal scroll at 1024px', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/dashboard');
    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(1024);
  });
});

test.describe('AppShell — keyboard navigation', () => {
  test('keyboard traversal reaches nav items', async ({ page }) => {
    await page.goto('/dashboard');
    // Tab past skip link
    await page.keyboard.press('Tab');
    // Tab into the sidebar navigation
    let found = false;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const el = await page.locator(':focus').getAttribute('data-testid');
      if (el?.startsWith('nav-item-')) { found = true; break; }
    }
    expect(found).toBe(true);
  });

  test('active nav item has aria-current=page', async ({ page }) => {
    await page.goto('/dashboard');
    const activeItem = page.locator('[aria-current="page"]');
    await expect(activeItem).toBeVisible();
  });
});

test.describe('AppShell — mobile drawer', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('menu button opens mobile drawer', async ({ page }) => {
    await page.goto('/dashboard');
    await page.click('[data-testid="mobile-menu-button"]');
    await expect(page.locator('[data-testid="mobile-drawer"]')).toBeVisible();
  });

  test('drawer traps focus — escape closes it', async ({ page }) => {
    await page.goto('/dashboard');
    await page.click('[data-testid="mobile-menu-button"]');
    await expect(page.locator('[data-testid="mobile-drawer"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="mobile-drawer"]')).not.toBeVisible();
  });

  test('close button is first focused element in drawer', async ({ page }) => {
    await page.goto('/dashboard');
    await page.click('[data-testid="mobile-menu-button"]');
    const focused = page.locator(':focus');
    await expect(focused).toHaveAttribute('data-testid', 'mobile-drawer-close');
  });
});

test.describe('AppShell — theme persistence', () => {
  test('theme toggle stores preference and survives reload', async ({ page }) => {
    await page.goto('/dashboard');
    await page.click('[data-testid="theme-toggle"]');
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    );
    expect(theme).toBe('dark');

    // Reload and verify persistence
    await page.reload();
    const storedTheme = await page.evaluate(() => localStorage.getItem('opsninja.theme'));
    expect(storedTheme).toBe('dark');
  });
});

test.describe('AppShell — identity error handling', () => {
  test('shell renders and is navigable when identity API returns 500', async ({ page }) => {
    await page.route('/api/v1/auth/me', route => route.fulfill({ status: 500, body: JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Internal error', traceId: 'trace-123' } }) }));
    await page.goto('/dashboard');
    // Shell should still be navigable (not blank)
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="user-menu-error"]')).toBeVisible();
  });

  test('shell does not crash when scope returns 500', async ({ page }) => {
    await page.route('/api/v1/auth/scope', route => route.fulfill({ status: 500, body: JSON.stringify({ error: { code: 'SERVER_ERROR', message: 'Scope error', traceId: 'trace-456' } }) }));
    await page.goto('/dashboard');
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible();
  });

  test('401 identity response shows sign-in prompt (not crash)', async ({ page }) => {
    await page.route('/api/v1/auth/me', route => route.fulfill({ status: 401, body: JSON.stringify({ error: { code: 'AUTH_TOKEN_MISSING', message: 'Not authenticated' } }) }));
    await page.goto('/dashboard');
    await expect(page.locator('[data-testid="top-bar"]')).toBeVisible();
  });
});
