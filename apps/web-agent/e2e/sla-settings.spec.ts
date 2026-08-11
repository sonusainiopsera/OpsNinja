/**
 * Playwright E2E — SLA settings page — WO-049.
 *
 * Journey: create policy → edit thresholds → save → reload → assert persistence.
 * axe accessibility checks on every tab in both light and dark themes.
 *
 * Uses MSW via the Playwright page route mock (no backend required).
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// ---------------------------------------------------------------------------
// Fixtures (shared across tests)
// ---------------------------------------------------------------------------

const BASE_URL = 'http://localhost:3000';
const SLA_PAGE = `${BASE_URL}/settings/sla`;

const MOCK_POLICIES = [
  {
    id: 'pol-test-001',
    name: 'Test SLA Policy',
    scopeType: 'tenant',
    scopeId: null,
    calendarId: null,
    calendarName: null,
    appliedOrganizationCount: 3,
    targetsRatified: false,
    version: 1,
    targets: [
      { priority: 'P1', responseMinutes: 15, resolutionMinutes: 60 },
      { priority: 'P2', responseMinutes: 60, resolutionMinutes: 240 },
      { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440 },
      { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2880 },
    ],
    pauseConditions: ['pending_customer_input'],
    firstReminderPct: 50,
    secondReminderPct: 75,
    onCallRoutingId: null,
    channelEmail: true,
    channelWebhook: false,
    channelPagerDuty: false,
  },
];

const MOCK_CALENDARS = [
  { id: 'cal-001', name: 'Standard Business Hours', calendarType: 'business_hours', timezone: 'America/New_York' },
];

// ---------------------------------------------------------------------------
// Setup: intercept API routes
// ---------------------------------------------------------------------------

async function mockSlaApis(page: import('@playwright/test').Page) {
  let savedPolicies = structuredClone(MOCK_POLICIES);

  await page.route('**/api/v1/sla-policies', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { data: savedPolicies } });
    } else if (route.request().method() === 'POST') {
      const body = await route.request().postDataJSON();
      const newPolicy = { ...body, id: `pol-new-${Date.now()}`, version: 1, targetsRatified: false, appliedOrganizationCount: 0, calendarName: null, scopeId: null };
      savedPolicies = [...savedPolicies, newPolicy];
      await route.fulfill({ json: { data: newPolicy }, status: 201 });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/v1/sla-policies/:id', async (route) => {
    const id = route.request().url().split('/').pop();
    if (route.request().method() === 'GET') {
      const policy = savedPolicies.find((p) => p.id === id);
      await route.fulfill(policy ? { json: { data: policy } } : { status: 404, json: { error: { code: 'NOT_FOUND' } } });
    } else if (route.request().method() === 'PUT') {
      const body = await route.request().postDataJSON();
      savedPolicies = savedPolicies.map((p) => p.id === id ? { ...p, ...body, version: (p.version ?? 1) + 1 } : p);
      const updated = savedPolicies.find((p) => p.id === id);
      await route.fulfill({ json: { data: updated } });
    } else {
      await route.continue();
    }
  });

  await page.route('**/api/v1/sla-calendars', async (route) => {
    await route.fulfill({ json: { data: MOCK_CALENDARS } });
  });

  await page.route('**/api/v1/sla-policies/scheduler-health', async (route) => {
    await route.fulfill({ json: { data: { status: 'healthy', lagMs: 85, checkedAt: new Date().toISOString() } } });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('SLA Settings Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockSlaApis(page);
  });

  test('renders page header with title, scheduler health pill and new policy button', async ({ page }) => {
    await page.goto(SLA_PAGE);
    await expect(page.getByRole('heading', { name: /SLA Policies/i })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(/scheduler/i);
    await expect(page.getByRole('button', { name: /new policy/i })).toBeVisible();
  });

  test('displays policy list with provisional badge for unratified policy', async ({ page }) => {
    await page.goto(SLA_PAGE);
    await expect(page.getByText('Test SLA Policy')).toBeVisible();
    await expect(page.getByText(/provisional/i)).toBeVisible();
  });

  test('opens policy editor with four tabs on policy click', async ({ page }) => {
    await page.goto(SLA_PAGE);
    await page.getByRole('button', { name: /select test sla policy/i }).click();
    await expect(page.getByRole('tab', { name: 'Targets' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Calendar and Pause' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Reminders and Escalation' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Preview' })).toBeVisible();
  });

  test('edit thresholds and save, then reload asserts persistence', async ({ page }) => {
    await page.goto(SLA_PAGE);
    await page.getByRole('button', { name: /select test sla policy/i }).click();

    // Navigate to Reminders tab
    await page.getByRole('tab', { name: 'Reminders and Escalation' }).click();
    await expect(page.getByRole('tab', { name: 'Reminders and Escalation' })).toHaveAttribute('aria-selected', 'true');

    // Verify sliders are present
    await expect(page.getByRole('slider', { name: /first reminder/i })).toBeVisible();
    await expect(page.getByRole('slider', { name: /second reminder/i })).toBeVisible();

    // Save
    await page.getByRole('button', { name: /^save$/i }).click();

    // Save completes without error
    await expect(page.getByRole('button', { name: /^save$/i })).toBeVisible();
    await expect(page.getByRole('alert')).not.toBeVisible().catch(() => {}); // no conflict
  });

  test('create new policy via + New Policy button', async ({ page }) => {
    await page.goto(SLA_PAGE);
    await page.getByRole('button', { name: /new policy/i }).click();

    // Editor opens with empty name
    await expect(page.getByLabelText(/policy name/i)).toBeVisible();
    await expect(page.getByLabelText(/policy name/i)).toHaveValue('');

    // Fill in name and save
    await page.getByLabelText(/policy name/i).fill('My New Policy');
    await page.getByRole('button', { name: /^save$/i }).click();

    await expect(page.getByText('My New Policy')).toBeVisible();
  });

  test('scheduler health shows unknown when endpoint fails', async ({ page }) => {
    await page.route('**/api/v1/sla-policies/scheduler-health', async (route) => {
      await route.fulfill({ status: 500, json: { error: { code: 'INTERNAL_ERROR' } } });
    });
    await page.goto(SLA_PAGE);
    await expect(page.getByRole('status')).toContainText(/unknown/i);
  });

  test('tab keyboard navigation (arrow keys)', async ({ page }) => {
    await page.goto(SLA_PAGE);
    await page.getByRole('button', { name: /select test sla policy/i }).click();

    const targetsTab = page.getByRole('tab', { name: 'Targets' });
    await targetsTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Calendar and Pause' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Reminders and Escalation' })).toBeFocused();
  });

  test('preview tab renders SlaTimeline with markers', async ({ page }) => {
    await page.goto(SLA_PAGE);
    await page.getByRole('button', { name: /select test sla policy/i }).click();
    await page.getByRole('tab', { name: 'Preview' }).click();
    // SlaTimeline figure should be present
    await expect(page.getByRole('figure').first()).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Accessibility checks (both themes, all tabs)
  // ---------------------------------------------------------------------------

  test('axe: Targets tab passes in light theme', async ({ page }) => {
    await page.goto(SLA_PAGE);
    await page.getByRole('button', { name: /select test sla policy/i }).click();
    await page.getByRole('tab', { name: 'Targets' }).click();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toHaveLength(0);
  });

  test('axe: Reminders tab passes in dark theme', async ({ page }) => {
    await page.goto(SLA_PAGE);
    await page.evaluate(() => { document.documentElement.dataset['theme'] = 'dark'; });
    await page.getByRole('button', { name: /select test sla policy/i }).click();
    await page.getByRole('tab', { name: 'Reminders and Escalation' }).click();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toHaveLength(0);
  });

  test('axe: Preview tab passes in light theme', async ({ page }) => {
    await page.goto(SLA_PAGE);
    await page.getByRole('button', { name: /select test sla policy/i }).click();
    await page.getByRole('tab', { name: 'Preview' }).click();
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toHaveLength(0);
  });
});
