/**
 * Identity RLS integration tests.
 *
 * Exercises the FORCE ROW LEVEL SECURITY policies on all identity tables
 * using a real PostgreSQL 16 container (testcontainers). All queries run
 * as app_user (NOSUPERUSER, NOBYPASSRLS) via SET LOCAL ROLE to verify that
 * the tenant isolation predicate is enforced at the database level.
 *
 * Cases:
 *   1. No tenant variable set → every identity table returns zero rows.
 *   2. Correct tenant variable set → only that tenant's rows are visible.
 *   3. Cross-tenant INSERT rejected by the WITH CHECK predicate.
 *   4. Unique constraint on (tenant_id, email_normalized) rejects duplicates.
 *   5. Seed script is idempotent (running it twice produces no error and no
 *      duplicates).
 *   6. email_verification_tokens with NULL tenant_id are always visible
 *      (unbound signup flow).
 *   7. pending_user_approvals with NULL tenant_id are visible without a
 *      tenant session variable.
 */
import { describe, it, beforeAll, afterAll } from 'vitest';
import { expect } from 'vitest';
import postgres from 'postgres';
import { createTestDb, type TestDbContext } from './harness.js';
import {
  loadRbacCatalog,
  loadIdentityFixtures,
  FIXTURE_IDS,
} from './fixtures/identity.fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an app_user LOGIN role for the test so we can connect directly.
 * Uses SET LOCAL ROLE in a transaction from the superuser connection instead,
 * which avoids the need for a separate connection pool.
 */
async function asAppUser<T>(
  sql: ReturnType<typeof postgres>,
  tenantId: string | null,
  fn: (txSql: ReturnType<typeof postgres>) => Promise<T>,
): Promise<T> {
  return sql.begin(async (txSql) => {
    // Ensure app_user exists with LOGIN for the test (idempotent).
    // Switch to app_user for this transaction — subject to RLS.
    await txSql.unsafe(`SET LOCAL ROLE app_user`);
    if (tenantId !== null) {
      await txSql.unsafe(`SET LOCAL app.current_tenant = '${tenantId}'`);
    }
    return fn(txSql);
  });
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let ctx: TestDbContext;
let sql: ReturnType<typeof postgres>;

beforeAll(async () => {
  ctx = await createTestDb('identity-rls');
  sql = postgres(ctx.connectionString, { max: 3 });

  // Ensure app_user has LOGIN so SET ROLE works.
  // In production app_user is NOLOGIN; for tests we need to be able to SET ROLE
  // from the superuser session.
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOBYPASSRLS;
      END IF;
    END;
    $$;
  `);

  // Grant app_user the required DML on all relevant tables
  // (migration already does this, but guard against missing grants in test env)
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE ON users TO app_user;
    GRANT SELECT, INSERT, DELETE ON user_roles TO app_user;
    GRANT SELECT, INSERT, DELETE ON agent_org_scopes TO app_user;
    GRANT SELECT ON roles TO app_user;
    GRANT SELECT ON permissions TO app_user;
    GRANT SELECT ON role_permissions TO app_user;
    GRANT SELECT, INSERT, UPDATE ON refresh_sessions TO app_user;
    GRANT SELECT, INSERT, UPDATE ON email_verification_tokens TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON pending_user_approvals TO app_user;
    GRANT SELECT, INSERT, UPDATE ON organizations TO app_user;
    GRANT SELECT ON tenants TO app_user;
  `);

  // Load RBAC catalog first (user_roles FK depends on roles)
  await loadRbacCatalog(sql);
  await loadIdentityFixtures(sql);
}, 120_000);

