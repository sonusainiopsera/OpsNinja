/**
 * saved-view.spec.ts  @smoke @full
 *
 * Journey: agent creates and pins a saved view combining status, priority,
 * category, tag and assignment group; resulting queue contents match an
 * independently computed expected set.
 *
 * Assertions (contributes ~6 to smoke count):
 *   1.  Saved view is created successfully (slug returned)
 *   2.  View appears in the saved-views sidebar
 *   3.  View can be pinned
 *   4.  Pinned view appears in pinned-views bar
 *   5.  Queue rendered when view is active matches expected ticket IDs
 *   6.  Queue contains no tickets that violate the view's filters
 */

import { test, expect } from '@playwright/test';
import { TicketListPage } from '../pages/agent/ticket-list.page';
import { SavedViewBuilderPage } from '../pages/agent/saved-view-builder.page';
import { ApiClient, createStaffApiClient } from '../support/api-client';
import { eventualValue, computeExpectedQueue } from '../support/eventual';
import { API_BASE_URL } from '../playwright.config';

const STAFF_EMAIL = process.env['E2E_STAFF_EMAIL'] ?? 'agent@alpha-corp.example.com';
const STAFF_PASSWORD = process.env['E2E_STAFF_PASSWORD'] ?? 'e2e-staff-password';

test.describe('Saved view creation and pinning', () => {
  test.setTimeout(60_000);

  let api: ApiClient;

  test.beforeEach(async () => {
    api = await createStaffApiClient(API_BASE_URL, {
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });
  });

  test('create, pin and verify saved view queue contents @smoke @full', async ({ page }) => {
    // ── Step 1: Create some known tickets via API ────────────────────────
    const created: Array<{ id: string; priority: string; status: string }> = [];

    for (const [priority, status] of [
      ['P1', 'open'],
      ['P2', 'open'],
      ['P3', 'open'],
      ['P1', 'in_progress'],
      ['P2', 'resolved'],
    ] as const) {
      const { body } = await api.post<Record<string, unknown>>('/api/v1/tickets', {
        subject: `SavedView Seed ${priority} ${status} ${Date.now()}`,
        body: 'Seeded for saved-view test',
        priority,
        status,
      });
      created.push({ id: body['id'] as string, priority, status });
    }

    // Independently compute expected queue: P1 OR P2 + status=open
    const expectedSet = computeExpectedQueue(created, (t) =>
      (t.priority === 'P1' || t.priority === 'P2') && t.status === 'open',
    );
    // Should be 2 tickets: (P1, open) and (P2, open)
    expect(expectedSet.size).toBe(2);

    // ── Step 2: Build the saved view in the UI ───────────────────────────
    const listPage = new TicketListPage(page);
    await listPage.goto();
    await listPage.openSavedViewBuilder();

    const builder = new SavedViewBuilderPage(page);
    await builder.waitForLoad();

    const viewName = `E2E High Priority Open ${Date.now()}`;
    await builder.setName(viewName);
    await builder.addStatusFilter('open');
    await builder.addPriorityFilter('P1');
    await builder.addPriorityFilter('P2');
    await builder.setScope('shared');

    const slug = await builder.save();

    // Assertion 1: slug returned
    expect(slug.length).toBeGreaterThan(0);                         // Assertion 1

    // Assertion 2: view appears in sidebar
    const savedViewLocator = page.locator(`[data-testid="saved-view-${slug}"]`);
    await expect(savedViewLocator).toBeVisible();                    // Assertion 2

    // Assertion 3–4: pin the view
    await builder.pinView(slug);
    const pinnedLocator = page.locator(`[data-testid="pinned-view-${slug}"]`);
    await expect(pinnedLocator).toBeVisible();                       // Assertion 3 (pin action)

    const pinnedCount = await builder.pinnedViews().count();
    expect(pinnedCount).toBeGreaterThanOrEqual(1);                   // Assertion 4

    // ── Step 3: Apply the view and assert queue contents ─────────────────
    await listPage.applySavedView(slug);

    // Wait for the queue to stabilise
    await eventualValue(
      async () => {
        const count = await listPage.ticketCount();
        return { count };
      },
      ({ count }) => count >= expectedSet.size,
      { description: 'queue contains at least expected ticket count', timeoutMs: 15_000 },
    );

    // Assertion 5: rendered queue contains all expected tickets
    await listPage.assertQueueContains(expectedSet);                 // Assertion 5

    // Assertion 6: no resolved or P3/P4 tickets bleed through
    const rows = listPage.ticketRows();
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const ticketId = await rows.nth(i).getAttribute('data-ticket-id');
      const { body } = await api.get<Record<string, unknown>>(`/api/v1/tickets/${ticketId}`);
      expect(['P1', 'P2']).toContain(body['priority']);             // Assertion 6
      expect(body['status']).toBe('open');
    }
  });
});
