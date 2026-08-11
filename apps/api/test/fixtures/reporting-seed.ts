/**
 * Reporting integration test seed data.
 *
 * Seeds two tenants with organizations, tickets, SLA rows and AI summary rows
 * so the reporting integration suite runs with no external fixture dependency.
 *
 * UUID values are fixed so integration tests can assert on them deterministically.
 * Seeding bypasses RLS by running with the superuser role (before any tenant
 * context is set).
 */

import { PoolClient } from 'pg';

export const REPORTING_TENANT_A_ID = '10000000-0000-0000-0000-000000000001';
export const REPORTING_TENANT_B_ID = '10000000-0000-0000-0000-000000000002';

export const REPORTING_TENANT_A_ORG_ID = '10000000-0000-0001-0000-000000000001';
export const REPORTING_TENANT_B_ORG_ID = '10000000-0000-0002-0000-000000000001';

export const REPORTING_TENANT_A_TICKET_IDS = [
  '10000000-1111-0001-0000-000000000001',
  '10000000-1111-0001-0000-000000000002',
  '10000000-1111-0001-0000-000000000003',
];

export const REPORTING_TENANT_B_TICKET_IDS = [
  '10000000-1111-0002-0000-000000000001',
  '10000000-1111-0002-0000-000000000002',
];

export interface ReportingSeedResult {
  tenantATicketIds: string[];
  tenantBTicketIds: string[];
}

/**
 * Creates the minimal schema needed for reporting integration tests.
 * Applies RLS policies using current_setting('app.current_tenant').
 * Called once per test run in beforeAll with a superuser/admin connection.
 */
export async function createReportingSchema(client: PoolClient): Promise<void> {
  // Create a fresh schema to avoid conflicts with the main test suite.
  await client.query('CREATE SCHEMA IF NOT EXISTS reporting_test');
  await client.query('SET search_path = reporting_test');

  await client.query(`
    CREATE TABLE IF NOT EXISTS reporting_test.report_tenants (
      id   UUID PRIMARY KEY,
      name TEXT NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS reporting_test.report_organizations (
      id        UUID PRIMARY KEY,
      tenant_id UUID NOT NULL REFERENCES reporting_test.report_tenants(id),
      name      TEXT NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS reporting_test.report_tickets (
      id          UUID PRIMARY KEY,
      tenant_id   UUID NOT NULL REFERENCES reporting_test.report_tenants(id),
      org_id      UUID NOT NULL REFERENCES reporting_test.report_organizations(id),
      subject     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS reporting_test.report_ticket_sla (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id  UUID NOT NULL REFERENCES reporting_test.report_tickets(id),
      tenant_id  UUID NOT NULL,
      state      TEXT NOT NULL DEFAULT 'ok'
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS reporting_test.report_ai_summaries (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_id  UUID NOT NULL REFERENCES reporting_test.report_tickets(id),
      tenant_id  UUID NOT NULL,
      content    TEXT NOT NULL DEFAULT ''
    )
  `);

  // Enable RLS on all tenant-scoped tables
  for (const table of ['report_tickets', 'report_ticket_sla', 'report_ai_summaries', 'report_organizations']) {
    await client.query(`ALTER TABLE reporting_test.${table} ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE reporting_test.${table} FORCE ROW LEVEL SECURITY`);
    await client.query(`DROP POLICY IF EXISTS tenant_isolation ON reporting_test.${table}`);
    await client.query(`
      CREATE POLICY tenant_isolation ON reporting_test.${table}
        USING (tenant_id::text = current_setting('app.current_tenant', true))
    `);
  }
}

/**
 * Seeds two tenants with organizations, tickets, SLA rows and AI summary rows.
 * Must run in a superuser context with BYPASSRLS so the inserts are not filtered.
 */
export async function seedReportingData(client: PoolClient): Promise<ReportingSeedResult> {
  // Tenants
  await client.query(
    `INSERT INTO reporting_test.report_tenants (id, name)
     VALUES ($1, 'Reporting Tenant A'), ($2, 'Reporting Tenant B')
     ON CONFLICT (id) DO NOTHING`,
    [REPORTING_TENANT_A_ID, REPORTING_TENANT_B_ID],
  );

  // Organizations
  await client.query(
    `INSERT INTO reporting_test.report_organizations (id, tenant_id, name)
     VALUES ($1, $2, 'Org A'), ($3, $4, 'Org B')
     ON CONFLICT (id) DO NOTHING`,
    [
      REPORTING_TENANT_A_ORG_ID, REPORTING_TENANT_A_ID,
      REPORTING_TENANT_B_ORG_ID, REPORTING_TENANT_B_ID,
    ],
  );

  // Tickets for Tenant A
  for (const ticketId of REPORTING_TENANT_A_TICKET_IDS) {
    await client.query(
      `INSERT INTO reporting_test.report_tickets (id, tenant_id, org_id, subject)
       VALUES ($1, $2, $3, 'Ticket for A')
       ON CONFLICT (id) DO NOTHING`,
      [ticketId, REPORTING_TENANT_A_ID, REPORTING_TENANT_A_ORG_ID],
    );
    await client.query(
      `INSERT INTO reporting_test.report_ticket_sla (ticket_id, tenant_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [ticketId, REPORTING_TENANT_A_ID],
    );
    await client.query(
      `INSERT INTO reporting_test.report_ai_summaries (ticket_id, tenant_id, content)
       VALUES ($1, $2, 'Summary for A')
       ON CONFLICT DO NOTHING`,
      [ticketId, REPORTING_TENANT_A_ID],
    );
  }

  // Tickets for Tenant B
  for (const ticketId of REPORTING_TENANT_B_TICKET_IDS) {
    await client.query(
      `INSERT INTO reporting_test.report_tickets (id, tenant_id, org_id, subject)
       VALUES ($1, $2, $3, 'Ticket for B')
       ON CONFLICT (id) DO NOTHING`,
      [ticketId, REPORTING_TENANT_B_ID, REPORTING_TENANT_B_ORG_ID],
    );
    await client.query(
      `INSERT INTO reporting_test.report_ticket_sla (ticket_id, tenant_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [ticketId, REPORTING_TENANT_B_ID],
    );
    await client.query(
      `INSERT INTO reporting_test.report_ai_summaries (ticket_id, tenant_id, content)
       VALUES ($1, $2, 'Summary for B')
       ON CONFLICT DO NOTHING`,
      [ticketId, REPORTING_TENANT_B_ID],
    );
  }

  return {
    tenantATicketIds: REPORTING_TENANT_A_TICKET_IDS,
    tenantBTicketIds: REPORTING_TENANT_B_TICKET_IDS,
  };
}

/**
 * Drops the reporting test schema.
 */
export async function teardownReportingSchema(client: PoolClient): Promise<void> {
  await client.query('DROP SCHEMA IF EXISTS reporting_test CASCADE');
}
