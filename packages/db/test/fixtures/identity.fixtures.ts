/**
 * Identity test fixtures.
 *
 * Loads a deterministic two-tenant identity dataset into an existing test
 * database. Designed to be called inside a transaction so every test starts
 * from a clean state:
 *
 *   const { sql } = await createTestDb();
 *   await loadIdentityFixtures(sql);
 *   // ... run test ...
 *   // rollback the transaction to clean up
 *
 * Dataset summary:
 *   Tenant A:
 *     - Users: admin (support_admin), manager (support_manager),
 *              lead (support_lead), agent (support_agent),
 *              portal (portal_user)
 *     - Agent org scopes: agent → ORG_A1 (write) + ORG_A2 (read)
 *       overlapping: manager → ORG_A1 (admin)
 *   Tenant B:
 *     - Users: admin (support_admin), integration (integration_admin)
 *
 * No external dependencies; all IDs are fixed UUIDs.
 */
import type postgres from 'postgres';

// ---------------------------------------------------------------------------
// Fixed UUIDs
// ---------------------------------------------------------------------------
export const FIXTURE_IDS = {
  // Tenants
  TENANT_A: 'f1000000-0000-0000-0000-000000000001',
  TENANT_B: 'f1000000-0000-0000-0000-000000000002',

  // Organizations (Tenant A)
  ORG_A1: 'f2000000-0000-0000-0000-000000000001',
  ORG_A2: 'f2000000-0000-0000-0000-000000000002',
  ORG_B1: 'f2000000-0000-0000-0000-000000000003',

  // Users (Tenant A)
  USER_A_ADMIN:   'f3000000-0000-0000-0000-000000000001',
  USER_A_MANAGER: 'f3000000-0000-0000-0000-000000000002',
  USER_A_LEAD:    'f3000000-0000-0000-0000-000000000003',
  USER_A_AGENT:   'f3000000-0000-0000-0000-000000000004',
  USER_A_PORTAL:  'f3000000-0000-0000-0000-000000000005',

  // Users (Tenant B)
  USER_B_ADMIN:       'f3000000-0000-0000-0000-000000000006',
  USER_B_INTEGRATION: 'f3000000-0000-0000-0000-000000000007',

  // Roles (fixed UUIDs matching identity-roles.seed.ts)
  ROLE_ADMIN:        'a0000000-0000-0000-0000-000000000001',
  ROLE_MANAGER:      'a0000000-0000-0000-0000-000000000002',
  ROLE_LEAD:         'a0000000-0000-0000-0000-000000000003',
  ROLE_AGENT:        'a0000000-0000-0000-0000-000000000004',
  ROLE_INTEGRATION:  'a0000000-0000-0000-0000-000000000005',
  ROLE_PORTAL:       'a0000000-0000-0000-0000-000000000006',
} as const;

type Sql = ReturnType<typeof postgres>;

/**
 * Inserts fixture data into the connected database.
 * The caller is responsible for cleanup (transaction rollback or TRUNCATE).
 *
 * Runs as the connected role (superuser in tests), so RLS is bypassed via
 * superuser privilege. Use SET LOCAL ROLE app_user in a child transaction to
 * test RLS behaviour.
 */
