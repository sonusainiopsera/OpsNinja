/**
 * Deterministic multi-tenant audit fixture generator.
 *
 * Produces 3 tenants × 2 months × 500 records = 3 000 audit rows with a valid
 * hash chain per tenant. All UUIDs and timestamps are derived from a fixed
 * seed so the fixture is reproducible across runs.
 *
 * Usage:
 *   const seed = new AuditSeed(sql, db);
 *   await seed.load();
 *
 * The generator inserts records in-order per tenant so the chain is valid.
 * The records are split across two months: odd-indexed → month 0, even → month 1.
 *
 * Dependencies: postgres.js connection string (superuser for inserts).
 */

import type postgres from 'postgres';
import { AuditWriter, type AuditRecord } from '../../../src/modules/audit/audit-writer.service.js';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

export const SEED_TENANTS = [
  'f1000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000002',
  'f1000000-0000-0000-0000-000000000003',
] as const;

export type SeedTenantId = (typeof SEED_TENANTS)[number];

export const SEED_ORGS: Record<SeedTenantId, string> = {
  'f1000000-0000-0000-0000-000000000001': 'f2000000-0000-0000-0000-000000000001',
  'f1000000-0000-0000-0000-000000000002': 'f2000000-0000-0000-0000-000000000002',
  'f1000000-0000-0000-0000-000000000003': 'f2000000-0000-0000-0000-000000000003',
};

// Two base months — tests can rely on records existing in both months.
export function seedMonths(baseDate: Date): [Date, Date] {
  const m0 = new Date(baseDate);
  m0.setUTCDate(1);
  m0.setUTCHours(0, 0, 0, 0);

  const m1 = new Date(m0);
  m1.setUTCMonth(m1.getUTCMonth() - 1);

  return [m0, m1];
}

// ---------------------------------------------------------------------------
// Seed loader
// ---------------------------------------------------------------------------

export const RECORDS_PER_TENANT = 500;

/**
 * Inserts tenant rows, then appends RECORDS_PER_TENANT audit records per
 * tenant via AuditWriter so the hash chain is always valid.
 *
 * @param sql         - postgres.js connection (superuser; bypasses RLS).
 * @param monthOffset - Optional: set the "current month" for timestamp
 *                      generation. Defaults to today. Must be a Date at the
 *                      first second of a month.
 */
export async function loadAuditFixtures(
  sql: ReturnType<typeof import('postgres').default>,
  monthOffset?: Date,
): Promise<void> {
  const base = monthOffset ?? new Date();
  const [month0, month1] = seedMonths(base);

  // Insert tenants and a minimal org per tenant.
  for (const tenantId of SEED_TENANTS) {
    const orgId = SEED_ORGS[tenantId as SeedTenantId];
    await sql.unsafe(`
      INSERT INTO tenants (id, name, plan_tier)
      VALUES ('${tenantId}', 'Seed Tenant ${tenantId.slice(-4)}', 'growth')
      ON CONFLICT DO NOTHING;

      INSERT INTO organizations (tenant_id, id, name)
      VALUES ('${tenantId}', '${orgId}', 'Seed Org ${tenantId.slice(-4)}')
      ON CONFLICT DO NOTHING;
    `);
  }

  // Use AuditWriter to build correct hash chains.
  const writer = new AuditWriter();

  for (const tenantId of SEED_TENANTS) {
    const records: AuditRecord[] = [];

    for (let i = 0; i < RECORDS_PER_TENANT; i++) {
      // Alternate between two months for cross-partition chain testing.
      const monthBase = i % 2 === 0 ? month0 : month1;
      const occurredAt = new Date(monthBase);
      occurredAt.setUTCSeconds(i);

      records.push({
        tenantId,
        actorType: 'user',
        actorId: `a${(i % 5).toString().padStart(7, '0')}-0000-0000-0000-000000000001`,
        actorDisplay: `Agent ${i % 5}`,
        actorRole: 'support_agent',
        action: i % 3 === 0 ? 'create' : i % 3 === 1 ? 'update' : 'delete',
        resourceType: 'ticket',
        resourceId: `b${(i % 50).toString().padStart(7, '0')}-0000-0000-0000-000000000001`,
        source: 'api',
        traceId: `trace-${i.toString().padStart(6, '0')}`,
        occurredAt,
        beforeState: i % 3 !== 0 ? { status: 'open', seq: i - 1 } : null,
        afterState: i % 3 !== 2 ? { status: 'closed', seq: i } : null,
      });
    }

    // Sort records by occurred_at before chunking so cross-chunk chain is consistent.
    records.sort((a, b) =>
      (a.occurredAt?.getTime() ?? 0) - (b.occurredAt?.getTime() ?? 0),
    );

    // appendBatch requires a transaction — use sql.begin to supply one.
    await sql.begin(async (tx) => {
      // Batch in chunks of 100 to avoid a single enormous statement.
      for (let chunk = 0; chunk < records.length; chunk += 100) {
        const slice = records.slice(chunk, chunk + 100);
        await writer.appendBatch(tx as unknown as ReturnType<typeof import('postgres').default>, slice);
      }
    });
  }
}
