/**
 * Integration test seed data.
 *
 * Inserts two tenants (A and B) with one organisation and a handful of tickets
 * each. The tickets table has no tenant predicate in the application query used
 * by the stub list endpoint — all tenant isolation is enforced exclusively by
 * the RLS policy reading the app.current_tenant session variable.
 *
 * UUID values are fixed (deterministic) so tests can assert on them.
 */

import { PoolClient } from 'pg';
import {
  TENANT_A_ID,
  TENANT_B_ID,
  TENANT_A_ORG_ID,
  TENANT_B_ORG_ID,
  TENANT_A_STAFF_USER_ID,
  TENANT_B_STAFF_USER_ID,
} from '../factories/principal-context.factory';

export interface SeedResult {
  tenantATicketIds: string[];
  tenantBTicketIds: string[];
}

/**
 * Seed two tenants with their organisations and tickets.
 * Runs outside a tenant-bound context (using the superuser role so RLS is bypassed
 * during seeding) to avoid chicken-and-egg issues.
 */
export async function seedTestData(client: PoolClient): Promise<SeedResult> {
  await client.query('BEGIN');

  try {
    // Tenants
    await client.query(
      `INSERT INTO tenants (id, name, slug, active)
       VALUES ($1, 'Tenant A', 'tenant-a', true),
              ($2, 'Tenant B', 'tenant-b', true)
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_A_ID, TENANT_B_ID],
    );

    // Organizations
    await client.query(
      `INSERT INTO organizations (id, tenant_id, name, tier)
       VALUES ($1, $2, 'Org A', 'enterprise'),
              ($3, $4, 'Org B', 'standard')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_A_ORG_ID, TENANT_A_ID, TENANT_B_ORG_ID, TENANT_B_ID],
    );

    // Users
    await client.query(
      `INSERT INTO users (id, tenant_id, email, principal_kind)
       VALUES ($1, $2, 'agent-a@tenant-a.example', 'staff'),
              ($3, $4, 'agent-b@tenant-b.example', 'staff')
       ON CONFLICT (id) DO NOTHING`,
      [TENANT_A_STAFF_USER_ID, TENANT_A_ID, TENANT_B_STAFF_USER_ID, TENANT_B_ID],
    );

    // Tickets for tenant A
    const tenantATicketIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const ticketId = `a0000000-0000-0000-0000-00000000000${i}`;
      await client.query(
        `INSERT INTO tickets (id, tenant_id, organization_id, subject, status, priority)
         VALUES ($1, $2, $3, $4, 'open', 'P2')
         ON CONFLICT (id) DO NOTHING`,
        [ticketId, TENANT_A_ID, TENANT_A_ORG_ID, `Tenant A Ticket ${i}`],
      );
      tenantATicketIds.push(ticketId);
    }

    // Tickets for tenant B
    const tenantBTicketIds: string[] = [];
    for (let i = 1; i <= 2; i++) {
      const ticketId = `b0000000-0000-0000-0000-00000000000${i}`;
      await client.query(
        `INSERT INTO tickets (id, tenant_id, organization_id, subject, status, priority)
         VALUES ($1, $2, $3, $4, 'open', 'P3')
         ON CONFLICT (id) DO NOTHING`,
        [ticketId, TENANT_B_ID, TENANT_B_ORG_ID, `Tenant B Ticket ${i}`],
      );
      tenantBTicketIds.push(ticketId);
    }

    await client.query('COMMIT');
    return { tenantATicketIds, tenantBTicketIds };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

/**
 * Remove seed data (for after-all cleanup).
 */
export async function teardownTestData(client: PoolClient): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(
      `DELETE FROM tickets WHERE tenant_id IN ($1, $2)`,
      [TENANT_A_ID, TENANT_B_ID],
    );
    await client.query(
      `DELETE FROM users WHERE tenant_id IN ($1, $2)`,
      [TENANT_A_ID, TENANT_B_ID],
    );
    await client.query(
      `DELETE FROM organizations WHERE tenant_id IN ($1, $2)`,
      [TENANT_A_ID, TENANT_B_ID],
    );
    await client.query(
      `DELETE FROM tenants WHERE id IN ($1, $2)`,
      [TENANT_A_ID, TENANT_B_ID],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}
