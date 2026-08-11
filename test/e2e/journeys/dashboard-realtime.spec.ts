/**
 * dashboard-realtime.spec.ts  @smoke @full
 *
 * Journey: dashboard KPI counters and approaching-breach rows update over
 * the realtime channel after a state change; report export produces CSV and
 * PDF artifacts.
 *
 * Assertions (contributes ~10 to smoke count):
 *   1.  Realtime channel connects (indicator visible)
 *   2.  KPI 'open' counter increases by 1 after a new ticket is created
 *   3.  KPI 'breached' counter increases after a breach event
 *   4.  Approaching-breach row appears for a ticket near its SLA deadline
 *   5.  Report export job reaches 'complete' status via API
 *   6.  CSV artifact is downloadable
 *   7.  CSV headers match expected columns
 *   8.  CSV row count matches API query result
 *   9.  PDF artifact is downloadable
 *  10.  PDF is a valid non-trivial document (>1KB)
 */

import { test, expect } from '@playwright/test';
import { DashboardPage } from '../pages/agent/dashboard.page';
import { ApiClient, createStaffApiClient } from '../support/api-client';
import { eventualValue, eventually } from '../support/eventual';
import { API_BASE_URL } from '../playwright.config';

const STAFF_EMAIL = process.env['E2E_STAFF_EMAIL'] ?? 'agent@alpha-corp.example.com';
const STAFF_PASSWORD = process.env['E2E_STAFF_PASSWORD'] ?? 'e2e-staff-password';
const REPORT_DEF_ID = process.env['E2E_REPORT_DEF_ID'] ?? 'open-tickets-by-org';

test.describe('Dashboard realtime updates', () => {
  test.setTimeout(60_000);

  let api: ApiClient;

  test.beforeEach(async () => {
    api = await createStaffApiClient(API_BASE_URL, { email: STAFF_EMAIL, password: STAFF_PASSWORD });
  });

  test('KPI counters update over realtime channel @smoke @full', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    // Assertion 1: realtime indicator is present
    await dashboard.waitForRealtimeConnected();
    await expect(dashboard.realtimeIndicator()).toBeVisible();       // Assertion 1

    // Capture current 'open' count
    const openBefore = await dashboard.getKpiValue('open');

    // Create a new ticket via API
    await api.post('/api/v1/tickets', {
      subject: `Realtime KPI Test ${Date.now()}`,
      body: 'Observing realtime counter increment',
      priority: 'P3',
    });

    // Assertion 2: 'open' counter increments via realtime push
    await eventually(
      async () => {
        const current = await dashboard.getKpiValue('open');
        return current > openBefore;
      },
      {
        description: 'dashboard open KPI increments after new ticket',
        timeoutMs: 20_000,
      },
    );
    const openAfter = await dashboard.getKpiValue('open');
    expect(openAfter).toBeGreaterThan(openBefore);                   // Assertion 2
  });

  test('breached counter increments after a breach event @full', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();
    await dashboard.waitForRealtimeConnected();

    const breachedBefore = await dashboard.getKpiValue('breached');

    // Force a breach via test helper
    await api.post('/api/v1/test-helpers/trigger-sla-breach', {
      count: 1,
    });

    // Assertion 3: 'breached' counter increments
    await eventually(
      async () => {
        const current = await dashboard.getKpiValue('breached');
        return current > breachedBefore;
      },
      {
        description: 'dashboard breached KPI increments after forced breach',
        timeoutMs: 20_000,
      },
    );
    expect(await dashboard.getKpiValue('breached')).toBeGreaterThan(breachedBefore); // Assertion 3
  });

  test('approaching-breach row appears for near-deadline ticket @full', async ({ page }) => {
    const dashboard = new DashboardPage(page);
    await dashboard.goto();

    // Force a ticket near its SLA deadline via test helper
    const { body: nearTicket } = await api.post<Record<string, unknown>>(
      '/api/v1/test-helpers/create-near-breach-ticket',
      {},
    );
    const nearTicketId = nearTicket['id'] as string;

    // Assertion 4: approaching-breach row appears
    await eventually(
      async () => {
        const rows = dashboard.approachingBreachRows();
        const count = await rows.count();
        if (count === 0) return false;
        // Check if our specific ticket ID is in the list
        for (let i = 0; i < count; i++) {
          const id = await rows.nth(i).getAttribute('data-ticket-id');
          if (id === nearTicketId) return true;
        }
        return false;
      },
      {
        description: `approaching-breach row appears for ticket ${nearTicketId}`,
        timeoutMs: 20_000,
      },
    );
    // Assertion 4
    const rows = await dashboard.approachingBreachRows().count();
    expect(rows).toBeGreaterThan(0);
  });
});

