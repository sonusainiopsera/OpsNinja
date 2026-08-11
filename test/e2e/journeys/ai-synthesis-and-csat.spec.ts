/**
 * ai-synthesis-and-csat.spec.ts  @smoke @full
 *
 * Journey: ticket resolution → immediate closure regardless of AI availability →
 * async AI summary and affected-area writeback → CSAT email dispatch →
 * forced-failure path leaves ticket resolved with failed AI status.
 *
 * Assertions (contributes ~10 to smoke count):
 *   1.  Resolve endpoint returns 200 immediately
 *   2.  Ticket status is 'resolved' immediately after resolve call
 *   3.  AI synthesis worker writes summary via API (within SLA)
 *   4.  AI summary text matches the stub fixture
 *   5.  affected_area_tags are populated
 *   6.  CSAT email is dispatched to the ticket requester
 *   7.  CSAT email contains a tokenised survey link
 *   8.  Forced-failure path: ticket resolves successfully
 *   9.  Forced-failure path: ai_status settles to 'failed'
 *  10.  Forced-failure path: ticket is NOT blocked on AI completion
 */

import { test, expect } from '@playwright/test';
import { TicketDetailPage } from '../pages/agent/ticket-detail.page';
import { ApiClient, createStaffApiClient } from '../support/api-client';
import { InferenceStub, FIXED_SUMMARY } from '../support/stubs/inference-stub';
import { MailCaptureStub } from '../support/stubs/mail-capture';
import { eventualValue } from '../support/eventual';
import { API_BASE_URL } from '../playwright.config';

const STAFF_EMAIL = process.env['E2E_STAFF_EMAIL'] ?? 'agent@alpha-corp.example.com';
const STAFF_PASSWORD = process.env['E2E_STAFF_PASSWORD'] ?? 'e2e-staff-password';

test.describe('AI synthesis and CSAT', () => {
  test.setTimeout(90_000);

  let api: ApiClient;
  let inferenceStub: InferenceStub;
  let mailCapture: MailCaptureStub;

  test.beforeEach(async () => {
    inferenceStub = new InferenceStub({ port: 19401 });
    mailCapture = new MailCaptureStub(19402);
    await inferenceStub.start();
    await mailCapture.start();

    api = await createStaffApiClient(API_BASE_URL, {
      email: STAFF_EMAIL,
      password: STAFF_PASSWORD,
    });
  });

  test.afterEach(async () => {
    await inferenceStub.stop();
    await mailCapture.stop();
  });

  test('resolution succeeds immediately and AI writes back @smoke @full', async ({ page }) => {
    // Create ticket
    const { body: ticketBody } = await api.post<Record<string, unknown>>('/api/v1/tickets', {
      subject: `AI Synthesis Test ${Date.now()}`,
      body: 'Customer cannot authenticate via SSO provider.',
      priority: 'P2',
    });
    const ticketId = ticketBody['id'] as string;

    // Assertion 1: resolve returns 200 immediately
    const { status: resolveStatus } = await api.post(`/api/v1/tickets/${ticketId}/resolve`, {
      resolution: 'Resolved by E2E test',
    });
    expect(resolveStatus).toBe(200);                                 // Assertion 1

    // Assertion 2: ticket status is 'resolved' immediately
    const { body: resolvedTicket } = await api.get<Record<string, unknown>>(
      `/api/v1/tickets/${ticketId}`,
    );
    expect(resolvedTicket['status']).toBe('resolved');               // Assertion 2

    // Assertion 3–5: AI synthesis writes back within 30s
    const ticketWithAi = await eventualValue(
      () => api.get<Record<string, unknown>>(`/api/v1/tickets/${ticketId}`),
      (r) => r.body['aiStatus'] === 'completed' && !!r.body['aiSummary'],
      { description: `AI summary written for ticket ${ticketId}`, timeoutMs: 30_000 },
    );
    expect(ticketWithAi.body['aiStatus']).toBe('completed');         // Assertion 3
    expect(ticketWithAi.body['aiSummary']).toBe(FIXED_SUMMARY.summary); // Assertion 4

    const tags = ticketWithAi.body['affectedAreaTags'] as string[];
    expect(Array.isArray(tags) && tags.length > 0).toBe(true);      // Assertion 5

    // Assertion 6–7: CSAT email dispatched
    const csatEmail = await mailCapture.waitForMessage(
      (m) => m.templateKey === 'csat_survey',
      30_000,
    );
    expect(csatEmail).toBeTruthy();                                  // Assertion 6
    const csatLink = mailCapture.extractLink(csatEmail, /href="([^"]+csat[^"]+)"/);
    expect(csatLink).toBeTruthy();                                   // Assertion 7
  });

  test('forced AI failure: ticket resolves, ai_status settles to failed @smoke @full', async ({ page }) => {
    // Switch stub to forced-failure mode
    inferenceStub.setFailureMode();

    const { body: ticketBody } = await api.post<Record<string, unknown>>('/api/v1/tickets', {
      subject: `AI Failure Test ${Date.now()}`,
      body: 'Ticket to test AI failure path.',
      priority: 'P3',
    });
    const ticketId = ticketBody['id'] as string;

    // Assertion 8: resolve succeeds despite AI being unavailable
    const { status: resolveStatus } = await api.post(`/api/v1/tickets/${ticketId}/resolve`, {
      resolution: 'Resolved without AI',
    });
    expect(resolveStatus).toBe(200);                                 // Assertion 8

    // Assertion 9: ai_status settles to 'failed'
    const failedTicket = await eventualValue(
      () => api.get<Record<string, unknown>>(`/api/v1/tickets/${ticketId}`),
      (r) => r.body['aiStatus'] === 'failed',
      {
        description: `ai_status for ticket ${ticketId} settles to failed`,
        timeoutMs: 30_000,
      },
    );
    expect(failedTicket.body['aiStatus']).toBe('failed');            // Assertion 9

    // Assertion 10: ticket status is still 'resolved' (not blocked)
    expect(failedTicket.body['status']).toBe('resolved');            // Assertion 10
  });
});
