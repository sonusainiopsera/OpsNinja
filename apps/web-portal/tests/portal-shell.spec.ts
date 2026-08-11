import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PORTAL_IDENTITY_SUCCESS = {
  principal: {
    id: 'user-001',
    name: 'Jane Customer',
    email: 'jane@acme.example.com',
    org: {
      id: 'org-001',
      name: 'Acme Corporation',
      logoUrl: null,
    },
  },
  pendingSurvey: null,
};

async function mockPortalIdentity(page: Page, response = PORTAL_IDENTITY_SUCCESS, status = 200) {
  await page.route('**/api/portal/v1/me', route =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status >= 400 ? { error: { code: 'ERR', message: 'Server error', traceId: 'trace-abc' } } : response),
    })
  );
}

test.describe('Portal Shell — keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockPortalIdentity(page);
    await page.goto('/tickets');
  });

  test('skip-to-content is the first focusable element', async ({ page }) => {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    expect(focused).toBe('skip-to-content');
  });

  test('portal tabs are keyboard-reachable', async ({ page }) => {
    // Tab past skip-to-content and header elements to reach portal tabs
    let found = false;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const testId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (testId === 'portal-tab-my-tickets') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test('user menu can be opened and closed with keyboard', async ({ page }) => {
    await page.locator('[data-testid="portal-user-menu-trigger"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="portal-user-menu"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="portal-user-menu"]')).not.toBeVisible();
  });
});

test.describe('Portal Shell — theme toggle', () => {
  test.beforeEach(async ({ page }) => {
    await mockPortalIdentity(page);
    await page.goto('/tickets');
  });

  test('theme toggle switches data-theme attribute on html element', async ({ page }) => {
    const initialTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );
    expect(initialTheme).toBe('light');

    await page.locator('[data-testid="theme-toggle"]').click();
    const newTheme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme')
    );
    expect(newTheme).toBe('dark');
  });

  test('theme preference is persisted in localStorage', async ({ page }) => {
    await page.locator('[data-testid="theme-toggle"]').click();
    const stored = await page.evaluate(() =>
      localStorage.getItem('opsninja.portal.theme')
    );
    expect(stored).toBe('dark');
  });
});

test.describe('Portal Shell — tab navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockPortalIdentity(page);
  });

  test('My Tickets tab is active on /tickets', async ({ page }) => {
    await page.goto('/tickets');
    const tab = page.locator('[data-testid="portal-tab-my-tickets"]');
    await expect(tab).toHaveAttribute('aria-current', 'page');
  });

  test('Submit Request tab is active on /submit', async ({ page }) => {
    await page.goto('/submit');
    const tab = page.locator('[data-testid="portal-tab-submit-request"]');
    await expect(tab).toHaveAttribute('aria-current', 'page');
  });

  test('Knowledge tab is active on /knowledge', async ({ page }) => {
    await page.goto('/knowledge');
    const tab = page.locator('[data-testid="portal-tab-knowledge"]');
    await expect(tab).toHaveAttribute('aria-current', 'page');
  });

  test('active tab is derived from URL not client state (persist across reload)', async ({ page }) => {
    await page.goto('/knowledge');
    await page.reload();
    const tab = page.locator('[data-testid="portal-tab-knowledge"]');
    await expect(tab).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('Portal Shell — identity failure', () => {
  test('renders error state on 500 without exposing stack trace', async ({ page }) => {
    await mockPortalIdentity(page, PORTAL_IDENTITY_SUCCESS, 500);
    await page.goto('/tickets');
    const errorBanner = page.locator('[data-testid="portal-identity-error"]');
    await expect(errorBanner).toBeVisible();
    // Must not expose raw stack traces or internal paths
    const text = await errorBanner.textContent();
    expect(text).not.toContain('at Object.');
    expect(text).not.toContain('node_modules');
  });

  test('footer remains visible even when identity fails', async ({ page }) => {
    await mockPortalIdentity(page, PORTAL_IDENTITY_SUCCESS, 500);
    await page.goto('/tickets');
    await expect(page.locator('[data-testid="portal-footer"]')).toBeVisible();
  });
});

test.describe('Portal Shell — security headers', () => {
  test('CSP header is present on a portal route', async ({ page }) => {
    const response = await page.goto('/tickets');
    const csp = response?.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  test('X-Content-Type-Options header is nosniff', async ({ page }) => {
    const response = await page.goto('/tickets');
    expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('Referrer-Policy header is present', async ({ page }) => {
    const response = await page.goto('/tickets');
    expect(response?.headers()['referrer-policy']).toBeDefined();
  });
});

test.describe('Portal Shell — accessibility (axe-core)', () => {
  test.beforeEach(async ({ page }) => {
    await mockPortalIdentity(page);
  });

  test('light theme at 1280px — zero critical or serious violations', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tickets');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const violations = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    );
    expect(violations).toHaveLength(0);
  });

  test('dark theme at 1280px — zero critical or serious violations', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/tickets');
    await page.locator('[data-testid="theme-toggle"]').click();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const violations = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    );
    expect(violations).toHaveLength(0);
  });

  test('light theme at 375px — zero critical or serious violations and no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/tickets');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const violations = results.violations.filter(v =>
      v.impact === 'critical' || v.impact === 'serious'
    );
    expect(violations).toHaveLength(0);

    const hasOverflow = await page.evaluate(() => {
      return document.body.scrollWidth > window.innerWidth;
    });
    expect(hasOverflow).toBe(false);
  });
});
