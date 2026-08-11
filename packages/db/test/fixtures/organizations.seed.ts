/**
 * Anonymised seed fixtures for the organization registry (WO-023).
 *
 * Three tenants, 12 organizations, 30 contacts, 8 custom field definitions.
 * All names/emails use example.invalid / TEST-NET addresses — no real PII.
 *
 * Usage in integration tests:
 *   import { seedOrganizationFixtures, clearOrganizationFixtures } from './organizations.seed';
 *   await seedOrganizationFixtures(pool);
 */

import type { Pool } from 'pg';

// ── Tenant IDs ─────────────────────────────────────────────────────────────────

export const TENANT_A = '11111111-1111-1111-1111-111111111111';
export const TENANT_B = '22222222-2222-2222-2222-222222222222';
export const TENANT_C = '33333333-3333-3333-3333-333333333333';

// ── Organization IDs ──────────────────────────────────────────────────────────

export const ORG_IDS = {
  // Tenant A — 4 organizations
  a1: 'a0000001-0000-0000-0000-000000000001',
  a2: 'a0000001-0000-0000-0000-000000000002',
  a3: 'a0000001-0000-0000-0000-000000000003',
  a4: 'a0000001-0000-0000-0000-000000000004',
  // Tenant B — 4 organizations
  b1: 'b0000002-0000-0000-0000-000000000001',
  b2: 'b0000002-0000-0000-0000-000000000002',
  b3: 'b0000002-0000-0000-0000-000000000003',
  b4: 'b0000002-0000-0000-0000-000000000004',
  // Tenant C — 4 organizations
  c1: 'c0000003-0000-0000-0000-000000000001',
  c2: 'c0000003-0000-0000-0000-000000000002',
  c3: 'c0000003-0000-0000-0000-000000000003',
  c4: 'c0000003-0000-0000-0000-000000000004',
};

// ── Organizations ─────────────────────────────────────────────────────────────

interface OrgRow {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  sla_tier: string;
  region: string;
  status: 'active' | 'inactive';
  custom_field_values: object;
}

const ORGANIZATIONS: OrgRow[] = [
  // Tenant A
  { id: ORG_IDS.a1, tenant_id: TENANT_A, name: 'Alpha Corp',     slug: 'alpha-corp',    sla_tier: 'gold',   region: 'us-east', status: 'active',   custom_field_values: { industry: 'tech' } },
  { id: ORG_IDS.a2, tenant_id: TENANT_A, name: 'Beta Industries', slug: 'beta-ind',      sla_tier: 'silver', region: 'us-west', status: 'active',   custom_field_values: {} },
  { id: ORG_IDS.a3, tenant_id: TENANT_A, name: 'Gamma LLC',       slug: 'gamma-llc',     sla_tier: 'bronze', region: 'eu-west', status: 'active',   custom_field_values: { industry: 'finance' } },
  { id: ORG_IDS.a4, tenant_id: TENANT_A, name: 'Delta Partners',  slug: 'delta-partners',sla_tier: 'bronze', region: 'us-east', status: 'inactive', custom_field_values: {} },

  // Tenant B
  { id: ORG_IDS.b1, tenant_id: TENANT_B, name: 'Alpha Corp',      slug: 'alpha-corp',    sla_tier: 'gold',   region: 'eu-west', status: 'active',   custom_field_values: { tier: 'enterprise' } },
  { id: ORG_IDS.b2, tenant_id: TENANT_B, name: 'Epsilon Group',   slug: 'epsilon-group', sla_tier: 'silver', region: 'ap-east', status: 'active',   custom_field_values: {} },
  { id: ORG_IDS.b3, tenant_id: TENANT_B, name: 'Zeta Services',   slug: 'zeta-svc',      sla_tier: 'silver', region: 'eu-west', status: 'active',   custom_field_values: {} },
  { id: ORG_IDS.b4, tenant_id: TENANT_B, name: 'Eta Solutions',   slug: 'eta-solutions', sla_tier: 'bronze', region: 'us-east', status: 'inactive', custom_field_values: {} },

  // Tenant C
  { id: ORG_IDS.c1, tenant_id: TENANT_C, name: 'Theta Ventures',  slug: 'theta-ventures',sla_tier: 'gold',   region: 'us-west', status: 'active',   custom_field_values: {} },
  { id: ORG_IDS.c2, tenant_id: TENANT_C, name: 'Iota Systems',    slug: 'iota-systems',  sla_tier: 'silver', region: 'eu-west', status: 'active',   custom_field_values: {} },
  { id: ORG_IDS.c3, tenant_id: TENANT_C, name: 'Kappa Logistics', slug: 'kappa-log',     sla_tier: 'bronze', region: 'ap-east', status: 'active',   custom_field_values: {} },
  { id: ORG_IDS.c4, tenant_id: TENANT_C, name: 'Lambda Tech',     slug: 'lambda-tech',   sla_tier: 'bronze', region: 'us-east', status: 'inactive', custom_field_values: {} },
];

