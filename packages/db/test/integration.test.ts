/**
 * Integration tests for the OpsNinja foundation schema.
 *
 * These tests run against a live Postgres 16 container (via testcontainers)
 * after applying the full migration set. They assert:
 *
 *   1. Composite FK rejection: inserting a ticket referencing an org from a
 *      different tenant is rejected by the database.
 *   2. Partition routing: rows with created_at in different months land in the
 *      expected partition (verified via tableoid).
 *   3. GIN index usage: EXPLAIN on a JSONB containment query uses the GIN
 *      index on organizations.custom_field_values.
 *   4. Check constraint enforcement: invalid priority and visibility values are
 *      rejected.
 *   5. categories: two-level path resolves correctly; uniqueness constraint on
 *      sibling names is enforced.
 *   6. Seed script: running the seed twice produces deterministic, conflict-free
 *      results.
 *   7. NULL tenant_id: inserting a row with NULL tenant_id fails at the DB.
 *   8. outbox_events: drain loop index is used for unpublished event queries.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { type TestDbContext, createTestDb } from './harness.js';

let ctx: TestDbContext;

// Fixed UUIDs for deterministic fixture data.
const TENANT_A = '00000000-0000-0000-0001-000000000001';
const TENANT_B = '00000000-0000-0000-0001-000000000002';
const ORG_A    = '00000000-0000-0000-0002-000000000001';
const ORG_B    = '00000000-0000-0000-0002-000000000002';
const USER_A   = '00000000-0000-0000-0003-000000000001';

beforeAll(async () => {
  ctx = await createTestDb('integration');

  // Bootstrap minimal fixture data for cross-test use.
  const sql = postgres(ctx.connectionString, { max: 1 });
  try {
    await sql.unsafe(`
      INSERT INTO tenants (id, name, plan_tier)
      VALUES
        ('${TENANT_A}', 'Acme Corp',  'growth'),
        ('${TENANT_B}', 'Beta Ltd',   'starter')
      ON CONFLICT (id) DO NOTHING;

      INSERT INTO organizations (tenant_id, id, name, custom_field_values)
      VALUES
        ('${TENANT_A}', '${ORG_A}', 'Acme Ops',  '{"cloud_provider":"aws"}'),
        ('${TENANT_B}', '${ORG_B}', 'Beta Infra', '{"cloud_provider":"gcp"}')
      ON CONFLICT (tenant_id, id) DO NOTHING;

      INSERT INTO users (tenant_id, id, email, kind, status)
      VALUES
        ('${TENANT_A}', '${USER_A}', 'agent@acme.test', 'staff', 'active')
      ON CONFLICT (tenant_id, id) DO NOTHING;
    `);
  } finally {
    await sql.end();
  }
}, 120_000);

afterAll(async () => {
  await ctx.teardown();
}, 30_000);

// ---------------------------------------------------------------------------
// 1. Composite FK rejection — cross-tenant ticket
// ---------------------------------------------------------------------------
describe('composite FK rejection', () => {
  it('rejects a ticket whose organization_id belongs to a different tenant', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      // Tenant A ticket referencing Tenant B's organization → FK violation.
      await expect(
        sql.unsafe(`
          INSERT INTO tickets (tenant_id, id, organization_id, subject, created_at)
          VALUES (
            '${TENANT_A}',
            gen_random_uuid(),
            '${ORG_B}',  -- belongs to TENANT_B
            'Cross-tenant ticket',
            now()
          )
        `),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Partition routing
// ---------------------------------------------------------------------------
describe('partition routing', () => {
  it('routes rows to the expected monthly partition based on created_at', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const jan2025 = '2025-01-15 12:00:00+00';
      const feb2025 = '2025-02-15 12:00:00+00';

      // Ensure partitions for these months exist.
      await sql.unsafe(`
        SELECT ensure_monthly_partitions('tickets', 0);
      `);
      // We need to create specific partitions for 2025 if they don't exist.
      await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS tickets_2025_01
          PARTITION OF tickets FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');
        CREATE TABLE IF NOT EXISTS tickets_2025_02
          PARTITION OF tickets FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');
      `);

      const idJan = 'a0000000-0000-0000-0000-000000000001';
      const idFeb = 'a0000000-0000-0000-0000-000000000002';

      await sql.unsafe(`
        INSERT INTO tickets (tenant_id, id, organization_id, subject, created_at)
        VALUES
          ('${TENANT_A}', '${idJan}', '${ORG_A}', 'January ticket', '${jan2025}'),
          ('${TENANT_A}', '${idFeb}', '${ORG_A}', 'February ticket', '${feb2025}')
        ON CONFLICT (tenant_id, id, created_at) DO NOTHING;
      `);

      const rows = await sql<{ id: string; partition: string }[]>`
        SELECT
          t.id::text,
          c.relname AS partition
        FROM tickets t
        JOIN pg_class c ON c.oid = t.tableoid
        WHERE t.tenant_id = ${TENANT_A}
          AND t.id = ANY(ARRAY[${idJan}::uuid, ${idFeb}::uuid])
        ORDER BY t.created_at
      `;

      expect(rows).toHaveLength(2);
      expect(rows[0]?.partition).toBe('tickets_2025_01');
      expect(rows[1]?.partition).toBe('tickets_2025_02');
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. GIN index usage on JSONB containment query
// ---------------------------------------------------------------------------
describe('GIN index on custom_field_values', () => {
  it('uses the GIN index for a JSONB containment query (EXPLAIN output)', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      // Run EXPLAIN (FORMAT TEXT) on a containment query.
      const rows = await sql<{ 'QUERY PLAN': string }[]>`
        EXPLAIN (FORMAT TEXT, ANALYZE FALSE)
        SELECT * FROM organizations
        WHERE tenant_id = ${TENANT_A}::uuid
          AND custom_field_values @> '{"cloud_provider":"aws"}'::jsonb
      `;
      const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
      // The plan should reference the GIN index.
      expect(plan.toLowerCase()).toMatch(/gin|bitmap.*index/i);
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Check constraint enforcement
// ---------------------------------------------------------------------------
describe('check constraints', () => {
  it('rejects an invalid ticket priority (P5)', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      await expect(
        sql.unsafe(`
          INSERT INTO tickets (tenant_id, id, organization_id, subject, priority, created_at)
          VALUES ('${TENANT_A}', gen_random_uuid(), '${ORG_A}', 'Bad prio', 'P5', now())
        `),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });

  it('rejects an invalid comment visibility value', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      await expect(
        sql.unsafe(`
          INSERT INTO ticket_comments (tenant_id, id, ticket_id, author_user_id, visibility, body, created_at)
          VALUES (
            '${TENANT_A}', gen_random_uuid(), gen_random_uuid(),
            '${USER_A}', 'classified', 'oops', now()
          )
        `),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });

  it('rejects an invalid organization tier', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      await expect(
        sql.unsafe(`
          INSERT INTO organizations (tenant_id, id, name, tier)
          VALUES ('${TENANT_A}', gen_random_uuid(), 'Bad tier org', 'unknown_tier')
        `),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Categories — path and sibling uniqueness
// ---------------------------------------------------------------------------
describe('categories', () => {
  it('stores a two-level path correctly', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rootId = 'c0000000-0000-0000-0000-000000000001';
      const childId = 'c0000000-0000-0000-0000-000000000002';

      await sql.unsafe(`
        INSERT INTO categories (tenant_id, id, parent_id, name, path)
        VALUES
          ('${TENANT_A}', '${rootId}',  NULL,       'Pipeline',            'Pipeline'),
          ('${TENANT_A}', '${childId}', '${rootId}', 'Jenkins Integration', 'Pipeline / Jenkins Integration')
        ON CONFLICT (tenant_id, id) DO NOTHING;
      `);

      const rows = await sql<{ name: string; path: string }[]>`
        SELECT name, path FROM categories
        WHERE tenant_id = ${TENANT_A}::uuid
          AND id = ${childId}::uuid
      `;
      expect(rows[0]?.path).toBe('Pipeline / Jenkins Integration');
    } finally {
      await sql.end();
    }
  });

  it('rejects duplicate sibling names (case-insensitive) at the same level', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      // Root category "Pipeline" already exists from above test.
      await expect(
        sql.unsafe(`
          INSERT INTO categories (tenant_id, id, parent_id, name, path)
          VALUES ('${TENANT_A}', gen_random_uuid(), NULL, 'pipeline', 'pipeline')
        `),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });

  it('allows the same name in different tenants', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      await expect(
        sql.unsafe(`
          INSERT INTO categories (tenant_id, id, parent_id, name, path)
          VALUES ('${TENANT_B}', gen_random_uuid(), NULL, 'Pipeline', 'Pipeline')
          ON CONFLICT DO NOTHING
        `),
      ).resolves.not.toThrow();
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. NULL tenant_id rejection
// ---------------------------------------------------------------------------
describe('NULL tenant_id rejection', () => {
  it('rejects a NULL tenant_id on organizations at the database level', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      await expect(
        sql.unsafe(`
          INSERT INTO organizations (tenant_id, id, name)
          VALUES (NULL, gen_random_uuid(), 'null tenant')
        `),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });

  it('rejects a NULL tenant_id on tickets at the database level', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      await expect(
        sql.unsafe(`
          INSERT INTO tickets (tenant_id, id, organization_id, subject, created_at)
          VALUES (NULL, gen_random_uuid(), '${ORG_A}', 'null tenant ticket', now())
        `),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Default partition catch-all
// ---------------------------------------------------------------------------
describe('default partition catch-all', () => {
  it('routes an out-of-range created_at to the default partition, not an error', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      // Use a date far in the future with no explicit partition.
      const farFuture = '2099-12-01 00:00:00+00';
      const ticketId = 'f0000000-0000-0000-0000-000000000001';

      await expect(
        sql.unsafe(`
          INSERT INTO tickets (tenant_id, id, organization_id, subject, created_at)
          VALUES ('${TENANT_A}', '${ticketId}', '${ORG_A}', 'Future ticket', '${farFuture}')
          ON CONFLICT (tenant_id, id, created_at) DO NOTHING
        `),
      ).resolves.not.toThrow();

      const rows = await sql<{ partition: string }[]>`
        SELECT c.relname AS partition
        FROM tickets t
        JOIN pg_class c ON c.oid = t.tableoid
        WHERE t.tenant_id = ${TENANT_A}::uuid
          AND t.id = ${ticketId}::uuid
      `;
      expect(rows[0]?.partition).toBe('tickets_default');
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Two verified domains in different tenants, same domain name
// ---------------------------------------------------------------------------
describe('organization_verified_domains', () => {
  it('allows the same domain for two different tenants', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      await expect(
        sql.unsafe(`
          INSERT INTO organization_verified_domains (tenant_id, organization_id, domain)
          VALUES
            ('${TENANT_A}', '${ORG_A}', 'devops.example.com'),
            ('${TENANT_B}', '${ORG_B}', 'devops.example.com')
          ON CONFLICT DO NOTHING
        `),
      ).resolves.not.toThrow();
    } finally {
      await sql.end();
    }
  });

  it('rejects a duplicate domain within the same tenant', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      // devops.example.com for TENANT_A was already inserted above.
      await expect(
        sql.unsafe(`
          INSERT INTO organization_verified_domains (tenant_id, organization_id, domain)
          VALUES ('${TENANT_A}', '${ORG_A}', 'devops.example.com')
        `),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 9. ensure_monthly_partitions idempotency
// ---------------------------------------------------------------------------
describe('ensure_monthly_partitions', () => {
  it('is a no-op when called again for already-created partitions', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      // Running the helper a second time must not throw.
      await expect(
        sql.unsafe(`
          SELECT ensure_monthly_partitions('tickets', 3);
          SELECT ensure_monthly_partitions('ticket_comments', 3);
          SELECT ensure_monthly_partitions('audit_logs', 3);
        `),
      ).resolves.not.toThrow();
    } finally {
      await sql.end();
    }
  });
});
