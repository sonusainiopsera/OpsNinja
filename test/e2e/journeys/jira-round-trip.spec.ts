/**
 * jira-round-trip.spec.ts  @smoke @full
 *
 * Journey: create a Jira issue from a ticket → assert jira_links row →
 * emit signed inbound webhook transition → assert ticket state reflects it.
 *
 * Assertions (contributes ~8 to smoke count):
 *   1.  Create-issue API call reaches the Jira stub (recorded request)
 *   2.  Response contains an issue key (OPSNINJA-XXXX format)
 *   3.  GET /api/v1/tickets/:id/jira-links returns the new row
 *   4.  jira_links row has correct issueKey
 *   5.  jira_links row has correct siteUrl
 *   6.  Agent UI displays the jira link row
 *   7.  Signed inbound webhook updates ticket status via polling
 *   8.  Duplicate webhook event produces no second state change
 */

import { test, expect } from '@playwright/test';
import { TicketDetailPage } from '../pages/agent/ticket-detail.page';
import { ApiClient, createStaffApiClient } from '../support/api-client';
import { JiraStub } from '../support/stubs/jira-stub';
import { eventualValue } from '../support/eventual';
import { API_BASE_URL } from '../playwright.config';
import { SIGNED_JIRA_WEBHOOK_TRANSITION } from '../fixtures/jira-webhook.fixture';

const STAFF_EMAIL = process.env['E2E_STAFF_EMAIL'] ?? 'agent@alpha-corp.example.com';
const STAFF_PASSWORD = process.env['E2E_STAFF_PASSWORD'] ?? 'e2e-staff-password';
const JIRA_WEBHOOK_RECEIVER_URL =
  process.env['JIRA_RECEIVER_URL'] ?? 'http://localhost:8080/api/v1/webhooks/jira';

test.describe('Jira round-trip', () => {
  test.setTimeout(60_000);

  let api: ApiClient;
  let jiraStub: JiraStub;
  let ticketId: string;

  test.beforeEach(async () => {
    jiraStub = new JiraStub({ port: 19301 });
    await jiraStub.start();

    api = await createStaffApiClient(API_BASE_URL, {
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });

    const { body } = await api.post<Record<string, unknown>>('/api/v1/tickets', {
      subject: `Jira Round-Trip Test ${Date.now()}`,
      body: 'Need a Jira issue created for this ticket',
      priority: 'P2',
    });
    ticketId = body['id'] as string;
  });

  test.afterEach(async () => {
    await jiraStub.stop();
  });

  test('create Jira issue from ticket and verify link @smoke @full', async ({ page }) => {
    // ── Create issue via API ──────────────────────────────────────────────
    const { status: createStatus, body: linkBody } = await api.post<Record<string, unknown>>(
      `/api/v1/tickets/${ticketId}/jira-links`,
      { connectionId: 'test-jira-connection-id' },
    );

    // Assertion 1: create-issue call recorded by Jira stub
    expect(jiraStub.requests.some((r) => r.method === 'POST')).toBe(true); // Assertion 1

    // Assertion 2: response contains issue key
    expect(createStatus).toBe(201);
    const issueKey = linkBody['issueKey'] as string;
    expect(issueKey).toMatch(/^OPSNINJA-\d+$/);                     // Assertion 2

    // Assertion 3–5: jira_links row in API
    const { body: links } = await eventualValue(
      () => api.get<{ data: Array<Record<string, unknown>> }>(`/api/v1/tickets/${ticketId}/jira-links`),
      (r) => r.body.data.length > 0,
      { description: `jira_links row for ticket ${ticketId}`, timeoutMs: 10_000 },
    );
    expect(links.data.length).toBeGreaterThan(0);                   // Assertion 3
    expect(links.data[0]!['issueKey']).toBe(issueKey);              // Assertion 4
    expect(typeof links.data[0]!['siteUrl']).toBe('string');        // Assertion 5

    // ── Verify link row in agent UI ───────────────────────────────────────
    const detail = new TicketDetailPage(page);
    await page.goto(`/tickets/${ticketId}`);
    await detail.waitForLoad();

    // Assertion 6: UI renders jira link row
    await expect(detail.jiraLinkRows().first()).toBeVisible();       // Assertion 6
    const renderedKey = await page
      .locator('[data-testid="jira-issue-key"]')
      .first()
      .textContent();
    expect(renderedKey?.trim()).toBe(issueKey);

    // ── Emit signed inbound transition webhook ────────────────────────────
    await jiraStub.emitTransitionWebhook(JIRA_WEBHOOK_RECEIVER_URL, {
      issueKey,
      toStatus: 'Done',
      ticketId,
    });

    // Assertion 7: ticket status reflects Jira transition via polling
    const updatedTicket = await eventualValue(
      () => api.get<Record<string, unknown>>(`/api/v1/tickets/${ticketId}`),
      (r) => {
        const linked = r.body['jiraLinkedStatus'] as string | undefined;
        return linked === 'Done';
      },
      {
        description: `ticket ${ticketId} jiraLinkedStatus becomes 'Done'`,
        timeoutMs: 20_000,
      },
    );
    expect(updatedTicket.body['jiraLinkedStatus']).toBe('Done');     // Assertion 7

    // ── Duplicate webhook idempotency ─────────────────────────────────────
    // Emit the exact same event again — state must not change a second time
    await jiraStub.emitTransitionWebhook(JIRA_WEBHOOK_RECEIVER_URL, {
      issueKey,
      toStatus: 'Done',
      ticketId,
    });
    // Poll to ensure no second transition recorded (state remains stable)
    const { body: stableTicket } = await api.get<Record<string, unknown>>(
      `/api/v1/tickets/${ticketId}`,
    );
    expect(stableTicket['jiraLinkedStatus']).toBe('Done');           // Assertion 8
    // Verify only one transition history row
    const { body: history } = await api.get<{ data: unknown[] }>(
      `/api/v1/tickets/${ticketId}/jira-links/${issueKey}/history`,
    );
    expect(history.data.length).toBe(1);
  });
});