// ── Contacts ──────────────────────────────────────────────────────────────────

interface ContactRow {
  id: string;
  tenant_id: string;
  organization_id: string;
  email: string;
  full_name: string;
  job_title: string | null;
  portal_access_enabled: boolean;
  status: 'active' | 'inactive' | 'bounced';
}

function makeContactId(i: number): string {
  return `cccc0000-0000-0000-0000-${String(i).padStart(12, '0')}`;
}

// 30 contacts spread across all 3 tenants (10 per tenant)
const CONTACTS: ContactRow[] = [
  // Tenant A — 10 contacts
  { id: makeContactId(1),  tenant_id: TENANT_A, organization_id: ORG_IDS.a1, email: 'alice@alpha-corp.example.invalid',    full_name: 'Alice Adams',    job_title: 'CTO',            portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(2),  tenant_id: TENANT_A, organization_id: ORG_IDS.a1, email: 'bob@alpha-corp.example.invalid',      full_name: 'Bob Baker',      job_title: 'Engineer',       portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(3),  tenant_id: TENANT_A, organization_id: ORG_IDS.a1, email: 'carol@alpha-corp.example.invalid',    full_name: 'Carol Clark',    job_title: null,             portal_access_enabled: false, status: 'active' },
  { id: makeContactId(4),  tenant_id: TENANT_A, organization_id: ORG_IDS.a2, email: 'dave@beta-ind.example.invalid',       full_name: 'Dave Davis',     job_title: 'Account Mgr',   portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(5),  tenant_id: TENANT_A, organization_id: ORG_IDS.a2, email: 'eve@beta-ind.example.invalid',        full_name: 'Eve Evans',      job_title: 'Director',      portal_access_enabled: false, status: 'active' },
  { id: makeContactId(6),  tenant_id: TENANT_A, organization_id: ORG_IDS.a3, email: 'frank@gamma-llc.example.invalid',     full_name: 'Frank Foster',   job_title: 'CFO',            portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(7),  tenant_id: TENANT_A, organization_id: ORG_IDS.a3, email: 'grace@gamma-llc.example.invalid',     full_name: 'Grace Green',    job_title: null,             portal_access_enabled: false, status: 'inactive' },
  { id: makeContactId(8),  tenant_id: TENANT_A, organization_id: ORG_IDS.a4, email: 'henry@delta-p.example.invalid',       full_name: 'Henry Hill',     job_title: 'CEO',            portal_access_enabled: false, status: 'active' },
  { id: makeContactId(9),  tenant_id: TENANT_A, organization_id: ORG_IDS.a1, email: 'iris@alpha-corp.example.invalid',     full_name: 'Iris Irving',    job_title: 'Support Lead',  portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(10), tenant_id: TENANT_A, organization_id: ORG_IDS.a2, email: 'jack@beta-ind.example.invalid',       full_name: 'Jack Johnson',   job_title: null,             portal_access_enabled: false, status: 'bounced' },

  // Tenant B — 10 contacts
  { id: makeContactId(11), tenant_id: TENANT_B, organization_id: ORG_IDS.b1, email: 'alice@alpha-b.example.invalid',       full_name: 'Alice Andrews',  job_title: 'VP Sales',      portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(12), tenant_id: TENANT_B, organization_id: ORG_IDS.b1, email: 'bob@alpha-b.example.invalid',         full_name: 'Bob Burns',      job_title: 'Engineer',      portal_access_enabled: false, status: 'active' },
  { id: makeContactId(13), tenant_id: TENANT_B, organization_id: ORG_IDS.b2, email: 'carol@epsilon.example.invalid',       full_name: 'Carol Chan',     job_title: 'Director',      portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(14), tenant_id: TENANT_B, organization_id: ORG_IDS.b2, email: 'dan@epsilon.example.invalid',         full_name: 'Dan Drake',      job_title: null,            portal_access_enabled: false, status: 'active' },
  { id: makeContactId(15), tenant_id: TENANT_B, organization_id: ORG_IDS.b3, email: 'ella@zeta-svc.example.invalid',       full_name: 'Ella Edwards',   job_title: 'CTO',           portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(16), tenant_id: TENANT_B, organization_id: ORG_IDS.b3, email: 'fred@zeta-svc.example.invalid',       full_name: 'Fred Fisher',    job_title: 'Support',       portal_access_enabled: false, status: 'active' },
  { id: makeContactId(17), tenant_id: TENANT_B, organization_id: ORG_IDS.b4, email: 'gina@eta.example.invalid',            full_name: 'Gina Grant',     job_title: 'PM',            portal_access_enabled: false, status: 'inactive' },
  { id: makeContactId(18), tenant_id: TENANT_B, organization_id: ORG_IDS.b1, email: 'harry@alpha-b.example.invalid',       full_name: 'Harry Hall',     job_title: 'Account Exec',  portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(19), tenant_id: TENANT_B, organization_id: ORG_IDS.b2, email: 'ivy@epsilon.example.invalid',         full_name: 'Ivy Ingram',     job_title: null,            portal_access_enabled: false, status: 'active' },
  { id: makeContactId(20), tenant_id: TENANT_B, organization_id: ORG_IDS.b3, email: 'john@zeta-svc.example.invalid',       full_name: 'John James',     job_title: 'Director',      portal_access_enabled: true,  status: 'active' },

  // Tenant C — 10 contacts
  { id: makeContactId(21), tenant_id: TENANT_C, organization_id: ORG_IDS.c1, email: 'kate@theta.example.invalid',          full_name: 'Kate King',      job_title: 'CTO',           portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(22), tenant_id: TENANT_C, organization_id: ORG_IDS.c1, email: 'leo@theta.example.invalid',           full_name: 'Leo Lewis',      job_title: 'Engineer',      portal_access_enabled: false, status: 'active' },
  { id: makeContactId(23), tenant_id: TENANT_C, organization_id: ORG_IDS.c2, email: 'mia@iota.example.invalid',            full_name: 'Mia Moore',      job_title: 'PM',            portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(24), tenant_id: TENANT_C, organization_id: ORG_IDS.c2, email: 'ned@iota.example.invalid',            full_name: 'Ned Nash',       job_title: null,            portal_access_enabled: false, status: 'active' },
  { id: makeContactId(25), tenant_id: TENANT_C, organization_id: ORG_IDS.c3, email: 'ora@kappa.example.invalid',           full_name: 'Ora Owen',       job_title: 'Director',      portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(26), tenant_id: TENANT_C, organization_id: ORG_IDS.c3, email: 'paul@kappa.example.invalid',          full_name: 'Paul Page',      job_title: 'Support',       portal_access_enabled: false, status: 'active' },
  { id: makeContactId(27), tenant_id: TENANT_C, organization_id: ORG_IDS.c4, email: 'quinn@lambda.example.invalid',        full_name: 'Quinn Quinn',    job_title: 'CFO',           portal_access_enabled: false, status: 'inactive' },
  { id: makeContactId(28), tenant_id: TENANT_C, organization_id: ORG_IDS.c1, email: 'rita@theta.example.invalid',          full_name: 'Rita Reed',      job_title: 'VP Sales',      portal_access_enabled: true,  status: 'active' },
  { id: makeContactId(29), tenant_id: TENANT_C, organization_id: ORG_IDS.c2, email: 'sam@iota.example.invalid',            full_name: 'Sam Stone',      job_title: null,            portal_access_enabled: false, status: 'active' },
  { id: makeContactId(30), tenant_id: TENANT_C, organization_id: ORG_IDS.c3, email: 'tara@kappa.example.invalid',          full_name: 'Tara Turner',    job_title: 'Account Mgr',   portal_access_enabled: true,  status: 'bounced' },
];

