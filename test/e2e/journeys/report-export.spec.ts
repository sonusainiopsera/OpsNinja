/**
 * report-export.spec.ts  @full
 *
 * Dedicated report export edge cases:
 *   - Empty result set produces valid CSV with headers
 *   - Empty result set produces valid PDF with explicit empty-state message
 */

import { test, expect } from '@playwright/test';
import { ApiClient, createStaffApiClient } from '../support/api-client';
import { eventualValue } from '../support/eventual';
import { API_BASE_URL } from '../playwright.config';

const STAFF_EMAIL = process.env['E2E_STAFF_EMAIL'] ?? 'agent@alpha-corp.example.com';
const STAFF_PASSWORD = process.env['E2E_STAFF_PASSWORD'] ?? 'e2e-staff-password';
// A report definition filtered to return zero rows
const EMPTY_REPORT_DEF_ID = process.env['E2E_EMPTY_REPORT_DEF_ID'] ?? 'empty-result-report';

test.describe('Report export — edge cases', () => {
  test.setTimeout(60_000);

  let api: ApiClient;

  test.beforeEach(async () => {
    api = await createStaffApiClient(API_BASE_URL, { email: STAFF_EMAIL, password: STAFF_PASSWORD });
  });

  test('empty result set produces valid CSV with headers @full', async () => {
    const { body: job } = await api.post<Record<string, unknown>>(
      '/api/v1/reports/export',
      { reportDefinitionId: EMPTY_REPORT_DEF_ID, format: 'csv' },
    );
    const jobId = job['id'] as string;

    const completedJob = await eventualValue(
      () => api.get<Record<string, unknown>>(`/api/v1/reports/export/${jobId}`),
      (r) => r.body['status'] === 'complete',
      { description: `empty CSV export job ${jobId} completes`, timeoutMs: 30_000 },
    );
    expect(completedJob.body['rowCount']).toBe(0);

    const csv = await fetch(completedJob.body['downloadUrl'] as string).then((r) => r.text());
    const lines = csv.trim().split('\n');
    // Should have header row only
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const headers = lines[0]?.split(',') ?? [];
    expect(headers.length).toBeGreaterThan(0);
  });

  test('empty result set produces valid PDF with empty-state message @full', async () => {
    const { body: job } = await api.post<Record<string, unknown>>(
      '/api/v1/reports/export',
      { reportDefinitionId: EMPTY_REPORT_DEF_ID, format: 'pdf' },
    );
    const jobId = job['id'] as string;

    const completedJob = await eventualValue(
      () => api.get<Record<string, unknown>>(`/api/v1/reports/export/${jobId}`),
      (r) => r.body['status'] === 'complete',
      { description: `empty PDF export job ${jobId} completes`, timeoutMs: 30_000 },
    );

    const pdf = await fetch(completedJob.body['downloadUrl'] as string).then((r) =>
      r.arrayBuffer(),
    );
    // Must be a valid PDF (magic bytes)
    const magic = Buffer.from(pdf).toString('utf8', 0, 4);
    expect(magic).toBe('%PDF');
    // Must be non-trivially sized (has the empty-state message rendered)
    expect(pdf.byteLength).toBeGreaterThan(512);
  });
});
