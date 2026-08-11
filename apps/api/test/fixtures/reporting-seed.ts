/**
 * Reporting integration test seed fixtures.
 *
 * Creates two isolated tenants with organisations, tickets, and SLA rows so
 * the reporting replica integration suite can run without any external dependency.
 *
 * Schema is intentionally raw SQL (not Drizzle schema objects) so this fixture
 * has no hard coupling to schema modules from other feature modules.
 */

import { Pool, PoolClient } from 'pg';

export const TENANT_A = '00000000-0000-0000-0000-000000000001';
export const TENANT_B = '00000000-0000-0000-0000-000000000002';

export const ORG_A1 = '10000000-0000-0000-0000-000000000001';
export const ORG_B1 = '20000000-0000-0000-0000-000000000001';

export const TICKET_A1 = '11000000-0000-0000-0000-000000000001';
export const TICKET_A2 = '11000000-0000-0000-0000-000000000002';
export const TICKET_B1 = '22000000-0000-0000-0000-000000000001';

/** Applies the RLS baseline and seeds two tenants on the provided client. */
export async function applyReportingSeed(client: PoolClient): Promise<void> {
  await client.query(`
    -- Reporting seed: schema baseline (no migrations — connection WO only)
    CREATE TABLE IF NOT EXISTS seed_organizations (
      id          UUID PRIMARY KEY,
      tenant_id   UUID NOT NULL,
      name        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seed_tickets (
      id          UUID PRIMARY KEY,
      tenant_id   UUID NOT NULL,
      org_id      UUID NOT NULL,
      subject     TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS seed_sla_records (
      id          UUID PRIMARY KEY,
      tenant_id   UUID NOT NULL,
      ticket_id   UUID NOT NULL,
      state       TEXT NOT NULL
    );

    -- RLS policies on seed tables
    ALTER TABLE seed_organizations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE seed_tickets       ENABLE ROW LEVEL SECURITY;
    ALTER TABLE seed_sla_records   ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS seed_org_tenant ON seed_organizations;
    CREATE POLICY seed_org_tenant ON seed_organizations
      USING (tenant_id::text = current_setting('app.current_tenant', true));

    DROP POLICY IF EXISTS seed_ticket_tenant ON seed_tickets;
    CREATE POLICY seed_ticket_tenant ON seed_tickets
      USING (tenant_id::text = current_setting('app.current_tenant', true));

    DROP POLICY IF EXISTS seed_sla_tenant ON seed_sla_records;
    CREATE POLICY seed_sla_tenant ON seed_sla_records
      USING (tenant_id::text = current_setting('app.current_tenant', true));
  `);

  await client.query(`
    -- Tenant A data
    INSERT INTO seed_organizations (id, tenant_id, name)
    VALUES ('${ORG_A1}', '${TENANT_A}', 'Org A1')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO seed_tickets (id, tenant_id, org_id, subject, status)
    VALUES
      ('${TICKET_A1}', '${TENANT_A}', '${ORG_A1}', 'Ticket A1', 'open'),
      ('${TICKET_A2}', '${TENANT_A}', '${ORG_A1}', 'Ticket A2', 'resolved')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO seed_sla_records (id, tenant_id, ticket_id, state)
    VALUES ('11100000-0000-0000-0000-000000000001', '${TENANT_A}', '${TICKET_A1}', 'breached')
    ON CONFLICT (id) DO NOTHING;

    -- Tenant B data
    INSERT INTO seed_organizations (id, tenant_id, name)
    VALUES ('${ORG_B1}', '${TENANT_B}', 'Org B1')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO seed_tickets (id, tenant_id, org_id, subject, status)
    VALUES ('${TICKET_B1}', '${TENANT_B}', '${ORG_B1}', 'Ticket B1', 'open')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO seed_sla_records (id, tenant_id, ticket_id, state)
    VALUES ('22200000-0000-0000-0000-000000000001', '${TENANT_B}', '${TICKET_B1}', 'ok')
    ON CONFLICT (id) DO NOTHING;
  `);
}

/** Truncates seed tables between test runs. */
export async function clearReportingSeed(client: PoolClient): Promise<void> {
  await client.query(`
    TRUNCATE seed_sla_records, seed_tickets, seed_organizations;
  `);
}

/** Convenience: creates a pool, seeds, runs fn, tears down. */
export async function withReportingSeed<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await applyReportingSeed(client);
    return await fn(client);
  } finally {
    client.release();
  }
}