// ── Custom Field Definitions ──────────────────────────────────────────────────

function makeCfdId(i: number): string {
  return `cfd00000-0000-0000-0000-${String(i).padStart(12, '0')}`;
}

interface CfdRow {
  id: string;
  tenant_id: string;
  field_key: string;
  label: string;
  data_type: 'string' | 'number' | 'boolean' | 'date' | 'single_select' | 'multi_select';
  options: object | null;
  required: boolean;
  applies_to: string;
  display_order: number;
}

// 8 custom field definitions (across all tenants)
const CUSTOM_FIELD_DEFS: CfdRow[] = [
  { id: makeCfdId(1), tenant_id: TENANT_A, field_key: 'industry',      label: 'Industry',          data_type: 'single_select', options: { values: ['tech', 'finance', 'healthcare', 'retail'] }, required: false, applies_to: 'organization', display_order: 1 },
  { id: makeCfdId(2), tenant_id: TENANT_A, field_key: 'employee_count', label: 'Employee Count',    data_type: 'number',        options: null,                                                    required: false, applies_to: 'organization', display_order: 2 },
  { id: makeCfdId(3), tenant_id: TENANT_A, field_key: 'is_partner',    label: 'Is Partner',         data_type: 'boolean',       options: null,                                                    required: false, applies_to: 'organization', display_order: 3 },
  { id: makeCfdId(4), tenant_id: TENANT_B, field_key: 'tier',          label: 'Account Tier',       data_type: 'single_select', options: { values: ['standard', 'premium', 'enterprise'] },      required: true,  applies_to: 'organization', display_order: 1 },
  { id: makeCfdId(5), tenant_id: TENANT_B, field_key: 'tags',          label: 'Tags',               data_type: 'multi_select',  options: { values: ['strategic', 'at_risk', 'growth'] },          required: false, applies_to: 'organization', display_order: 2 },
  { id: makeCfdId(6), tenant_id: TENANT_B, field_key: 'contract_date', label: 'Contract Start',     data_type: 'date',          options: null,                                                    required: false, applies_to: 'organization', display_order: 3 },
  { id: makeCfdId(7), tenant_id: TENANT_C, field_key: 'region_code',   label: 'Region Code',        data_type: 'string',        options: null,                                                    required: true,  applies_to: 'organization', display_order: 1 },
  { id: makeCfdId(8), tenant_id: TENANT_C, field_key: 'priority',      label: 'Support Priority',   data_type: 'single_select', options: { values: ['low', 'medium', 'high', 'critical'] },       required: false, applies_to: 'organization', display_order: 2 },
];

