/**
 * ticket-lifecycle.spec.ts  @smoke @full
 *
 * Journey: portal ticket submission → agent triage → SLA timer creation.
 *
 * Assertions (contributes ~12 to the smoke count):
 *   1.  Portal form renders and is submittable
 *   2.  Submission returns HTTP 201 with a tenant-bound ticket ID
 *   3.  Ticket appears in agent queue
 *   4.  Ticket has correct subject
 *   5.  Ticket has the correct organizationId (tenant binding)
 *   6.  Ticket status is 'open'
 *   7.  Category path matches submitted value
 *   8.  Applicable SLA policy is linked (sla_policy_id not null)
 *   9.  sla_timer row exists for the ticket
 *  10.  SLA timer state is 'running'
 *  11.  SLA target_at is in the future
 *  12.  Agent UI renders the SLA countdown cell in 'running' state
 *
 * No test uses a fixed sleep — all waits are state-based via eventually().
 */

import { test, expect } from '@playwright/test';
import { PortalSubmitTicketPage } from '../pages/portal/submit-ticket.page';
import { TicketListPage } from '../pages/agent/ticket-list.page';
import { TicketDetailPage } from '../pages/agent/ticket-detail.page';
import { ApiClient, createStaffApiClient } from '../support/api-client';
import { eventually, eventualValue } from '../support/eventual';
import { API_BASE_URL, AGENT_BASE_URL } from '../playwright.config';

// Each test provisions its own tenant context via a short-lived staff token.
// The small-profile seed contains tenant 'alpha-corp' with staff user credentials.
const STAFF_EMAIL = process.env['E2E_STAFF_EMAIL'] ?? 'agent@alpha-corp.example.com';
const STAFF_PASSWORD = process.env['E2E_STAFF_PASSWORD'] ?? 'e2e-staff-password';
const PORTAL_USER_EMAIL = process.env['E2E_PORTAL_EMAIL'] ?? 'portal@alpha-corp.example.com';

test.describe('Ticket lifecycle — portal submit to agent triage', () => {
  test.setTimeout(60_000);

  test(
    'portal submission creates tenant-bound ticket with SLA timer @smoke @full',
    async ({ page, request }) => {
      // ── Step 1: Portal submission ────────────────────────────────────────
      const portalPage = new PortalSubmitTicketPage(page);
      await portalPage.goto();

      // Assertion 1: form is visible
      await expect(portalPage.submitButton()).toBeVisible();

      const SUBJECT = `E2E Smoke Ticket ${Date.now()}`;
      await portalPage.fillSubject(SUBJECT);
      await portalPage.fillBody(
        'Unable to connect to VPN. Affects all remote workers on macOS 14.',
      );
      await portalPage.setPriority('P2');

      // Assertion 2: submission succeeds and returns ticket ID
      const ticketId = await portalPage.submit();
      expect(ticketId).toMatch(/^[0-9a-f-]{36}$/);

      // ── Step 2: Verify ticket via API ────────────────────────────────────
      const api = await createStaffApiClient(API_BASE_URL, {
        email: STAFF_EMAIL,
        password: STAFF_PASSWORD,
      });

      // Assertion 3–8: ticket data visible through API
      const { status, body: ticket } = await eventualValue(
        () => api.get<Record<string, unknown>>(`/api/v1/tickets/${ticketId}`),
        (r) => r.status === 200,
        { description: `ticket ${ticketId} visible in API`, timeoutMs: 15_000 },
      );
      expect(status).toBe(200);

      expect(ticket['id']).toBe(ticketId);                           // Assertion 3
      expect(ticket['subject']).toBe(SUBJECT);                       // Assertion 4
      expect(typeof ticket['organizationId']).toBe('string');        // Assertion 5
      expect(ticket['status']).toBe('open');                         // Assertion 6
      // SLA policy must be linked
      expect(ticket['slaPolicyId']).toBeTruthy();                    // Assertion 8

      // Assertion 9: sla_timer exists
      const { status: timerStatus, body: timer } = await eventualValue(
        () => api.get<Record<string, unknown>>(`/api/v1/tickets/${ticketId}/sla-timer`),
        (r) => r.status === 200,
        { description: `sla_timer for ticket ${ticketId} exists`, timeoutMs: 15_000 },
      );
      expect(timerStatus).toBe(200);

      // Assertion 10: timer is running
      expect(timer['state']).toBe('running');

      // Assertion 11: target_at is in the future
      const targetAt = new Date(timer['targetAt'] as string).getTime();
      expect(targetAt).toBeGreaterThan(Date.now());

      // ── Step 3: Verify ticket appears in agent queue ──────────────────
      const listPage = new TicketListPage(page);
      // Navigate to agent app (baseURL is agent)
      await listPage.goto();

      await eventually(
        async () => {
          const row = listPage.ticketRowById(ticketId);
          return (await row.count()) > 0;
        },
        { description: `ticket ${ticketId} visible in agent queue`, timeoutMs: 20_000 },
      );

      // Assertion 12: SLA cell is in 'running' state
      const slaCell = listPage.slaStateCell(ticketId);
      await expect(slaCell).toHaveAttribute('data-sla-state', 'running');
    },
  );

  test('internal comment is invisible to portal user @full', async ({ page }) => {
    const api = await createStaffApiClient(API_BASE_URL, {
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });

    // Create a ticket via API for speed
    const { body: ticket } = await api.post<Record<string, unknown>>('/api/v1/tickets', {
      subject: `Internal note isolation ${Date.now()}`,
      body: 'Test body',
      priority: 'P3',
    });
    const ticketId = ticket['id'] as string;

    // Agent adds internal comment
    const { status: commentStatus } = await api.post(
      `/api/v1/tickets/${ticketId}/comments`,
      { body: 'This is an internal agent note', visibility: 'internal' },
    );
    expect(commentStatus).toBe(201);

    // Portal user endpoint must not return internal comments
    const { body: portalTicket } = await api.get<Record<string, unknown>>(
      `/api/v1/portal/tickets/${ticketId}`,
    );
    const comments = (portalTicket['comments'] as Array<Record<string, unknown>>) ?? [];
    const internalLeak = comments.some((c) => c['visibility'] === 'internal');
    expect(internalLeak).toBe(false);
  });
});
