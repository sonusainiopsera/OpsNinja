/**
 * keyboard-navigation.spec.ts  @smoke @full
 *
 * Accessibility: automated axe-core rule scans on primary screens +
 * explicit keyboard-only navigation assertions.
 *
 * Screens covered:
 *   Agent:  ticket list, ticket detail, resolve modal
 *   Admin:  organizations drawer
 *   Portal: ticket submission form
 *
 * Assertions (contributes ~10 to smoke count):
 *   1.  Agent ticket list: zero critical/serious axe violations
 *   2.  Agent ticket list: skip-to-content link is first focusable element
 *   3.  Agent ticket list: tab traversal reaches all major nav items
 *   4.  Agent ticket detail: zero critical/serious axe violations
 *   5.  Agent ticket detail: resolve modal opens with keyboard (Enter)
 *   6.  Agent ticket detail: resolve modal traps focus (Tab cycle stays inside)
 *   7.  Agent ticket detail: Escape dismisses resolve modal
 *   8.  Admin org drawer: zero critical/serious axe violations
 *   9.  Admin org drawer: Escape dismisses the drawer
 *  10.  Portal form: zero critical/serious axe violations
 *  11.  Portal form: complete form is navigable with keyboard only
 *  12.  Portal form: submit button reachable via Tab from body field
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { TicketListPage } from '../pages/agent/ticket-list.page';
import { TicketDetailPage } from '../pages/agent/ticket-detail.page';
import { AdminOrganizationsPage } from '../pages/admin/organizations.page';
import { PortalSubmitTicketPage } from '../pages/portal/submit-ticket.page';
import { ApiClient, createStaffApiClient } from '../support/api-client';
import { API_BASE_URL } from '../playwright.config';

const STAFF_EMAIL = process.env['E2E_STAFF_EMAIL'] ?? 'agent@alpha-corp.example.com';
const STAFF_PASSWORD = process.env['E2E_STAFF_PASSWORD'] ?? 'e2e-staff-password';

// ── Agent surfaces ─────────────────────────────────────────────────────────

test.describe('Accessibility — agent ticket list', () => {
  test('zero critical/serious axe violations @smoke @full', async ({ page }) => {
    const listPage = new TicketListPage(page);
    await listPage.goto();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter((v) =>
      v.impact === 'critical' || v.impact === 'serious',
    );
    expect(critical, `Critical/serious axe violations: ${JSON.stringify(critical.map((v) => v.id))}`).toHaveLength(0); // Assertion 1
  });

  test('skip-to-content link is first focusable element @smoke @full', async ({ page }) => {
    const listPage = new TicketListPage(page);
    await listPage.goto();

    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    const href = await focused.getAttribute('href');
    expect(href).toBe('#main-content');                              // Assertion 2
  });

  test('keyboard traversal reaches all primary nav items @full', async ({ page }) => {
    const listPage = new TicketListPage(page);
    await listPage.goto();

    // Tab through the page and collect focusable data-testid attributes
    const focusedTestIds = new Set<string>();
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      const testId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (testId) focusedTestIds.add(testId);
    }

    // Primary nav items that must be keyboard reachable
    const requiredItems = ['nav-tickets', 'nav-dashboard', 'nav-reports'];
    for (const item of requiredItems) {
      expect(focusedTestIds.has(item), `${item} must be keyboard-reachable`).toBe(true); // Assertion 3
    }
  });
});

test.describe('Accessibility — agent ticket detail', () => {
  let ticketId: string;

  test.beforeEach(async () => {
    const api = await createStaffApiClient(API_BASE_URL, {
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });
    const { body } = await api.post<Record<string, unknown>>('/api/v1/tickets', {
      subject: `A11y Detail Test ${Date.now()}`,
      body: 'Accessibility test ticket',
      priority: 'P3',
    });
    ticketId = body['id'] as string;
  });

  test('zero critical/serious axe violations @smoke @full', async ({ page }) => {
    const detail = new TicketDetailPage(page);
    await page.goto(`/tickets/${ticketId}`);
    await detail.waitForLoad();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(critical).toHaveLength(0);                                // Assertion 4
  });

  test('resolve modal opens with keyboard and traps focus @smoke @full', async ({ page }) => {
    const detail = new TicketDetailPage(page);
    await page.goto(`/tickets/${ticketId}`);
    await detail.waitForLoad();

    // Tab to the resolve button and activate it
    let focused = '';
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      focused = (await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) ?? '';
      if (focused === 'resolve-btn') break;
    }
    await page.keyboard.press('Enter');

    // Assertion 5: resolve modal is visible
    await expect(detail.resolveModal()).toBeVisible();               // Assertion 5

    // Assertion 6: Tab cycle stays inside the modal (focus trap)
    const initialFocused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
    }
    const afterTabFocused = await page.evaluate(() => document.activeElement?.closest('[data-testid="resolve-modal"]'));
    expect(afterTabFocused).not.toBeNull();                          // Assertion 6

    // Assertion 7: Escape dismisses modal
    await page.keyboard.press('Escape');
    await expect(detail.resolveModal()).not.toBeVisible();           // Assertion 7
  });
});

// ── Admin surfaces ─────────────────────────────────────────────────────────

test.describe('Accessibility — admin org drawer', () => {
  test('zero critical/serious axe violations @smoke @full', async ({ page }) => {
    const adminPage = new AdminOrganizationsPage(page);
    await adminPage.goto();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(critical).toHaveLength(0);                                // Assertion 8
  });

  test('org drawer opened with keyboard and dismissed with Escape @smoke @full', async ({ page }) => {
    const adminPage = new AdminOrganizationsPage(page);
    await adminPage.goto();

    // Keyboard navigate to first org row and open drawer with Enter
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const testId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (testId === 'admin-org-row') break;
    }
    await page.keyboard.press('Enter');
    await expect(adminPage.orgDrawer()).toBeVisible();

    // Assertion 9: Escape dismisses drawer
    await page.keyboard.press('Escape');
    await expect(adminPage.orgDrawer()).not.toBeVisible();           // Assertion 9
  });
});

// ── Portal surfaces ────────────────────────────────────────────────────────

test.describe('Accessibility — portal ticket submission', () => {
  test('zero critical/serious axe violations @smoke @full', async ({ page }) => {
    const portalPage = new PortalSubmitTicketPage(page);
    await portalPage.goto();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(critical).toHaveLength(0);                                // Assertion 10
  });

  test('submit form fully navigable with keyboard only @smoke @full', async ({ page }) => {
    const portalPage = new PortalSubmitTicketPage(page);
    await portalPage.goto();

    // Tab through all form fields
    const reachedTestIds = new Set<string>();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const testId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (testId) reachedTestIds.add(testId);
      if (testId === 'submit-ticket-btn') break;
    }

    // Assertion 11: all key form fields reachable
    expect(reachedTestIds.has('ticket-subject-input')).toBe(true);  // Assertion 11
    expect(reachedTestIds.has('ticket-body-input')).toBe(true);

    // Assertion 12: submit button reachable via keyboard
    expect(reachedTestIds.has('submit-ticket-btn')).toBe(true);     // Assertion 12
  });
});