// ── Seed / Clear helpers ───────────────────────────────────────────────────────

export async function seedOrganizationFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bypass RLS for seed operations (run as superuser in test environment)
    await client.query(`SET LOCAL row_security = off`);

    for (const org of ORGANIZATIONS) {
      await client.query(
        `INSERT INTO organizations (id, tenant_id, name, slug, sla_tier, region, status, custom_field_values)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [org.id, org.tenant_id, org.name, org.slug, org.sla_tier, org.region, org.status, JSON.stringify(org.custom_field_values)],
      );
    }

    for (const c of CONTACTS) {
      await client.query(
        `INSERT INTO contacts (id, tenant_id, organization_id, email, full_name, job_title, portal_access_enabled, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [c.id, c.tenant_id, c.organization_id, c.email, c.full_name, c.job_title, c.portal_access_enabled, c.status],
      );
    }

    for (const cfd of CUSTOM_FIELD_DEFS) {
      await client.query(
        `INSERT INTO custom_field_defs (id, tenant_id, field_key, label, data_type, options, required, applies_to, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [cfd.id, cfd.tenant_id, cfd.field_key, cfd.label, cfd.data_type, cfd.options ? JSON.stringify(cfd.options) : null, cfd.required, cfd.applies_to, cfd.display_order],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function clearOrganizationFixtures(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL row_security = off`);
    const allTenants = [TENANT_A, TENANT_B, TENANT_C];
    for (const tenantId of allTenants) {
      await client.query(`DELETE FROM custom_field_defs   WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM contacts             WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM customer_accounts   WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM organization_verified_domains WHERE tenant_id = $1`, [tenantId]);
      await client.query(`DELETE FROM organizations        WHERE tenant_id = $1`, [tenantId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
