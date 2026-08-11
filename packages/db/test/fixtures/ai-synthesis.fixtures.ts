/**
 * AI synthesis test fixtures.
 *
 * Provides deterministic multi-tenant AI synthesis data for integration tests.
 * All IDs are fixed UUIDs so tests can assert counts and identities without
 * dynamic lookups.
 *
 * Dataset:
 *   Tenant A / Ticket A1 — succeeded summary, 2 affected areas
 *   Tenant A / Ticket A2 — failed summary (2 attempts), 0 affected areas
 *   Tenant B / Ticket B1 — succeeded summary, 1 affected area
 *
 * Depends on identity.fixtures.ts tenants and requires at least one ticket row
 * per tenant. This fixture inserts minimal ticket rows to avoid a FK violation
 * on ticket_ai_summaries.tenantId → tenants.id.
 * (No FK to tickets — see migration 0060 comments.)
 */
import type postgres from 'postgres';
import { FIXTURE_IDS as IDENTITY_IDS } from './identity.fixtures.js';

// ---------------------------------------------------------------------------
// Fixed UUIDs
// ---------------------------------------------------------------------------
export const AI_FIXTURE_IDS = {
  // Tenant A ticket IDs (we insert these as real ticket rows)
  TICKET_A1: 'a0000001-0000-0000-0000-000000000001',
  TICKET_A2: 'a0000001-0000-0000-0000-000000000002',
  // Tenant B ticket ID
  TICKET_B1: 'a0000001-0000-0000-0000-000000000003',

  // AI summary IDs
  SUMMARY_A1: 'a0000002-0000-0000-0000-000000000001',
  SUMMARY_A2: 'a0000002-0000-0000-0000-000000000002',
  SUMMARY_B1: 'a0000002-0000-0000-0000-000000000003',

  // Affected area IDs
  AREA_A1_PAYMENTS: 'a0000003-0000-0000-0000-000000000001',
  AREA_A1_AUTH:     'a0000003-0000-0000-0000-000000000002',
  AREA_B1_BILLING:  'a0000003-0000-0000-0000-000000000003',
} as const;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Inserts ticket rows and then AI synthesis rows for both tenants.
 * Must be called AFTER the identity fixtures (tenants + users) are loaded.
 */
export async function loadAiSynthesisFixtures(sql: ReturnType<typeof import('postgres').default>): Promise<void> {
  const TENANT_A = IDENTITY_IDS['TENANT_A'];
  const TENANT_B = IDENTITY_IDS['TENANT_B'];
  const ORG_A1   = IDENTITY_IDS['ORG_A1'];
  const ORG_B1   = IDENTITY_IDS['ORG_B1'];

  // -------------------------------------------------------------------------
  // Minimal ticket rows — required so ticket_id references resolve at the
  // application layer. No FK enforced at DB level (partitioned table).
  // -------------------------------------------------------------------------
  await sql.unsafe(`
    INSERT INTO tickets (tenant_id, id, organization_id, status, priority, subject, created_at, updated_at)
    VALUES
      ('${TENANT_A}', '${AI_FIXTURE_IDS.TICKET_A1}', '${ORG_A1}', 'solved', 'P2',
       'Checkout fails for all EU customers',   now() - interval '3 days', now() - interval '3 days'),
      ('${TENANT_A}', '${AI_FIXTURE_IDS.TICKET_A2}', '${ORG_A1}', 'closed', 'P3',
       'Login MFA prompt loop',                 now() - interval '2 days', now() - interval '2 days'),
      ('${TENANT_B}', '${AI_FIXTURE_IDS.TICKET_B1}', '${ORG_B1}', 'solved', 'P1',
       'Invoice PDF generation timeout',        now() - interval '1 day',  now() - interval '1 day')
    ON CONFLICT DO NOTHING;
  `);

  // -------------------------------------------------------------------------
  // AI summaries
  // -------------------------------------------------------------------------
  await sql.unsafe(`
    INSERT INTO ticket_ai_summaries
      (tenant_id, id, ticket_id, ai_status, attempt_count,
       model_id, prompt_version, generated_at, created_at, updated_at)
    VALUES
      -- Tenant A, Ticket A1 — succeeded
      ('${TENANT_A}', '${AI_FIXTURE_IDS.SUMMARY_A1}', '${AI_FIXTURE_IDS.TICKET_A1}',
       'succeeded', 1, 'claude-sonnet-5', 'v1.0',
       now() - interval '3 days', now() - interval '3 days', now() - interval '3 days'),
      -- Tenant A, Ticket A2 — failed (2 attempts, no summary text)
      ('${TENANT_A}', '${AI_FIXTURE_IDS.SUMMARY_A2}', '${AI_FIXTURE_IDS.TICKET_A2}',
       'failed', 2, 'claude-sonnet-5', 'v1.0',
       NULL, now() - interval '2 days', now() - interval '2 days'),
      -- Tenant B, Ticket B1 — succeeded
      ('${TENANT_B}', '${AI_FIXTURE_IDS.SUMMARY_B1}', '${AI_FIXTURE_IDS.TICKET_B1}',
       'succeeded', 1, 'claude-sonnet-5', 'v1.0',
       now() - interval '1 day', now() - interval '1 day', now() - interval '1 day')
    ON CONFLICT DO NOTHING;
  `);

  // -------------------------------------------------------------------------
  // Affected areas
  // -------------------------------------------------------------------------
  await sql.unsafe(`
    INSERT INTO ticket_affected_areas
      (tenant_id, id, ticket_id, area_label, confidence, source, created_at)
    VALUES
      -- Tenant A, Ticket A1 — 2 areas
      ('${TENANT_A}', '${AI_FIXTURE_IDS.AREA_A1_PAYMENTS}', '${AI_FIXTURE_IDS.TICKET_A1}',
       'Payments', 'high', 'ai', now() - interval '3 days'),
      ('${TENANT_A}', '${AI_FIXTURE_IDS.AREA_A1_AUTH}', '${AI_FIXTURE_IDS.TICKET_A1}',
       'Auth', 'medium', 'ai', now() - interval '3 days'),
      -- Tenant A, Ticket A2 — 0 areas (failed synthesis, no areas)
      -- Tenant B, Ticket B1 — 1 area
      ('${TENANT_B}', '${AI_FIXTURE_IDS.AREA_B1_BILLING}', '${AI_FIXTURE_IDS.TICKET_B1}',
       'Billing', 'high', 'ai', now() - interval '1 day')
    ON CONFLICT DO NOTHING;
  `);
}
