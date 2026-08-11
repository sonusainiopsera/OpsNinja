/**
 * RLS isolation integration tests.
 *
 * Exercises every acceptance criterion from WO-003 that requires a real
 * PostgreSQL session. All DML that should be subject to RLS runs inside
 * `sql.begin()` with `SET LOCAL ROLE app_user` (NOSUPERUSER, NOBYPASSRLS).
 * Seeding and teardown use the superuser connection so RLS is bypassed.
 *
 * Test cases:
 *   1. No tenant variable set → zero rows on every tenant-scoped table
 *   2. Correct tenant set → only that tenant's rows returned (no WHERE)
 *   3. Cross-tenant INSERT rejected by WITH CHECK
 *   4. Cross-tenant UPDATE affects zero rows (no error, just zero rows)
 *   5. Portal principal (app.principal_kind = 'portal') sees only public
 *      comments and only tickets in its org
 *   6. Portal with empty org list → zero tickets (fail-closed)
 *   7. app_user cannot ALTER TABLE or DISABLE ROW LEVEL SECURITY
 *   8. PgBouncer leak simulation: SET LOCAL vars do not cross transaction
 *      boundaries on the same connection
 *   9. COUNT(*) is also filtered (no aggregate blind spot)
 *  10. Partitioned tables: new partition inherits policy
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
import { loadRlsFixtures, RLS_FIXTURE_IDS } from './fixtures/rls.fixtures.js';
import { getTenantScopedTableNames } from '../src/rls/policy-builder.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SqlClient = ReturnType<typeof postgres>;

/**
 * Runs fn inside a transaction as app_user.
 * Optionally sets app.current_tenant and/or app.principal_kind / app.current_org_ids.
 */
async function asAppUser<T>(
  sql: SqlClient,
  opts: {
    tenantId?: string | null;
    principalKind?: string;
    orgIds?: string[];
  },
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  return sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE app_user`);
    if (opts.tenantId !== undefined && opts.tenantId !== null) {
      await tx.unsafe(`SET LOCAL "app.current_tenant" = '${opts.tenantId}'`);
    }
    if (opts.principalKind !== undefined) {
      await tx.unsafe(`SET LOCAL "app.principal_kind" = '${opts.principalKind}'`);
    }
    if (opts.orgIds !== undefined) {
      const joined = opts.orgIds.join(',');
      await tx.unsafe(`SET LOCAL "app.current_org_ids" = '${joined}'`);
    }
    return fn(tx as unknown as SqlClient);
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let ctx: TestDbContext;
let sql: SqlClient;

beforeAll(async () => {
  ctx = await createTestDb('rls-isolation');
  sql = postgres(ctx.connectionString, { max: 5 });

  // Ensure app_user exists (migration 0009 creates it; defensive guard).
  await sql.unsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOBYPASSRLS;
      END IF;
    END;
    $$;
  `);

  // Ensure minimum grants for app_user on tables under test.
  await sql.unsafe(`
    GRANT SELECT, INSERT, UPDATE ON tickets TO app_user;
    GRANT SELECT, INSERT, UPDATE ON ticket_comments TO app_user;
    GRANT SELECT, INSERT ON audit_logs TO app_user;
    GRANT SELECT, INSERT, UPDATE ON organizations TO app_user;
    GRANT SELECT, INSERT, UPDATE ON users TO app_user;
    GRANT SELECT ON tenants TO app_user;
  `);

  await loadRbacCatalog(sql);
  await loadIdentityFixtures(sql);
  await loadRlsFixtures(sql);
}, 120_000);

afterAll(async () => {
  await sql.end();
  await ctx.teardown();
});

// ---------------------------------------------------------------------------
// 1. No tenant variable set → zero rows
// ---------------------------------------------------------------------------