export async function loadIdentityFixtures(sql: Sql): Promise<void> {
  // Tenants
  await sql.unsafe(`
    INSERT INTO tenants (id, name, plan_tier, is_active)
    VALUES
      ('${FIXTURE_IDS.TENANT_A}', 'Fixture Corp A', 'growth',   true),
      ('${FIXTURE_IDS.TENANT_B}', 'Fixture Corp B', 'starter',  true)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Organizations
  await sql.unsafe(`
    INSERT INTO organizations (tenant_id, id, name, tier, is_active)
    VALUES
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.ORG_A1}', 'Org A1', 'premium',    true),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.ORG_A2}', 'Org A2', 'standard',   true),
      ('${FIXTURE_IDS.TENANT_B}', '${FIXTURE_IDS.ORG_B1}', 'Org B1', 'enterprise', true)
    ON CONFLICT (tenant_id, id) DO NOTHING;
  `);

  // Users (Tenant A) — covering all five roles
  await sql.unsafe(`
    INSERT INTO users (tenant_id, id, email, email_normalized, display_name, kind, user_type, status)
    VALUES
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_ADMIN}',
        'admin@fixture-a.example', 'admin@fixture-a.example',
        'Admin A', 'staff', 'staff', 'active'),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_MANAGER}',
        'manager@fixture-a.example', 'manager@fixture-a.example',
        'Manager A', 'staff', 'staff', 'active'),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_LEAD}',
        'lead@fixture-a.example', 'lead@fixture-a.example',
        'Lead A', 'staff', 'staff', 'active'),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_AGENT}',
        'agent@fixture-a.example', 'agent@fixture-a.example',
        'Agent A', 'staff', 'staff', 'active'),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_PORTAL}',
        'portal@fixture-a.example', 'portal@fixture-a.example',
        'Portal A', 'portal', 'portal', 'active')
    ON CONFLICT (tenant_id, id) DO NOTHING;
  `);

  // Users (Tenant B)
  await sql.unsafe(`
    INSERT INTO users (tenant_id, id, email, email_normalized, display_name, kind, user_type, status)
    VALUES
      ('${FIXTURE_IDS.TENANT_B}', '${FIXTURE_IDS.USER_B_ADMIN}',
        'admin@fixture-b.example', 'admin@fixture-b.example',
        'Admin B', 'staff', 'staff', 'active'),
      ('${FIXTURE_IDS.TENANT_B}', '${FIXTURE_IDS.USER_B_INTEGRATION}',
        'jira-bot@fixture-b.example', 'jira-bot@fixture-b.example',
        'Jira Bot B', 'staff', 'machine', 'active')
    ON CONFLICT (tenant_id, id) DO NOTHING;
  `);

  // user_roles — assign each user their primary role
  await sql.unsafe(`
    INSERT INTO user_roles (tenant_id, user_id, role_id)
    VALUES
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_ADMIN}',
        '${FIXTURE_IDS.ROLE_ADMIN}'),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_MANAGER}',
        '${FIXTURE_IDS.ROLE_MANAGER}'),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_LEAD}',
        '${FIXTURE_IDS.ROLE_LEAD}'),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_AGENT}',
        '${FIXTURE_IDS.ROLE_AGENT}'),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_PORTAL}',
        '${FIXTURE_IDS.ROLE_PORTAL}'),
      ('${FIXTURE_IDS.TENANT_B}', '${FIXTURE_IDS.USER_B_ADMIN}',
        '${FIXTURE_IDS.ROLE_ADMIN}'),
      ('${FIXTURE_IDS.TENANT_B}', '${FIXTURE_IDS.USER_B_INTEGRATION}',
        '${FIXTURE_IDS.ROLE_INTEGRATION}')
    ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING;
  `);

  // agent_org_scopes — overlapping scopes: agent covers both orgs
  await sql.unsafe(`
    INSERT INTO agent_org_scopes (tenant_id, user_id, organization_id, access_level)
    VALUES
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_AGENT}',
        '${FIXTURE_IDS.ORG_A1}', 'write'),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_AGENT}',
        '${FIXTURE_IDS.ORG_A2}', 'read'),
      ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.USER_A_MANAGER}',
        '${FIXTURE_IDS.ORG_A1}', 'admin')
    ON CONFLICT (tenant_id, user_id, organization_id) DO NOTHING;
  `);
}

/**
 * Seeds the canonical RBAC catalog (roles, permissions, role_permissions)
 * from the fixed UUIDs used by the fixtures. Must be called before
 * loadIdentityFixtures() since user_roles has a FK to roles.
 */
export async function loadRbacCatalog(sql: Sql): Promise<void> {
  const roleDefs = [
    { id: FIXTURE_IDS.ROLE_ADMIN,       name: 'support_admin',       displayName: 'Support Administrator' },
    { id: FIXTURE_IDS.ROLE_MANAGER,     name: 'support_manager',     displayName: 'Support Manager' },
    { id: FIXTURE_IDS.ROLE_LEAD,        name: 'support_lead',        displayName: 'Support Lead / Analyst' },
    { id: FIXTURE_IDS.ROLE_AGENT,       name: 'support_agent',       displayName: 'Support Agent' },
    { id: FIXTURE_IDS.ROLE_INTEGRATION, name: 'integration_admin',   displayName: 'Integration Administrator' },
    { id: FIXTURE_IDS.ROLE_PORTAL,      name: 'portal_user',         displayName: 'Portal User' },
  ];

  for (const r of roleDefs) {
    await sql.unsafe(`
      INSERT INTO roles (id, name, display_name)
      VALUES ('${r.id}'::uuid, '${r.name}', '${r.displayName}')
      ON CONFLICT (name) DO NOTHING;
    `);
  }
}
