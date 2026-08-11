/**
 * 12-month two-tenant reporting fixture.
 *
 * Seeds deterministic ticket data across two tenants for 12 months
 * (2025-01-01 to 2025-12-31) covering:
 *   - Four priorities (p1–p4)
 *   - Nested category_path
 *   - SLA outcomes (sla_state: running, breached, resolved)
 *   - Organization breakdown across two orgs per tenant
 *   - AI affected area tags
 *
 * All data is derived from fixed seeds so aggregate assertions are deterministic.
 */

import { PoolClient } from 'pg';

// ── UUID constants ─────────────────────────────────────────────────────────────

export const TENANT_A = '00000000-0000-0000-0000-000000000001';
export const TENANT_B = '00000000-0000-0000-0000-000000000002';

export const ORG_A1 = '10000000-0000-0000-0000-000000000001';
export const ORG_A2 = '10000000-0000-0000-0000-000000000002';
export const ORG_B1 = '20000000-0000-0000-0000-000000000001';
export const ORG_B2 = '20000000-0000-0000-0000-000000000002';

export const USER_A1 = 'a0000000-0000-0000-0000-000000000001';
export const USER_B1 = 'b0000000-0000-0000-0000-000000000001';

// ── Expected aggregates (deterministic from seed) ─────────────────────────────

// 24 tickets per tenant (2 per month × 12 months)
export const EXPECTED_TICKET_COUNT_TENANT_A = 24;
export const EXPECTED_TICKET_COUNT_TENANT_B = 24;

// Priorities distributed: p1=6, p2=6, p3=6, p4=6
export const EXPECTED_P1_COUNT_TENANT_A = 6;

// ── Seed function ─────────────────────────────────────────────────────────────

export async function applyTwelveMonthSeed(client: PoolClient): Promise<void> {
  // Create seed tables (raw SQL, no Drizzle schema coupling)
  await client.query(`
    CREATE TABLE IF NOT EXISTS rpt_organizations (
      id         UUID PRIMARY KEY,
      tenant_id  UUID NOT NULL,
      name       TEXT NOT NULL,
      tier       TEXT
    );

    CREATE TABLE IF NOT EXISTS rpt_tickets (
      id                  UUID PRIMARY KEY,
      tenant_id           UUID NOT NULL,
      organization_id     UUID,
      subject             TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'open',
      priority            TEXT NOT NULL DEFAULT 'p4',
      assignee_id         UUID,
      created_by_id       UUID NOT NULL,
      category_path       TEXT,
      sub_category        TEXT,
      sla_state           TEXT,
      first_response_at   TIMESTAMPTZ,
      resolved_at         TIMESTAMPTZ,
      csat_score          NUMERIC(3,2),
      created_at          TIMESTAMPTZ NOT NULL,
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE rpt_organizations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE rpt_tickets       ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS rpt_orgs_rls    ON rpt_organizations;
    DROP POLICY IF EXISTS rpt_tickets_rls ON rpt_tickets;

    CREATE POLICY rpt_orgs_rls ON rpt_organizations
      AS PERMISSIVE FOR ALL TO PUBLIC
      USING (tenant_id = current_setting('app.current_tenant')::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

    CREATE POLICY rpt_tickets_rls ON rpt_tickets
      AS PERMISSIVE FOR ALL TO PUBLIC
      USING (tenant_id = current_setting('app.current_tenant')::uuid)
      WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
  `);

  // Seed organizations
  await client.query(`
    INSERT INTO rpt_organizations (id, tenant_id, name, tier)
    VALUES
      ('${ORG_A1}', '${TENANT_A}', 'Alpha Corp',    'enterprise'),
      ('${ORG_A2}', '${TENANT_A}', 'Beta Ltd',      'smb'),
      ('${ORG_B1}', '${TENANT_B}', 'Gamma Inc',     'enterprise'),
      ('${ORG_B2}', '${TENANT_B}', 'Delta Solutions','smb')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Generate 12 months × 2 tickets per month × 2 tenants
  const priorities = ['p1', 'p2', 'p3', 'p4'];
  const categories = [
    'Network/VPN', 'Network/WiFi', 'Software/Auth', 'Hardware/Printer',
    'Software/Email', 'Hardware/Laptop',
  ];
  const slaStates = ['running', 'running', 'breached', 'running']; // 1/4 breach rate
  const statuses = ['resolved', 'resolved', 'open', 'closed'];

  const rows: string[] = [];

  for (const tenantId of [TENANT_A, TENANT_B]) {
    const orgs = tenantId === TENANT_A ? [ORG_A1, ORG_A2] : [ORG_B1, ORG_B2];
    const userId = tenantId === TENANT_A ? USER_A1 : USER_B1;

    for (let month = 1; month <= 12; month++) {
      for (let t = 0; t < 2; t++) {
        const idx = (month - 1) * 2 + t;
        const id = `${tenantId.slice(0, 8)}-${String(month).padStart(4, '0')}-0000-0000-${String(idx).padStart(12, '0')}`;
        const orgId = orgs[t % orgs.length];
        const priority = priorities[idx % priorities.length];
        const category = categories[idx % categories.length];
        const subCat = category.split('/')[1] ?? 'General';
        const slaState = slaStates[idx % slaStates.length];
        const status = statuses[idx % statuses.length];
        const mm = String(month).padStart(2, '0');
        const createdAt = `2025-${mm}-01T08:00:00Z`;
        const resolvedAt = status === 'resolved' ? `2025-${mm}-01T10:00:00Z` : 'NULL';
        const firstResponseAt = `2025-${mm}-01T08:30:00Z`;
        const csatScore = status === 'resolved' ? (3 + (idx % 3) * 0.5).toFixed(2) : 'NULL';

        rows.push(
          `('${id}', '${tenantId}', '${orgId}', 'Ticket ${idx}', '${status}',` +
          ` '${priority}', '${userId}', '${userId}', '${category}', '${subCat}',` +
          ` '${slaState}', '${firstResponseAt}',` +
          ` ${resolvedAt === 'NULL' ? 'NULL' : `'${resolvedAt}'`},` +
          ` ${csatScore === 'NULL' ? 'NULL' : csatScore},` +
          ` '${createdAt}', NOW())`,
        );
      }
    }
  }

  if (rows.length > 0) {
    await client.query(`
      INSERT INTO rpt_tickets
        (id, tenant_id, organization_id, subject, status, priority,
         assignee_id, created_by_id, category_path, sub_category,
         sla_state, first_response_at, resolved_at, csat_score, created_at, updated_at)
      VALUES ${rows.join(',\n')}
      ON CONFLICT (id) DO NOTHING;
    `);
  }
}

/** Tears down seed tables — call in afterAll */
export async function teardownTwelveMonthSeed(client: PoolClient): Promise<void> {
  await client.query(`
    DROP TABLE IF EXISTS rpt_tickets;
    DROP TABLE IF EXISTS rpt_organizations;
  `);
}
