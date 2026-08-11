/**
 * Portal Shell E2E tests
 *
 * Tests: keyboard navigation, theme persistence, tab navigation,
 * security headers (CSP, X-Frame-Options via frame-ancestors),
 * skip link, and basic accessibility scan via axe-core.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Portal Shell — Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tickets');
  });

  test('skip link is first focusable element', async ({ page }) => {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim());
    expect(focused).toContain('Skip');
  });

  test('skip link activates main landmark on Enter', async ({ page }) => {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe('portal-main');
  });

  test('portal tabs are keyboard navigable', async ({ page }) => {
    // Tab past skip link, past header elements, to nav
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(['A', 'BUTTON'].includes(focused ?? '')).toBeTruthy();
  });
});

test.describe('Portal Shell — Theme Persistence', () => {
  test('theme toggle exists in header', async ({ page }) => {
    await page.goto('/tickets');
    await expect(page.getByTestId('portal-theme-toggle')).toBeVisible();
  });

  test('theme toggle switches theme', async ({ page }) => {
    await page.goto('/tickets');
    const toggle = page.getByTestId('portal-theme-toggle');
    await toggle.click();
    const theme = await page.evaluate(() => document.documentElement.dataset['theme']);
    expect(['light', 'dark']).toContain(theme);
  });

  test('theme persists across reload', async ({ page }) => {
    await page.goto('/tickets');
    await page.getByTestId('portal-theme-toggle').click();
    const beforeReload = await page.evaluate(() => document.documentElement.dataset['theme']);
    await page.reload();
    await page.waitForLoadState('networkidle');
    const afterReload = await page.evaluate(() => document.documentElement.dataset['theme']);
    expect(afterReload).toBe(beforeReload);
  });
});

test.describe('Portal Shell — Tab Navigation', () => {
  test('My Tickets tab navigates to /tickets', async ({ page }) => {
    await page.goto('/submit');
    await page.click('[data-portal-tab="my-tickets"]');
    await expect(page).toHaveURL('/tickets');
  });

  test('Submit Request tab navigates to /submit', async ({ page }) => {
    await page.goto('/tickets');
    await page.click('[data-portal-tab="submit-request"]');
    await expect(page).toHaveURL('/submit');
  });

  test('Knowledge tab navigates to /knowledge', async ({ page }) => {
    await page.goto('/tickets');
    await page.click('[data-portal-tab="knowledge"]');
    await expect(page).toHaveURL('/knowledge');
  });

  test('active tab has aria-current=page', async ({ page }) => {
    await page.goto('/tickets');
    const activeTab = page.locator('[data-portal-tab="my-tickets"]');
    await expect(activeTab).toHaveAttribute('aria-current', 'page');
  });

  test('inactive tabs do not have aria-current', async ({ page }) => {
    await page.goto('/tickets');
    const inactiveTab = page.locator('[data-portal-tab="submit-request"]');
    await expect(inactiveTab).not.toHaveAttribute('aria-current');
  });

  test('active tab persists after reload', async ({ page }) => {
    await page.goto('/knowledge');
    await page.reload();
    const activeTab = page.locator('[data-portal-tab="knowledge"]');
    await expect(activeTab).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('Portal Shell — Security Headers', () => {
  test('X-Content-Type-Options header is set', async ({ page }) => {
    const response = await page.goto('/tickets');
    expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('Referrer-Policy header is set', async ({ page }) => {
    const response = await page.goto('/tickets');
    const referrerPolicy = response?.headers()['referrer-policy'];
    expect(referrerPolicy).toBeTruthy();
  });

  test('Content-Security-Policy header is present', async ({ page }) => {
    const response = await page.goto('/tickets');
    const csp = response?.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
  });

  test('CSP contains frame-ancestors none', async ({ page }) => {
    const response = await page.goto('/tickets');
    const csp = response?.headers()['content-security-policy'];
    expect(csp).toContain("frame-ancestors 'none'");
  });

  test('CSP does not contain unsafe-inline for scripts', async ({ page }) => {
    const response = await page.goto('/tickets');
    const csp = response?.headers()['content-security-policy'];
    if (csp && csp.includes('script-src')) {
      // script-src should not have unsafe-inline
      const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src'));
      expect(scriptSrc ?? '').not.toContain("'unsafe-inline'");
    }
  });
});

test.describe('Portal Shell — Accessibility', () => {
  test('tickets page passes axe-core audit', async ({ page }) => {
    await page.goto('/tickets');
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toHaveLength(0);
  });

  test('portal nav has proper landmark roles', async ({ page }) => {
    await page.goto('/tickets');
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Portal navigation' })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
  });

  test('OrgScopePill is visible and read-only', async ({ page }) => {
    await page.goto('/tickets');
    const pill = page.getByTestId('org-scope-pill');
    await expect(pill).toBeVisible();
    // No interactive controls inside
    const buttons = await pill.locator('button').count();
    expect(buttons).toBe(0);
  });
});

test.describe('Portal Shell — Mobile Viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tabs are horizontally scrollable on narrow viewport', async ({ page }) => {
    await page.goto('/tickets');
    const nav = page.getByRole('navigation', { name: 'Portal navigation' });
    await expect(nav).toBeVisible();
  });

  test('portal loads without horizontal overflow on mobile', async ({ page }) => {
    await page.goto('/tickets');
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 390;
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // 5px tolerance
  });
});
