/**
 * RLS characterization tests for the organization registry tables (WO-023).
 *
 * Connects as the restricted application role (NOSUPERUSER, no BYPASSRLS),
 * seeds two tenants, sets app.current_tenant to tenant A, then asserts
 * that tenant B rows are invisible across all five tenant-scoped tables.
 *
 * Requires DATABASE_URL. Skipped in offline runs.
 *
 * Each test uses a transaction rolled back on completion so no data persists.
 */

import { Pool, PoolClient } from 'pg';

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Fixed UUIDs for the two test tenants
// ---------------------------------------------------------------------------

const TENANT_A = 'b1000001-0000-0000-0000-000000000001';
const TENANT_B = 'b1000001-0000-0000-0000-000000000002';

// Organization IDs
const ORG_A = 'b1000002-0000-0000-0000-000000000001';
const ORG_B = 'b1000002-0000-0000-0000-000000000002';

// Row IDs for tenant B (these must be invisible when tenant=A is set)
const ACCOUNT_B = 'b1000003-0000-0000-0000-000000000001';
const CONTACT_B = 'b1000004-0000-0000-0000-000000000001';
const DOMAIN_B  = 'b1000005-0000-0000-0000-000000000001';
const FIELD_B   = 'b1000006-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setTenant(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

maybeDescribe('RLS org-registry: cross-tenant isolation', () => {
  let pool: Pool;
  let client: PoolClient;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query('BEGIN');

    // Insert two tenants (bypassing RLS by using superuser connection in tests).
    await client.query(`
      INSERT INTO tenants (id, name, slug)
      VALUES ($1, 'RLS Test Tenant A', 'rls-test-tenant-a'),
             ($2, 'RLS Test Tenant B', 'rls-test-tenant-b')
      ON CONFLICT DO NOTHING
    `, [TENANT_A, TENANT_B]);

    // Insert one organization per tenant.
    // We must bypass RLS here (superuser/test role) so we set tenant context first.
    // Use raw UPDATE to set config so both inserts work before RLS kicks in.
    await client.query(`SET LOCAL app.current_tenant = '${TENANT_A}'`);
    await client.query(`
      INSERT INTO organizations (id, tenant_id, name)
      VALUES ($1, $2, 'Org Alpha')
      ON CONFLICT DO NOTHING
    `, [ORG_A, TENANT_A]);

    await client.query(`SET LOCAL app.current_tenant = '${TENANT_B}'`);
    await client.query(`
      INSERT INTO organizations (id, tenant_id, name)
      VALUES ($1, $2, 'Org Beta')
      ON CONFLICT DO NOTHING
    `, [ORG_B, TENANT_B]);

    // Insert tenant B rows for each registry table.
    await client.query(`
      INSERT INTO customer_accounts (id, tenant_id, organization_id, name)
      VALUES ($1, $2, $3, 'Account B')
      ON CONFLICT DO NOTHING
    `, [ACCOUNT_B, TENANT_B, ORG_B]);

    await client.query(`
      INSERT INTO contacts (id, tenant_id, organization_id, email, full_name)
      VALUES ($1, $2, $3, 'contact-b@rls-test.example', 'Contact B')
      ON CONFLICT DO NOTHING
    `, [CONTACT_B, TENANT_B, ORG_B]);

    await client.query(`
      INSERT INTO organization_verified_domains (id, tenant_id, organization_id, domain)
      VALUES ($1, $2, $3, 'rls-test-b.example')
      ON CONFLICT DO NOTHING
    `, [DOMAIN_B, TENANT_B, ORG_B]);

    await client.query(`
      INSERT INTO custom_field_defs (id, tenant_id, field_key, label, data_type)
      VALUES ($1, $2, 'rls_test_field', 'RLS Test Field', 'string')
      ON CONFLICT DO NOTHING
    `, [FIELD_B, TENANT_B]);

    // Switch context to tenant A for the actual assertions.
    await setTenant(client, TENANT_A);
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  // --------------------------------------------------------------------------
  // organizations
  // --------------------------------------------------------------------------

  it('organizations: tenant B rows are invisible when app.current_tenant = tenant A', async () => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM organizations WHERE id = $1`,
      [ORG_B],
    );
    expect(rows).toHaveLength(0);
  });

  it('organizations: tenant A row IS visible when app.current_tenant = tenant A', async () => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM organizations WHERE id = $1`,
      [ORG_A],
    );
    expect(rows).toHaveLength(1);
  });

  // --------------------------------------------------------------------------
  // customer_accounts
  // --------------------------------------------------------------------------

  it('customer_accounts: tenant B row is invisible when app.current_tenant = tenant A', async () => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM customer_accounts WHERE id = $1`,
      [ACCOUNT_B],
    );
    expect(rows).toHaveLength(0);
  });

  it('customer_accounts: zero rows returned for unscoped SELECT when tenant = A', async () => {
    const { rows } = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM customer_accounts`,
    );
    const crossTenant = rows.filter((r) => r.tenant_id === TENANT_B);
    expect(crossTenant).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // contacts
  // --------------------------------------------------------------------------

  it('contacts: tenant B row is invisible when app.current_tenant = tenant A', async () => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM contacts WHERE id = $1`,
      [CONTACT_B],
    );
    expect(rows).toHaveLength(0);
  });

  it('contacts: unscoped SELECT returns no tenant B rows', async () => {
    const { rows } = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM contacts`,
    );
    const crossTenant = rows.filter((r) => r.tenant_id === TENANT_B);
    expect(crossTenant).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // organization_verified_domains
  // --------------------------------------------------------------------------

  it('organization_verified_domains: tenant B row is invisible when app.current_tenant = tenant A', async () => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM organization_verified_domains WHERE id = $1`,
      [DOMAIN_B],
    );
    expect(rows).toHaveLength(0);
  });

  it('organization_verified_domains: unscoped SELECT returns no tenant B rows', async () => {
    const { rows } = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM organization_verified_domains`,
    );
    const crossTenant = rows.filter((r) => r.tenant_id === TENANT_B);
    expect(crossTenant).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // custom_field_defs
  // --------------------------------------------------------------------------

  it('custom_field_defs: tenant B row is invisible when app.current_tenant = tenant A', async () => {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM custom_field_defs WHERE id = $1`,
      [FIELD_B],
    );
    expect(rows).toHaveLength(0);
  });

  it('custom_field_defs: unscoped SELECT returns no tenant B rows', async () => {
    const { rows } = await client.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM custom_field_defs`,
    );
    const crossTenant = rows.filter((r) => r.tenant_id === TENANT_B);
    expect(crossTenant).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // INSERT WITH CHECK enforcement — tenant B INSERT must be blocked
  // --------------------------------------------------------------------------

  it('organizations: INSERT with wrong tenant is blocked by WITH CHECK', async () => {
    await expect(
      client.query(
        `INSERT INTO organizations (id, tenant_id, name) VALUES ($1, $2, 'Injection Org')`,
        ['b9999999-0000-0000-0000-000000000001', TENANT_B],
      ),
    ).rejects.toThrow();
  });

  it('contacts: INSERT with wrong tenant is blocked by WITH CHECK', async () => {
    await expect(
      client.query(
        `INSERT INTO contacts (id, tenant_id, organization_id, email, full_name)
         VALUES ($1, $2, $3, 'inject@rls-test.example', 'Injected')`,
        ['b9999999-0000-0000-0000-000000000002', TENANT_B, ORG_B],
      ),
    ).rejects.toThrow();
  });

  it('custom_field_defs: INSERT with wrong tenant is blocked by WITH CHECK', async () => {
    await expect(
      client.query(
        `INSERT INTO custom_field_defs (id, tenant_id, field_key, label, data_type)
         VALUES ($1, $2, 'injected_field', 'Injected', 'string')`,
        ['b9999999-0000-0000-0000-000000000003', TENANT_B],
      ),
    ).rejects.toThrow();
  });

  // --------------------------------------------------------------------------
  // Missing tenant context → fail-closed (error, not empty result)
  // --------------------------------------------------------------------------

  it('organizations: missing app.current_tenant causes an error (fail-closed)', async () => {
    // Reset to empty string — the ::uuid cast will throw an error.
    await client.query(`SELECT set_config('app.current_tenant', '', true)`);
    await expect(
      client.query(`SELECT id FROM organizations`),
    ).rejects.toThrow();
  });

  it('contacts: missing app.current_tenant causes an error (fail-closed)', async () => {
    await client.query(`SELECT set_config('app.current_tenant', '', true)`);
    await expect(
      client.query(`SELECT id FROM contacts`),
    ).rejects.toThrow();
  });
});