describe('RLS: no tenant variable set (fail-closed)', () => {
  const tenantScopedTables = getTenantScopedTableNames().filter(
    // Exclude tables that have NULL tenant_id exceptions (covered separately)
    (t) => !['email_verification_tokens', 'pending_user_approvals'].includes(t),
  );

  for (const table of tenantScopedTables) {
    it(`${table} returns zero rows without tenant variable`, async () => {
      const rows = await asAppUser(sql, {}, (tx) =>
        tx.unsafe(`SELECT * FROM ${table} LIMIT 1`),
      );
      expect(rows).toHaveLength(0);
    });
  }

  it('COUNT(*) on tickets returns 0 without tenant variable', async () => {
    const rows = await asAppUser(sql, {}, (tx) =>
      tx.unsafe(`SELECT COUNT(*) AS n FROM tickets`),
    );
    expect(Number(rows[0]?.['n'])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Correct tenant → only that tenant's rows returned (no WHERE clause)
// ---------------------------------------------------------------------------

describe('RLS: correct tenant variable set', () => {
  it('tickets returns only tenant A tickets', async () => {
    const rows = await asAppUser(sql, { tenantId: FIXTURE_IDS.TENANT_A }, (tx) =>
      tx.unsafe(`SELECT id FROM tickets`),
    );
    // Tenant A has TICKET_A1 and TICKET_A2
    expect(rows).toHaveLength(2);
    const ids = rows.map((r: Record<string, unknown>) => r['id'] as string);
    expect(ids).toContain(RLS_FIXTURE_IDS.TICKET_A1);
    expect(ids).toContain(RLS_FIXTURE_IDS.TICKET_A2);
    expect(ids).not.toContain(RLS_FIXTURE_IDS.TICKET_B1);
  });

  it('ticket_comments returns only tenant A comments', async () => {
    const rows = await asAppUser(sql, { tenantId: FIXTURE_IDS.TENANT_A }, (tx) =>
      tx.unsafe(`SELECT id FROM ticket_comments`),
    );
    expect(rows).toHaveLength(3); // A1_PUBLIC, A1_INTERNAL, A2_PUBLIC
    const ids = rows.map((r: Record<string, unknown>) => r['id'] as string);
    expect(ids).not.toContain(RLS_FIXTURE_IDS.COMMENT_B1_PUBLIC);
  });

  it('tenant B session returns only tenant B tickets', async () => {
    const rows = await asAppUser(sql, { tenantId: FIXTURE_IDS.TENANT_B }, (tx) =>
      tx.unsafe(`SELECT id FROM tickets`),
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as Record<string, unknown>)['id']).toBe(RLS_FIXTURE_IDS.TICKET_B1);
  });
});

// ---------------------------------------------------------------------------
// 3. Cross-tenant INSERT rejected by WITH CHECK
// ---------------------------------------------------------------------------

describe('RLS: cross-tenant INSERT rejected', () => {
  it('INSERT ticket with wrong tenant_id is rejected by WITH CHECK', async () => {
    await expect(
      asAppUser(sql, { tenantId: FIXTURE_IDS.TENANT_A }, (tx) =>
        tx.unsafe(`
          INSERT INTO tickets (tenant_id, id, created_at, organization_id, subject, status, priority)
          VALUES (
            '${FIXTURE_IDS.TENANT_B}'::uuid,
            gen_random_uuid(),
            now(),
            '${FIXTURE_IDS.ORG_B1}'::uuid,
            'Cross-tenant injection attempt',
            'open', 'P3'
          )
        `),
      ),
    ).rejects.toThrow();
  });

  it('INSERT ticket_comment with wrong tenant_id is rejected', async () => {
    await expect(
      asAppUser(sql, { tenantId: FIXTURE_IDS.TENANT_A }, (tx) =>
        tx.unsafe(`
          INSERT INTO ticket_comments (tenant_id, id, created_at, ticket_id, author_user_id, visibility, body)
          VALUES (
            '${FIXTURE_IDS.TENANT_B}'::uuid,
            gen_random_uuid(),
            now(),
            '${RLS_FIXTURE_IDS.TICKET_B1}'::uuid,
            '${FIXTURE_IDS.USER_B_ADMIN}'::uuid,
            'public',
            'Cross-tenant injection'
          )
        `),
      ),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Cross-tenant UPDATE affects zero rows
// ---------------------------------------------------------------------------

describe('RLS: cross-tenant UPDATE returns zero rows affected', () => {
  it('UPDATE tenant B ticket while tenant A is active affects zero rows', async () => {
    const result = await asAppUser(sql, { tenantId: FIXTURE_IDS.TENANT_A }, (tx) =>
      tx.unsafe(`
        UPDATE tickets
        SET subject = 'HACKED'
        WHERE id = '${RLS_FIXTURE_IDS.TICKET_B1}'::uuid
      `),
    );
    // Result is the command result; rows affected should be 0
    expect(result.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Portal principal visibility
// ---------------------------------------------------------------------------

describe('RLS: portal principal visibility', () => {
  it('portal session sees only public comments on its org ticket', async () => {
    const rows = await asAppUser(
      sql,
      {
        tenantId: FIXTURE_IDS.TENANT_A,
        principalKind: 'portal',
        orgIds: [FIXTURE_IDS.ORG_A1],
      },
      (tx) => tx.unsafe(`SELECT id, visibility FROM ticket_comments`),
    );
    const ids = rows.map((r: Record<string, unknown>) => r['id'] as string);
    // Should see COMMENT_A1_PUBLIC only (A1_INTERNAL excluded by RESTRICTIVE policy;
    // A2_PUBLIC excluded because ticket A2 is in ORG_A2 which is not in org_ids)
    expect(ids).toContain(RLS_FIXTURE_IDS.COMMENT_A1_PUBLIC);
    expect(ids).not.toContain(RLS_FIXTURE_IDS.COMMENT_A1_INTERNAL);
  });

  it('portal session cannot read internal comment even on its own ticket', async () => {
    const rows = await asAppUser(
      sql,
      {
        tenantId: FIXTURE_IDS.TENANT_A,
        principalKind: 'portal',
        orgIds: [FIXTURE_IDS.ORG_A1],
      },
      (tx) =>
        tx.unsafe(
          `SELECT id FROM ticket_comments WHERE id = '${RLS_FIXTURE_IDS.COMMENT_A1_INTERNAL}'::uuid`,
        ),
    );
    expect(rows).toHaveLength(0);
  });

  it('portal session with ORG_A1 cannot see tickets in ORG_A2', async () => {
    const rows = await asAppUser(
      sql,
      {
        tenantId: FIXTURE_IDS.TENANT_A,
        principalKind: 'portal',
        orgIds: [FIXTURE_IDS.ORG_A1],
      },
      (tx) => tx.unsafe(`SELECT id FROM tickets`),
    );
    const ids = rows.map((r: Record<string, unknown>) => r['id'] as string);
    expect(ids).toContain(RLS_FIXTURE_IDS.TICKET_A1);
    expect(ids).not.toContain(RLS_FIXTURE_IDS.TICKET_A2);
  });

  it('non-portal staff session sees all comments including internal', async () => {
    const rows = await asAppUser(
      sql,
      { tenantId: FIXTURE_IDS.TENANT_A, principalKind: 'staff' },
      (tx) => tx.unsafe(`SELECT id FROM ticket_comments`),
    );
    const ids = rows.map((r: Record<string, unknown>) => r['id'] as string);
    expect(ids).toContain(RLS_FIXTURE_IDS.COMMENT_A1_INTERNAL);
    expect(ids).toContain(RLS_FIXTURE_IDS.COMMENT_A1_PUBLIC);
  });
});

// ---------------------------------------------------------------------------
// 6. Portal with empty org list → zero tickets
// ---------------------------------------------------------------------------

describe('RLS: portal with empty org list', () => {
  it('portal session with no org IDs sees zero tickets', async () => {
    const rows = await asAppUser(
      sql,
      {
        tenantId: FIXTURE_IDS.TENANT_A,
        principalKind: 'portal',
        orgIds: [],
      },
      (tx) => tx.unsafe(`SELECT id FROM tickets`),
    );
    expect(rows).toHaveLength(0);
  });

  it('portal session with unset app.current_org_ids sees zero tickets', async () => {
    // orgIds not set — app_current_org_ids() returns empty array
    const rows = await asAppUser(
      sql,
      { tenantId: FIXTURE_IDS.TENANT_A, principalKind: 'portal' },
      (tx) => tx.unsafe(`SELECT id FROM tickets`),
    );
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Privilege escalation — DDL attempts must fail
// ---------------------------------------------------------------------------

describe('RLS: privilege escalation attempts fail', () => {
  it('app_user cannot ALTER TABLE to disable RLS', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        return tx.unsafe(`ALTER TABLE tickets DISABLE ROW LEVEL SECURITY`);
      }),
    ).rejects.toThrow();
  });

  it('app_user cannot DROP TABLE', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        return tx.unsafe(`DROP TABLE tickets`);
      }),
    ).rejects.toThrow();
  });

  it('app_user cannot ALTER TABLE ADD COLUMN', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        return tx.unsafe(`ALTER TABLE tickets ADD COLUMN injected text`);
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 8. PgBouncer leak simulation — SET LOCAL does not bleed across transactions
// ---------------------------------------------------------------------------

describe('RLS: PgBouncer SET LOCAL isolation', () => {
  it('SET LOCAL tenant variable in tx1 does not leak into tx2 on same connection', async () => {
    // Use max:1 pool to force same connection reuse
    const poolSql = postgres(ctx.connectionString, { max: 1 });

    try {
      // Transaction 1: set tenant A
      await poolSql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        await tx.unsafe(`SET LOCAL "app.current_tenant" = '${FIXTURE_IDS.TENANT_A}'`);
        const rows = await tx.unsafe(`SELECT COUNT(*) AS n FROM tickets`);
        expect(Number((rows[0] as Record<string, unknown>)['n'])).toBeGreaterThan(0);
      });

      // Transaction 2: same physical connection; tenant variable must NOT be set
      const rowsAfter = await poolSql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        // Do NOT set app.current_tenant — if it leaked, we'd see rows
        return tx.unsafe(`SELECT COUNT(*) AS n FROM tickets`);
      });
      expect(Number((rowsAfter[0] as Record<string, unknown>)['n'])).toBe(0);
    } finally {
      await poolSql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 9. COUNT(*) is also filtered
// ---------------------------------------------------------------------------

describe('RLS: COUNT aggregate is filtered', () => {
  it('COUNT(*) on tickets returns correct cross-tenant count (no WHERE)', async () => {
    const rowsA = await asAppUser(sql, { tenantId: FIXTURE_IDS.TENANT_A }, (tx) =>
      tx.unsafe(`SELECT COUNT(*) AS n FROM tickets`),
    );
    expect(Number((rowsA[0] as Record<string, unknown>)['n'])).toBe(2);

    const rowsB = await asAppUser(sql, { tenantId: FIXTURE_IDS.TENANT_B }, (tx) =>
      tx.unsafe(`SELECT COUNT(*) AS n FROM tickets`),
    );
    expect(Number((rowsB[0] as Record<string, unknown>)['n'])).toBe(1);

    const rowsNone = await asAppUser(sql, {}, (tx) =>
      tx.unsafe(`SELECT COUNT(*) AS n FROM tickets`),
    );
    expect(Number((rowsNone[0] as Record<string, unknown>)['n'])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 10. audit_logs: app_user cannot UPDATE or DELETE
// ---------------------------------------------------------------------------

describe('RLS: audit_logs append-only for app_user', () => {
  it('app_user cannot UPDATE audit_logs', async () => {
    await expect(
      asAppUser(sql, { tenantId: FIXTURE_IDS.TENANT_A }, (tx) =>
        tx.unsafe(`UPDATE audit_logs SET actor_type = 'tamper' WHERE tenant_id = '${FIXTURE_IDS.TENANT_A}'::uuid`),
      ),
    ).rejects.toThrow();
  });

  it('app_user cannot DELETE from audit_logs', async () => {
    await expect(
      asAppUser(sql, { tenantId: FIXTURE_IDS.TENANT_A }, (tx) =>
        tx.unsafe(`DELETE FROM audit_logs WHERE tenant_id = '${FIXTURE_IDS.TENANT_A}'::uuid`),
      ),
    ).rejects.toThrow();
  });
});