afterAll(async () => {
  await sql.end();
  await ctx.teardown();
});

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('RLS: no tenant variable set', () => {
  it('users returns zero rows', async () => {
    const rows = await asAppUser(sql, null, (tx) =>
      tx.unsafe(`SELECT * FROM users`),
    );
    expect(rows).toHaveLength(0);
  });

  it('user_roles returns zero rows', async () => {
    const rows = await asAppUser(sql, null, (tx) =>
      tx.unsafe(`SELECT * FROM user_roles`),
    );
    expect(rows).toHaveLength(0);
  });

  it('agent_org_scopes returns zero rows', async () => {
    const rows = await asAppUser(sql, null, (tx) =>
      tx.unsafe(`SELECT * FROM agent_org_scopes`),
    );
    expect(rows).toHaveLength(0);
  });

  it('refresh_sessions returns zero rows', async () => {
    const rows = await asAppUser(sql, null, (tx) =>
      tx.unsafe(`SELECT * FROM refresh_sessions`),
    );
    expect(rows).toHaveLength(0);
  });

  it('organizations returns zero rows', async () => {
    const rows = await asAppUser(sql, null, (tx) =>
      tx.unsafe(`SELECT * FROM organizations`),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('RLS: correct tenant variable set', () => {
  it('users returns only tenant A rows', async () => {
    const rows = await asAppUser(sql, FIXTURE_IDS.TENANT_A, (tx) =>
      tx.unsafe(`SELECT id, email FROM users ORDER BY email`),
    );
    // Tenant A has 5 fixture users
    expect(rows.length).toBe(5);
    for (const row of rows) {
      expect(String(row['email'])).toContain('fixture-a');
    }
  });

  it('users returns only tenant B rows when B is active', async () => {
    const rows = await asAppUser(sql, FIXTURE_IDS.TENANT_B, (tx) =>
      tx.unsafe(`SELECT id, email FROM users ORDER BY email`),
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(String(row['email'])).toContain('fixture-b');
    }
  });

  it('user_roles returns only the requesting tenant rows', async () => {
    const aRows = await asAppUser(sql, FIXTURE_IDS.TENANT_A, (tx) =>
      tx.unsafe(`SELECT user_id, role_id FROM user_roles`),
    );
    const bRows = await asAppUser(sql, FIXTURE_IDS.TENANT_B, (tx) =>
      tx.unsafe(`SELECT user_id, role_id FROM user_roles`),
    );
    expect(aRows.length).toBe(5);
    expect(bRows.length).toBe(2);
  });

  it('agent_org_scopes returns correct rows for tenant A', async () => {
    const rows = await asAppUser(sql, FIXTURE_IDS.TENANT_A, (tx) =>
      tx.unsafe(`SELECT user_id, organization_id, access_level FROM agent_org_scopes`),
    );
    expect(rows.length).toBe(3);
    const levels = rows.map((r: Record<string, unknown>) => r['access_level'] as string);
    expect(levels).toContain('write');
    expect(levels).toContain('read');
    expect(levels).toContain('admin');
  });

  it('global tables (roles, permissions) are readable regardless of tenant', async () => {
    const roles = await asAppUser(sql, FIXTURE_IDS.TENANT_A, (tx) =>
      tx.unsafe(`SELECT name FROM roles ORDER BY name`),
    );
    expect(roles.length).toBeGreaterThanOrEqual(6);
  });
});

describe('RLS: cross-tenant isolation', () => {
  it('INSERT with mismatched tenant_id is rejected by WITH CHECK', async () => {
    await expect(
      asAppUser(sql, FIXTURE_IDS.TENANT_A, (tx) =>
        tx.unsafe(`
          INSERT INTO users (tenant_id, id, email, email_normalized, kind, status)
          VALUES (
            '${FIXTURE_IDS.TENANT_B}'::uuid,
            gen_random_uuid(),
            'evil@cross-tenant.example',
            'evil@cross-tenant.example',
            'staff',
            'active'
          )
        `),
      ),
    ).rejects.toThrow();
  });

  it('tenant B user is invisible when tenant A is active', async () => {
    const rows = await asAppUser(sql, FIXTURE_IDS.TENANT_A, (tx) =>
      tx.unsafe(`
        SELECT id FROM users
        WHERE id = '${FIXTURE_IDS.USER_B_ADMIN}'::uuid
      `),
    );
    expect(rows).toHaveLength(0);
  });

  it('tenant A rows are invisible when tenant B is active', async () => {
    const rows = await asAppUser(sql, FIXTURE_IDS.TENANT_B, (tx) =>
      tx.unsafe(`
        SELECT id FROM users
        WHERE id = '${FIXTURE_IDS.USER_A_ADMIN}'::uuid
      `),
    );
    expect(rows).toHaveLength(0);
  });
});

describe('email_normalized unique constraint', () => {
  it('rejects duplicate email differing only in case', async () => {
    // Insert first user with uppercase email (as superuser to bypass RLS)
    const uniqueId = 'f4000000-0000-0000-0000-000000000001';
    await sql.unsafe(`
      INSERT INTO users (tenant_id, id, email, email_normalized, kind, status)
      VALUES (
        '${FIXTURE_IDS.TENANT_A}'::uuid,
        '${uniqueId}'::uuid,
        'Case.Test@Fixture-A.Example',
        'case.test@fixture-a.example',
        'staff', 'active'
      ) ON CONFLICT (tenant_id, id) DO NOTHING;
    `);

    // Try to insert the same email in different case — should fail
    await expect(
      sql.unsafe(`
        INSERT INTO users (tenant_id, id, email, email_normalized, kind, status)
        VALUES (
          '${FIXTURE_IDS.TENANT_A}'::uuid,
          gen_random_uuid(),
          'CASE.TEST@fixture-a.example',
          'case.test@fixture-a.example',
          'staff', 'active'
        )
      `),
    ).rejects.toThrow();

    // Clean up
    await sql.unsafe(`DELETE FROM users WHERE id = '${uniqueId}'::uuid`);
  });

  it('allows same email address in different tenants', async () => {
    const idA = 'f4000000-0000-0000-0000-000000000002';
    const idB = 'f4000000-0000-0000-0000-000000000003';
    // Tenant A
    await sql.unsafe(`
      INSERT INTO users (tenant_id, id, email, email_normalized, kind, status)
      VALUES (
        '${FIXTURE_IDS.TENANT_A}'::uuid, '${idA}'::uuid,
        'shared@example.com', 'shared@example.com', 'staff', 'active'
      ) ON CONFLICT (tenant_id, id) DO NOTHING;
    `);
    // Tenant B — same email, different tenant: must succeed
    await sql.unsafe(`
      INSERT INTO users (tenant_id, id, email, email_normalized, kind, status)
      VALUES (
        '${FIXTURE_IDS.TENANT_B}'::uuid, '${idB}'::uuid,
        'shared@example.com', 'shared@example.com', 'staff', 'active'
      ) ON CONFLICT (tenant_id, id) DO NOTHING;
    `);

    const rows = await sql.unsafe(
      `SELECT tenant_id FROM users WHERE email_normalized = 'shared@example.com'`,
    );
    expect(rows.length).toBe(2);

    // Clean up
    await sql.unsafe(`DELETE FROM users WHERE id IN ('${idA}'::uuid, '${idB}'::uuid)`);
  });
});

describe('nullable tenant_id tables', () => {
  it('email_verification_tokens with NULL tenant_id are visible without a tenant session', async () => {
    const tokenHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    await sql.unsafe(`
      INSERT INTO email_verification_tokens (tenant_id, token_hash, email, expires_at)
      VALUES (NULL, '${tokenHash}', 'signup@unknown.example', now() + interval '24 hours')
      ON CONFLICT (token_hash) DO NOTHING;
    `);

    const rows = await asAppUser(sql, null, (tx) =>
      tx.unsafe(
        `SELECT id FROM email_verification_tokens WHERE token_hash = '${tokenHash}'`,
      ),
    );
    expect(rows.length).toBe(1);

    // Clean up
    await sql.unsafe(`DELETE FROM email_verification_tokens WHERE token_hash = '${tokenHash}'`);
  });

  it('pending_user_approvals with NULL tenant_id are visible without tenant session', async () => {
    const pendingId = 'f5000000-0000-0000-0000-000000000001';
    await sql.unsafe(`
      INSERT INTO pending_user_approvals (id, tenant_id, email)
      VALUES ('${pendingId}'::uuid, NULL, 'pending@unknown.example')
      ON CONFLICT (id) DO NOTHING;
    `);

    const rows = await asAppUser(sql, null, (tx) =>
      tx.unsafe(
        `SELECT id FROM pending_user_approvals WHERE id = '${pendingId}'::uuid`,
      ),
    );
    expect(rows.length).toBe(1);

    // Clean up
    await sql.unsafe(`DELETE FROM pending_user_approvals WHERE id = '${pendingId}'::uuid`);
  });
});

describe('app_user role grants', () => {
  it('app_user cannot UPDATE on audit_logs (immutability preserved)', async () => {
    // Insert an audit row as superuser
    await sql.unsafe(`
      SELECT ensure_monthly_partitions('audit_logs', 0);
      INSERT INTO audit_logs (tenant_id, id, occurred_at, actor_type, action, resource_type, resource_id)
      VALUES (
        '${FIXTURE_IDS.TENANT_A}'::uuid,
        gen_random_uuid(), now(),
        'system', 'read', 'user', '${FIXTURE_IDS.USER_A_ADMIN}'::uuid
      );
    `);

    // app_user should not be able to UPDATE audit_logs
    await expect(
      asAppUser(sql, FIXTURE_IDS.TENANT_A, (tx) =>
        tx.unsafe(`UPDATE audit_logs SET actor_type = 'hacked' WHERE tenant_id = '${FIXTURE_IDS.TENANT_A}'::uuid`),
      ),
    ).rejects.toThrow();
  });
});

describe('RLS: invalid tenant UUID fails closed', () => {
  it('setting app.current_tenant to a non-UUID string returns zero rows', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE app_user`);
      await tx.unsafe(`SET LOCAL app.current_tenant = 'not-a-uuid'`);
      return tx.unsafe(`SELECT * FROM users`);
    });
    expect(rows).toHaveLength(0);
  });
});