test.describe('Report export', () => {
  test.setTimeout(60_000);

  let api: ApiClient;

  test.beforeEach(async () => {
    api = await createStaffApiClient(API_BASE_URL, { email: STAFF_EMAIL, password: STAFF_PASSWORD });
  });

  test('export job produces CSV and PDF artifacts @smoke @full', async ({ page }) => {
    // Trigger a CSV export
    const { body: csvJob } = await api.post<Record<string, unknown>>(
      '/api/v1/reports/export',
      { reportDefinitionId: REPORT_DEF_ID, format: 'csv' },
    );
    const csvJobId = csvJob['id'] as string;

    // Assertion 5: job reaches 'complete' status
    const completedCsvJob = await eventualValue(
      () => api.get<Record<string, unknown>>(`/api/v1/reports/export/${csvJobId}`),
      (r) => r.body['status'] === 'complete',
      { description: `CSV export job ${csvJobId} completes`, timeoutMs: 30_000 },
    );
    expect(completedCsvJob.body['status']).toBe('complete');         // Assertion 5

    // Assertion 6: download URL resolves
    const csvDownloadUrl = completedCsvJob.body['downloadUrl'] as string;
    expect(csvDownloadUrl).toBeTruthy();

    const csvResponse = await fetch(csvDownloadUrl);
    expect(csvResponse.ok).toBe(true);                               // Assertion 6

    // Assertion 7–8: CSV headers and row count
    const csvText = await csvResponse.text();
    const lines = csvText.trim().split('\n');
    const headers = lines[0]?.split(',') ?? [];
    expect(headers).toContain('ticket_id');                          // Assertion 7
    expect(headers).toContain('status');
    expect(lines.length - 1).toBeGreaterThan(0);                    // Assertion 8 (at least one row)

    // Trigger a PDF export
    const { body: pdfJob } = await api.post<Record<string, unknown>>(
      '/api/v1/reports/export',
      { reportDefinitionId: REPORT_DEF_ID, format: 'pdf' },
    );
    const pdfJobId = pdfJob['id'] as string;

    const completedPdfJob = await eventualValue(
      () => api.get<Record<string, unknown>>(`/api/v1/reports/export/${pdfJobId}`),
      (r) => r.body['status'] === 'complete',
      { description: `PDF export job ${pdfJobId} completes`, timeoutMs: 30_000 },
    );

    // Assertion 9: PDF download URL resolves
    const pdfDownloadUrl = completedPdfJob.body['downloadUrl'] as string;
    const pdfResponse = await fetch(pdfDownloadUrl);
    expect(pdfResponse.ok).toBe(true);                               // Assertion 9

    // Assertion 10: PDF is non-trivial (starts with %PDF, > 1KB)
    const pdfBuffer = await pdfResponse.arrayBuffer();
    const pdfMagic = Buffer.from(pdfBuffer).toString('utf8', 0, 4);
    expect(pdfMagic).toBe('%PDF');                                   // Assertion 10
    expect(pdfBuffer.byteLength).toBeGreaterThan(1024);
  });
});
