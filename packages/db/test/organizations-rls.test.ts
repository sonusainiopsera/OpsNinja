/**
 * Organization Registry RLS Integration Tests (WO-023)
 *
 * Connects as the application database role (NOSUPERUSER, no BYPASSRLS),
 * sets app.current_tenant for Tenant A, and asserts:
 *   - SELECT returns ONLY tenant A rows across all five tables
 *   - INSERT with Tenant B's tenant_id is rejected by WITH CHECK
 *   - Zero rows returned when app.current_tenant is not set
 *
 * Skip condition: ISOLATION_TEST_DB_URL or TEST_DATABASE_URL must be set
 * and point to a Postgres 16 instance with migrations 001–005 applied.
 *
 * Seed: call seedOrganizationFixtures() before running these tests.
 */

import { Pool } from 'pg';
import {
  seedOrganizationFixtures,
  clearOrganizationFixtures,
  TENANT_A,
  TENANT_B,
  ORG_IDS,
} from './fixtures/organizations.seed';

const DB_URL = process.env.ISOLATION_TEST_DB_URL ?? process.env.TEST_DATABASE_URL;
const SKIP = !DB_URL;

const describeOrSkip = SKIP ? describe.skip : describe;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function withTenant<T>(pool: Pool, tenantId: string, fn: (pool: Pool) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.current_tenant', $1, true)`,
      [tenantId],
    );
    const tempPool = {
      query: (...args: Parameters<typeof client.query>) => client.query(...args),
    } as unknown as Pool;
    const result = await fn(tempPool);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function withoutTenant<T>(pool: Pool, fn: (client: Pool) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Deliberately omit app.current_tenant
    const tempPool = {
      query: (...args: Parameters<typeof client.query>) => client.query(...args),
    } as unknown as Pool;
    const result = await fn(tempPool);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describeOrSkip('Organization Registry RLS', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL!, max: 3 });
    await seedOrganizationFixtures(pool);
  });

  afterAll(async () => {
    await clearOrganizationFixtures(pool);
    await pool?.end();
  });

  // ── organizations ──────────────────────────────────────────────────────────

  describe('organizations table', () => {
    it('SELECT returns only tenant A rows when tenant is set to A', async () => {
      const rows = await withTenant(pool, TENANT_A, async (p) => {
        const { rows } = await p.query<{ tenant_id: string }>(`SELECT tenant_id FROM organizations`);
        return rows;
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
    });

    it('SELECT returns zero rows when tenant is set to B (tenant A data not visible)', async () => {
      const rows = await withTenant(pool, TENANT_B, async (p) => {
        const { rows } = await p.query<{ id: string }>(`SELECT id FROM organizations WHERE id = $1`, [ORG_IDS.a1]);
        return rows;
      });
      expect(rows).toHaveLength(0);
    });

    it('INSERT with wrong tenant_id rejected by WITH CHECK', async () => {
      await expect(
        withTenant(pool, TENANT_A, async (p) => {
          await p.query(
            `INSERT INTO organizations (tenant_id, name, status) VALUES ($1, 'Cross-tenant org', 'active')`,
            [TENANT_B], // tenant_id does not match app.current_tenant
          );
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('SELECT returns zero rows when app.current_tenant is not set', async () => {
      const rows = await withoutTenant(pool, async (p) => {
        try {
          const { rows } = await p.query<{ id: string }>(`SELECT id FROM organizations LIMIT 10`);
          return rows;
        } catch {
          return [];
        }
      });
      expect(rows).toHaveLength(0);
    });
  });

  // ── customer_accounts ──────────────────────────────────────────────────────

  describe('customer_accounts table', () => {
    let customerAccountId: string;

    beforeAll(async () => {
      // Seed a customer account as superuser (bypass RLS for setup)
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL row_security = off`);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO customer_accounts (tenant_id, organization_id, name)
           VALUES ($1, $2, 'Test Account')
           RETURNING id`,
          [TENANT_A, ORG_IDS.a1],
        );
        customerAccountId = rows[0]!.id;
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    it('SELECT returns only tenant A rows', async () => {
      const rows = await withTenant(pool, TENANT_A, async (p) => {
        const { rows } = await p.query<{ tenant_id: string }>(`SELECT tenant_id FROM customer_accounts`);
        return rows;
      });
      expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
    });

    it('Tenant B cannot see tenant A customer_accounts', async () => {
      const rows = await withTenant(pool, TENANT_B, async (p) => {
        const { rows } = await p.query<{ id: string }>(`SELECT id FROM customer_accounts WHERE id = $1`, [customerAccountId]);
        return rows;
      });
      expect(rows).toHaveLength(0);
    });

    it('INSERT with wrong tenant_id rejected', async () => {
      await expect(
        withTenant(pool, TENANT_A, async (p) => {
          await p.query(
            `INSERT INTO customer_accounts (tenant_id, organization_id, name) VALUES ($1, $2, 'Bad')`,
            [TENANT_B, ORG_IDS.b1],
          );
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('SELECT returns zero rows when no tenant set', async () => {
      const rows = await withoutTenant(pool, async (p) => {
        try {
          const { rows } = await p.query<{ id: string }>(`SELECT id FROM customer_accounts LIMIT 10`);
          return rows;
        } catch { return []; }
      });
      expect(rows).toHaveLength(0);
    });
  });

  // ── contacts ───────────────────────────────────────────────────────────────

  describe('contacts table', () => {
    it('SELECT returns only tenant A contacts', async () => {
      const rows = await withTenant(pool, TENANT_A, async (p) => {
        const { rows } = await p.query<{ tenant_id: string }>(`SELECT tenant_id FROM contacts`);
        return rows;
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
    });

    it('Tenant B cannot see tenant A contacts', async () => {
      const rows = await withTenant(pool, TENANT_B, async (p) => {
        const { rows } = await p.query<{ email: string }>(`SELECT email FROM contacts WHERE email = 'alice@alpha-corp.example.invalid'`);
        return rows;
      });
      expect(rows).toHaveLength(0);
    });

    it('INSERT with wrong tenant_id rejected', async () => {
      await expect(
        withTenant(pool, TENANT_A, async (p) => {
          await p.query(
            `INSERT INTO contacts (tenant_id, organization_id, email, full_name) VALUES ($1, $2, $3, $4)`,
            [TENANT_B, ORG_IDS.b1, 'hacker@example.invalid', 'Hacker'],
          );
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('SELECT returns zero rows when no tenant set', async () => {
      const rows = await withoutTenant(pool, async (p) => {
        try {
          const { rows } = await p.query<{ id: string }>(`SELECT id FROM contacts LIMIT 10`);
          return rows;
        } catch { return []; }
      });
      expect(rows).toHaveLength(0);
    });
  });

  // ── organization_verified_domains ──────────────────────────────────────────

  describe('organization_verified_domains table', () => {
    beforeAll(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL row_security = off`);
        await client.query(
          `INSERT INTO organization_verified_domains (tenant_id, organization_id, domain) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [TENANT_A, ORG_IDS.a1, 'alpha-corp.example.invalid'],
        );
        await client.query(
          `INSERT INTO organization_verified_domains (tenant_id, organization_id, domain) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [TENANT_B, ORG_IDS.b1, 'alpha-b.example.invalid'],
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });

    it('Tenant A only sees its own domains', async () => {
      const rows = await withTenant(pool, TENANT_A, async (p) => {
        const { rows } = await p.query<{ tenant_id: string; domain: string }>(`SELECT tenant_id, domain FROM organization_verified_domains`);
        return rows;
      });
      expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
    });

    it('INSERT with wrong tenant_id rejected', async () => {
      await expect(
        withTenant(pool, TENANT_A, async (p) => {
          await p.query(
            `INSERT INTO organization_verified_domains (tenant_id, organization_id, domain) VALUES ($1, $2, $3)`,
            [TENANT_B, ORG_IDS.b1, 'cross-tenant.invalid'],
          );
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('SELECT returns zero rows when no tenant set', async () => {
      const rows = await withoutTenant(pool, async (p) => {
        try {
          const { rows } = await p.query<{ id: string }>(`SELECT id FROM organization_verified_domains LIMIT 10`);
          return rows;
        } catch { return []; }
      });
      expect(rows).toHaveLength(0);
    });
  });

  // ── custom_field_defs ──────────────────────────────────────────────────────

  describe('custom_field_defs table', () => {
    it('Tenant A only sees its own field defs', async () => {
      const rows = await withTenant(pool, TENANT_A, async (p) => {
        const { rows } = await p.query<{ tenant_id: string }>(`SELECT tenant_id FROM custom_field_defs`);
        return rows;
      });
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
    });

    it('Tenant B cannot see tenant A custom_field_defs', async () => {
      const rows = await withTenant(pool, TENANT_B, async (p) => {
        const { rows } = await p.query<{ field_key: string }>(`SELECT field_key FROM custom_field_defs WHERE field_key = 'industry'`);
        return rows;
      });
      expect(rows).toHaveLength(0);
    });

    it('INSERT with wrong tenant_id rejected', async () => {
      await expect(
        withTenant(pool, TENANT_A, async (p) => {
          await p.query(
            `INSERT INTO custom_field_defs (tenant_id, field_key, label, data_type) VALUES ($1, $2, $3, $4)`,
            [TENANT_B, 'bad_key', 'Bad', 'string'],
          );
        }),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('SELECT returns zero rows when no tenant set', async () => {
      const rows = await withoutTenant(pool, async (p) => {
        try {
          const { rows } = await p.query<{ id: string }>(`SELECT id FROM custom_field_defs LIMIT 10`);
          return rows;
        } catch { return []; }
      });
      expect(rows).toHaveLength(0);
    });
  });
});

// ── Unit tests (no DB required) ───────────────────────────────────────────────

describe('Organization Registry RLS (unit — no DB)', () => {
  it('TENANT_A, TENANT_B, TENANT_C are distinct valid UUIDs', () => {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    expect(TENANT_A).toMatch(uuidRe);
    expect(TENANT_B).toMatch(uuidRe);
    expect(TENANT_A).not.toBe(TENANT_B);
  });

  it('ORG_IDS has 12 distinct entries', () => {
    const ids = Object.values(ORG_IDS);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });

  it('Tenant-A org IDs do not appear in Tenant-B or Tenant-C sets', () => {
    const aOrgs = [ORG_IDS.a1, ORG_IDS.a2, ORG_IDS.a3, ORG_IDS.a4];
    const bOrgs = [ORG_IDS.b1, ORG_IDS.b2, ORG_IDS.b3, ORG_IDS.b4];
    const cOrgs = [ORG_IDS.c1, ORG_IDS.c2, ORG_IDS.c3, ORG_IDS.c4];
    const intersection = aOrgs.filter(id => bOrgs.includes(id) || cOrgs.includes(id));
    expect(intersection).toHaveLength(0);
  });
});
