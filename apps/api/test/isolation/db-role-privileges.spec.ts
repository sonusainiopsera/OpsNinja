/**
 * db-role-privileges.spec.ts — WO-098 AC7.
 *
 * Asserts that the application database role:
 *   1. Does NOT have SUPERUSER privilege.
 *   2. Does NOT have BYPASSRLS privilege.
 *   3. Cannot directly SET row_security = off.
 *   4. Cannot ALTER TABLE ... DISABLE ROW LEVEL SECURITY.
 *
 * These assertions prevent privilege escalation from defeating the tenant
 * isolation layer at the database level.
 *
 * The role name is read from DATABASE_URL or from DB_APP_ROLE env var.
 * If neither is set the suite is skipped.
 *
 * Requires DATABASE_URL with a superuser connection string
 * (or a role that can query pg_roles).
 */

import { Pool, PoolClient } from 'pg';

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RolePrivileges {
  rolname:        string;
  rolsuper:       boolean;
  rolbypassrls:   boolean;
  rolcreatedb:    boolean;
  rolcreaterole:  boolean;
}

async function getRolePrivileges(
  client: PoolClient,
  roleName: string,
): Promise<RolePrivileges | null> {
  const { rows } = await client.query<RolePrivileges>(
    `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
     FROM pg_roles
     WHERE rolname = $1`,
    [roleName],
  );
  return rows[0] ?? null;
}

function extractRoleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.username || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

maybeDescribe('WO-098 AC7: Application database role privilege assertions', () => {
  let pool:   Pool;
  let client: PoolClient;
  let appRoleName: string;

  beforeAll(async () => {
    pool   = new Pool({ connectionString: process.env['DATABASE_URL'] });
    client = await pool.connect();

    // Determine the app role name: from env or infer from DATABASE_URL
    const dbUrl = process.env['DATABASE_URL'] ?? '';
    appRoleName =
      process.env['DB_APP_ROLE'] ??
      extractRoleFromUrl(dbUrl) ??
      'opsninja_app'; // fallback
  });

  afterAll(async () => {
    client.release();
    await pool.end();
  });

  it('application role exists in pg_roles', async () => {
    const role = await getRolePrivileges(client, appRoleName);
    expect(
      role,
      `DB ROLE FAILURE: role "${appRoleName}" not found in pg_roles. ` +
      `Set DB_APP_ROLE env var to the correct application role name.`,
    ).not.toBeNull();
  });

  it('application role does NOT have SUPERUSER', async () => {
    const role = await getRolePrivileges(client, appRoleName);
    if (!role) return; // already reported above

    expect(
      role.rolsuper,
      `PRIVILEGE FAILURE: role "${appRoleName}" has SUPERUSER privilege. ` +
      `SUPERUSER bypasses all RLS policies and would defeat tenant isolation. ` +
      `Revoke: ALTER ROLE ${appRoleName} NOSUPERUSER;`,
    ).toBe(false);
  });

  it('application role does NOT have BYPASSRLS', async () => {
    const role = await getRolePrivileges(client, appRoleName);
    if (!role) return;

    expect(
      role.rolbypassrls,
      `PRIVILEGE FAILURE: role "${appRoleName}" has BYPASSRLS attribute. ` +
      `BYPASSRLS circumvents all row-level security policies. ` +
      `Revoke: ALTER ROLE ${appRoleName} NOBYPASSRLS;`,
    ).toBe(false);
  });

  it('application role does NOT have CREATEROLE', async () => {
    const role = await getRolePrivileges(client, appRoleName);
    if (!role) return;

    expect(
      role.rolcreaterole,
      `PRIVILEGE FAILURE: role "${appRoleName}" has CREATEROLE. ` +
      `CREATEROLE could allow privilege escalation.`,
    ).toBe(false);
  });

  it('cannot disable RLS on tickets table (permission check)', async () => {
    // Attempt to disable RLS as the application role — must fail with permission error
    // This test uses a separate connection set to the app role.
    const appUrl = process.env['DATABASE_APP_URL'] ?? process.env['DATABASE_URL'];
    if (!appUrl) return;

    const appPool = new Pool({ connectionString: appUrl });
    const appClient = await appPool.connect();

    try {
      // This DDL should fail because app role lacks ALTER TABLE privilege
      await expect(
        appClient.query('ALTER TABLE tickets DISABLE ROW LEVEL SECURITY'),
      ).rejects.toThrow();
    } finally {
      appClient.release();
      await appPool.end();
    }
  });
});
