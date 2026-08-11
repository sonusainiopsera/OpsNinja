/**
 * Deterministic seed fixture for the ticketing integration suite — WO-031.
 *
 * Produces:
 *   - 2 tenants
 *   - 4 organizations (2 per tenant)
 *   - 500 tickets spread across both tenants / all 4 orgs
 *   - 3 000 comments spread across those tickets
 *
 * All IDs are deterministically derived from a numeric seed so the fixture is
 * reproducible across runs. No random(); no Date.now().
 *
 * Usage (in a Testcontainers test):
 *
 *   import { seedTicketsFixture, SEED_TENANTS } from './fixtures/tickets-seed';
 *
 *   const client = await pool.connect();
 *   await seedTicketsFixture(client);
 *   // SEED_TENANTS[0].id, SEED_TENANTS[1].id  ← fixed UUIDs for assertions
 */

import type { PoolClient } from 'pg';

// ---------------------------------------------------------------------------
// Fixed identifiers — used by isolation tests for deterministic assertions
// ---------------------------------------------------------------------------

export const SEED_TENANTS = [
  { id: 'f0000001-0000-0000-0000-000000000001', name: 'Fixture Tenant Alpha', slug: 'fixture-alpha' },
  { id: 'f0000001-0000-0000-0000-000000000002', name: 'Fixture Tenant Beta',  slug: 'fixture-beta'  },
] as const;

export const SEED_ORGS = [
  { id: 'f0000002-0000-0000-0000-000000000001', tenantIdx: 0, name: 'Alpha Org 1' },
  { id: 'f0000002-0000-0000-0000-000000000002', tenantIdx: 0, name: 'Alpha Org 2' },
  { id: 'f0000002-0000-0000-0000-000000000003', tenantIdx: 1, name: 'Beta Org 1'  },
  { id: 'f0000002-0000-0000-0000-000000000004', tenantIdx: 1, name: 'Beta Org 2'  },
] as const;

const STATUSES: string[] = [
  'new', 'open', 'pending_customer', 'pending_engineering', 'resolved', 'closed',
];
const PRIORITIES: string[] = ['P1', 'P2', 'P3', 'P4'];

/**
 * Pad n to 12 hex digits (deterministic UUID segment).
 */
function hex12(n: number): string {
  return n.toString(16).padStart(12, '0');
}

/**
 * Build a deterministic UUID from a prefix char and a counter.
 * format: {prefix}000003-0000-0000-0000-{hex12(n)}
 */
function ticketId(n: number): string {
  return `f0000003-0000-0000-0000-${hex12(n)}`;
}

function commentId(n: number): string {
  return `f0000004-0000-0000-0000-${hex12(n)}`;
}

// ---------------------------------------------------------------------------
// Seed function
// ---------------------------------------------------------------------------

export async function seedTicketsFixture(client: PoolClient): Promise<void> {
  // ── 1. Tenants ──────────────────────────────────────────────────────────
  await client.query(`
    INSERT INTO tenants (id, name, slug)
    SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[])
    AS t(id, name, slug)
    ON CONFLICT DO NOTHING
  `, [
    SEED_TENANTS.map((t) => t.id),
    SEED_TENANTS.map((t) => t.name),
    SEED_TENANTS.map((t) => t.slug),
  ]);

  // ── 2. Organizations ────────────────────────────────────────────────────
  // Must bypass RLS for seeding; use superuser/owner connection in tests.
  for (const org of SEED_ORGS) {
    const tenantId = SEED_TENANTS[org.tenantIdx].id;
    // Set tenant context so RLS INSERT policy is satisfied.
    await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
    await client.query(`
      INSERT INTO organizations (id, tenant_id, name)
      VALUES ($1, $2, $3)
      ON CONFLICT DO NOTHING
    `, [org.id, tenantId, org.name]);
  }

  // ── 3. Tickets (500) ────────────────────────────────────────────────────
  // Distributed round-robin across the 4 orgs.
  const ticketIds: string[] = [];
  const ticketTenantIds: string[] = [];

  for (let i = 1; i <= 500; i++) {
    const orgIdx = (i - 1) % SEED_ORGS.length;
    const org = SEED_ORGS[orgIdx]!;
    const tenantId = SEED_TENANTS[org.tenantIdx].id;
    const id = ticketId(i);
    const status = STATUSES[(i - 1) % STATUSES.length]!;
    const priority = PRIORITIES[(i - 1) % PRIORITIES.length]!;

    ticketIds.push(id);
    ticketTenantIds.push(tenantId);

    await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
    await client.query(`
      INSERT INTO tickets (id, tenant_id, organization_id, subject, status, priority)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING
    `, [id, tenantId, org.id, `Fixture ticket ${i}`, status, priority]);
  }

  // ── 4. Comments (3 000, 6 per ticket) ──────────────────────────────────
  for (let c = 1; c <= 3000; c++) {
    const ticketIdx = ((c - 1) % 500); // 6 comments per ticket
    const ticketIdVal = ticketIds[ticketIdx]!;
    const tenantId = ticketTenantIds[ticketIdx]!;
    const orgIdx = ticketIdx % SEED_ORGS.length;
    const org = SEED_ORGS[orgIdx]!;

    await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
    await client.query(`
      INSERT INTO ticket_comments (id, tenant_id, ticket_id, organization_id, body, visibility)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT DO NOTHING
    `, [
      commentId(c),
      tenantId,
      ticketIdVal,
      org.id,
      `Fixture comment ${c} on ticket ${ticketIdx + 1}`,
      c % 3 === 0 ? 'internal' : 'public',
    ]);
  }
}
