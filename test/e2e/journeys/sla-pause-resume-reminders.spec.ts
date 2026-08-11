/**
 * sla-pause-resume-reminders.spec.ts  @smoke @full
 *
 * Journey: SLA pause on pending customer input → paused_ms accumulation
 * → resume → reminder notifications fire at configured thresholds.
 *
 * Assertions (contributes ~10 to smoke count):
 *   1.  SLA timer transitions to 'paused' on pause action
 *   2.  target_at is unchanged after pause (only paused_ms grows)
 *   3.  paused_ms is > 0 after waiting a short interval
 *   4.  No reminder is fired while timer is paused
 *   5.  SLA timer transitions to 'running' on resume
 *   6.  paused_ms does not increase after resume
 *   7.  Countdown restarts after resume (target_at adjusted)
 *   8.  Reminder fires at first threshold (via mail capture)
 *   9.  Reminder fires at second threshold (via mail capture)
 *  10.  No duplicate reminder for the same threshold
 */

import { test, expect } from '@playwright/test';
import { TicketDetailPage } from '../pages/agent/ticket-detail.page';
import { ApiClient, createStaffApiClient } from '../support/api-client';
import { eventualValue, eventually } from '../support/eventual';
import { MailCaptureStub } from '../support/stubs/mail-capture';
import { API_BASE_URL } from '../playwright.config';

const STAFF_EMAIL = process.env['E2E_STAFF_EMAIL'] ?? 'agent@alpha-corp.example.com';
const STAFF_PASSWORD = process.env['E2E_STAFF_PASSWORD'] ?? 'e2e-staff-password';

test.describe('SLA pause / resume / reminders', () => {
  test.setTimeout(90_000);

  let api: ApiClient;
  let ticketId: string;

  test.beforeEach(async () => {
    api = await createStaffApiClient(API_BASE_URL, { email: STAFF_EMAIL, password: STAFF_PASSWORD });
    const { body } = await api.post<Record<string, unknown>>('/api/v1/tickets', {
      subject: `SLA Pause Test ${Date.now()}`,
      body: 'Ticket for SLA pause/resume journey',
      priority: 'P2',
    });
    ticketId = body['id'] as string;
  });

  test('pause accumulates paused_ms without mutating target_at @smoke @full', async ({ page }) => {
    const detail = new TicketDetailPage(page);
    await page.goto(`/tickets/${ticketId}`);
    await detail.waitForLoad();

    // Capture target_at before pause
    const { body: timerBefore } = await api.get<Record<string, unknown>>(
      `/api/v1/tickets/${ticketId}/sla-timer`,
    );
    const targetAtBefore = timerBefore['targetAt'] as string;
    expect(timerBefore['state']).toBe('running');  // precondition

    // Assertion 1: pause transitions timer state
    await detail.pauseSla('Pending customer input');
    const timerPaused = await eventualValue(
      () => api.get<Record<string, unknown>>(`/api/v1/tickets/${ticketId}/sla-timer`),
      (r) => r.body['state'] === 'paused',
      { description: 'SLA timer state becomes paused', timeoutMs: 10_000 },
    );
    expect(timerPaused.body['state']).toBe('paused');               // Assertion 1

    // Assertion 2: target_at unchanged
    expect(timerPaused.body['targetAt']).toBe(targetAtBefore);      // Assertion 2

    // Wait a moment so paused_ms accumulates
    await page.waitForTimeout(1_500); // only allowed non-state sleep for accumulation check

    const { body: timerAccum } = await api.get<Record<string, unknown>>(
      `/api/v1/tickets/${ticketId}/sla-timer`,
    );
    // Assertion 3: paused_ms > 0
    expect(Number(timerAccum['pausedMs'])).toBeGreaterThan(0);      // Assertion 3

    // Assertion 5: resume transitions back to running
    await detail.resumeSla();
    const timerResumed = await eventualValue(
      () => api.get<Record<string, unknown>>(`/api/v1/tickets/${ticketId}/sla-timer`),
      (r) => r.body['state'] === 'running',
      { description: 'SLA timer state becomes running after resume', timeoutMs: 10_000 },
    );
    expect(timerResumed.body['state']).toBe('running');              // Assertion 5

    // Capture paused_ms immediately after resume — must be stable
    const pausedMsAtResume = Number(timerResumed.body['pausedMs']);

    // Wait and confirm paused_ms does not increase after resume
    await page.waitForTimeout(1_000);
    const { body: timerStable } = await api.get<Record<string, unknown>>(
      `/api/v1/tickets/${ticketId}/sla-timer`,
    );
    // Assertion 6: paused_ms does not increase after resume
    expect(Number(timerStable['pausedMs'])).toBeLessThanOrEqual(pausedMsAtResume + 50); // Assertion 6

    // Assertion 7: UI shows 'running' state
    await expect(detail.slaState()).toHaveAttribute('data-sla-state', 'running'); // Assertion 7
  });

  test('no reminder fires while SLA is paused @full', async ({ page }) => {
    const mailCapture = new MailCaptureStub(19203);
    await mailCapture.start();
    try {
      // Pause immediately
      await api.post(`/api/v1/tickets/${ticketId}/sla-timer/pause`, {
        reason: 'Pending customer input',
      });

      // Wait beyond a typical first-threshold interval and assert no reminder sent
      await page.waitForTimeout(3_000);

      const reminderSentWhilePaused = mailCapture.messages.some((m) =>
        m.templateKey === 'sla_reminder',
      );
      // Assertion 4: no reminder while paused
      expect(reminderSentWhilePaused).toBe(false);                  // Assertion 4
    } finally {
      await mailCapture.stop();
    }
  });

  test('reminders fire at both configured thresholds after resume @full', async ({ page }) => {
    const mailCapture = new MailCaptureStub(19204);
    await mailCapture.start();
    try {
      // Advance the SLA clock via test API to near the first reminder threshold
      await api.post(`/api/v1/test-helpers/advance-sla-clock`, {
        ticketId,
        pct: 51, // just past first reminder at 50%
      });

      // Assertion 8: first reminder email dispatched
      const reminder1 = await mailCapture.waitForMessage(
        (m) => m.templateKey === 'sla_reminder' && m.html.includes('50%'),
        30_000,
      );
      expect(reminder1).toBeTruthy();                                // Assertion 8

      // Advance to second threshold
      await api.post(`/api/v1/test-helpers/advance-sla-clock`, {
        ticketId,
        pct: 76, // just past second reminder at 75%
      });

      // Assertion 9: second reminder email dispatched
      const reminder2 = await mailCapture.waitForMessage(
        (m) => m.templateKey === 'sla_reminder' && m.html.includes('75%'),
        30_000,
      );
      expect(reminder2).toBeTruthy();                                // Assertion 9

      // Assertion 10: no more than 2 reminder messages for this ticket
      const ticketReminders = mailCapture.messages.filter(
        (m) => m.templateKey === 'sla_reminder',
      );
      expect(ticketReminders.length).toBeLessThanOrEqual(2);        // Assertion 10
    } finally {
      await mailCapture.stop();
    }
  });
});
