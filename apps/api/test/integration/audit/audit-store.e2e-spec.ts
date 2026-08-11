/**
 * Audit store integration test suite.
 *
 * Runs against a real PostgreSQL 16 container via testcontainers to exercise:
 *   1. Schema: required columns, indexes, and partition structure.
 *   2. RLS: session bound to tenant A sees zero rows for tenant B.
 *   3. Append-only: UPDATE and DELETE from app_user role fail.
 *      BEFORE UPDATE OR DELETE trigger raises AUDIT_APPEND_ONLY_VIOLATION
 *      even for roles with grants.
 *   4. Hash chain: build 1 000 records across two monthly partitions, mutate
 *      one row as superuser, assert verifyChain() detects the first divergent ID.
 *   5. Partition maintenance: ensure_audit_partitions() is idempotent.
 *   6. Batch throughput: appendBatch of 500 records completes under 1 second.
 *   7. Fixture loader: multi-tenant seed produces 3 × 500 rows with valid chains.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { createTestDb, type TestDbContext } from '../../../../packages/db/test/harness.js';
import { AuditWriter } from '../.././../src/modules/audit/audit-writer.service.js';
import { GENESIS_HASH, computeChainHash, canonicalSerialize } from '../../../src/modules/audit/audit-hash.js';
import { loadAuditFixtures, SEED_TENANTS, RECORDS_PER_TENANT } from '../../fixtures/audit/audit-seed.js';

const TENANT_A = 'aa000000-0000-0000-0000-000000000001';
const TENANT_B = 'bb000000-0000-0000-0000-000000000002';
const ORG_A    = 'aa000000-0000-0000-0001-000000000001';
const ORG_B    = 'bb000000-0000-0000-0001-000000000002';
const ACTOR_ID = 'ac000000-0000-0000-0000-000000000001';

// Fixed timestamps that land in two different months.
const NOW       = new Date('2026-03-15T10:00:00.000Z');
const PREV_MONTH = new Date('2026-02-15T10:00:00.000Z');

let ctx: TestDbContext;
let sql: ReturnType<typeof postgres>;
let writer: AuditWriter;

beforeAll(async () => {
  ctx = await createTestDb('audit-store');
  sql = postgres(ctx.connectionString, { max: 5 });
  writer = new AuditWriter();

  // Seed test tenants.
  await sql.unsafe(`
    INSERT INTO tenants (id, name, plan_tier) VALUES
      ('${TENANT_A}', 'Audit Tenant A', 'growth'),
      ('${TENANT_B}', 'Audit Tenant B', 'starter')
    ON CONFLICT DO NOTHING;

    INSERT INTO organizations (tenant_id, id, name) VALUES
      ('${TENANT_A}', '${ORG_A}', 'Org A'),
      ('${TENANT_B}', '${ORG_B}', 'Org B')
    ON CONFLICT DO NOTHING;
  `);
}, 120_000);

afterAll(async () => {
  await sql.end();
  await ctx.teardown();
}, 30_000);

// ---------------------------------------------------------------------------
// 1. Schema invariants
// ---------------------------------------------------------------------------

describe('Schema: audit_logs columns and indexes', () => {
  it('has all required columns', async () => {
    const rows = await sql<{ column_name: string; is_nullable: string }[]>`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs'
    `;
    const cols = new Set(rows.map((r) => r.column_name));

    const required = [
      'id', 'tenant_id', 'occurred_at',
      'actor_type', 'actor_id', 'actor_display', 'actor_role',
      'action', 'resource_type', 'resource_id',
      'before_state', 'after_state', 'changed_fields',
      'source', 'trace_id', 'request_id', 'ip_hash', 'user_agent',
      'hash_prev', 'hash_self',
    ];
    for (const col of required) {
      expect(cols.has(col), `column ${col} missing`).toBe(true);
    }
  });

  it('has bytea columns for hash_prev and hash_self', async () => {
    const rows = await sql<{ column_name: string; udt_name: string }[]>`
      SELECT column_name, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs'
        AND column_name IN ('hash_prev', 'hash_self')
    `;
    for (const row of rows) {
      expect(row.udt_name, `${row.column_name} should be bytea`).toBe('bytea');
    }
  });

  it('has changed_fields as text array', async () => {
    const rows = await sql<{ udt_name: string }[]>`
      SELECT udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs'
        AND column_name = 'changed_fields'
    `;
    expect(rows[0]?.udt_name).toBe('text');
  });

  it('has all three required composite indexes', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'audit_logs' AND schemaname = 'public'
    `;
    const names = rows.map((r) => r.indexname);

    expect(names.some((n) => n.includes('tenant_time') || n.includes('tenant') && n.includes('occurred')),
      'missing (tenant_id, occurred_at) index').toBe(true);
    expect(names.some((n) => n.includes('resource')),
      'missing resource index').toBe(true);
    expect(names.some((n) => n.includes('actor')),
      'missing actor index').toBe(true);
  });

  it('is a partitioned table (relkind = p)', async () => {
    const [row] = await sql<[{ relkind: string }]>`
      SELECT relkind FROM pg_class
      WHERE relname = 'audit_logs' AND relnamespace = 'public'::regnamespace
    `;
    expect(row?.relkind).toBe('p');
  });
});

// ---------------------------------------------------------------------------
// 2. RLS isolation
// ---------------------------------------------------------------------------

describe('RLS: cross-tenant isolation', () => {
  beforeAll(async () => {
    // Insert one record for each tenant as superuser.
    await sql.begin(async (tx) => {
      await writer.appendBatch(tx as unknown as typeof sql, [
        {
          tenantId: TENANT_A,
          actorType: 'user',
          actorId: ACTOR_ID,
          action: 'create',
          resourceType: 'ticket',
          resourceId: 'ee000000-0000-0000-0000-000000000001',
          source: 'api',
          occurredAt: NOW,
        },
        {
          tenantId: TENANT_A,
          actorType: 'user',
          actorId: ACTOR_ID,
          action: 'update',
          resourceType: 'ticket',
          resourceId: 'ee000000-0000-0000-0000-000000000001',
          source: 'api',
          occurredAt: new Date(NOW.getTime() + 1000),
        },
      ]);
    });

    await sql.begin(async (tx) => {
      await writer.appendBatch(tx as unknown as typeof sql, [{
        tenantId: TENANT_B,
        actorType: 'system',
        action: 'create',
        resourceType: 'organization',
        resourceId: ORG_B,
        source: 'worker',
        occurredAt: NOW,
      }]);
    });
  });

  it('session bound to tenant A returns zero rows for tenant B', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${TENANT_A}'`);
      await tx.unsafe(`SET LOCAL ROLE app_user`);
      return tx<{ id: string }[]>`
        SELECT id FROM audit_logs WHERE tenant_id = ${TENANT_B}::uuid
      `;
    });
    expect(rows).toHaveLength(0);
  });

  it('session bound to tenant A sees its own rows', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL app.current_tenant = '${TENANT_A}'`);
      await tx.unsafe(`SET LOCAL ROLE app_user`);
      return tx<{ id: string }[]>`
        SELECT id FROM audit_logs WHERE tenant_id = ${TENANT_A}::uuid
      `;
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('no tenant set → zero rows visible (deny-by-default)', async () => {
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE app_user`);
      return tx<{ id: string }[]>`SELECT id FROM audit_logs`;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Append-only enforcement
// ---------------------------------------------------------------------------

describe('Append-only: UPDATE and DELETE rejected', () => {
  let insertedId: string;

  beforeAll(async () => {
    const [row] = await sql<[{ id: string }]>`
      INSERT INTO audit_logs (
        tenant_id, id, occurred_at, actor_type, action, resource_type, resource_id
      ) VALUES (
        ${TENANT_A}::uuid, gen_random_uuid(), ${NOW.toISOString()}::timestamptz,
        'system', 'test_action', 'ticket', gen_random_uuid()
      ) RETURNING id
    `;
    if (!row) throw new Error('Insert failed');
    insertedId = row.id;
  });

  it('UPDATE from app_user raises exception', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        await tx.unsafe(
          `UPDATE audit_logs SET source = 'tampered' WHERE id = '${insertedId}'`,
        );
      }),
    ).rejects.toThrow();
  });

  it('DELETE from app_user raises exception', async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        await tx.unsafe(
          `DELETE FROM audit_logs WHERE id = '${insertedId}'`,
        );
      }),
    ).rejects.toThrow();
  });

  it('trigger raises exception even for superuser (BEFORE trigger)', async () => {
    await expect(
      sql.begin(async (tx) => {
        // Superuser bypasses RLS but NOT a BEFORE trigger.
        await tx.unsafe(
          `UPDATE audit_logs SET source = 'tampered' WHERE id = '${insertedId}'`,
        );
      }),
    ).rejects.toThrow(/append-only/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Hash chain: build chain, mutate, detect via verifyChain()
// ---------------------------------------------------------------------------

describe('Hash chain: build across partitions and detect tampering', () => {
  const CHAIN_TENANT = 'cc000000-0000-0000-0000-000000000001';
  const CHAIN_ORG    = 'cc000000-0000-0000-0001-000000000001';
  const RESOURCE_ID  = 'dd000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    await sql.unsafe(`
      INSERT INTO tenants (id, name, plan_tier)
      VALUES ('${CHAIN_TENANT}', 'Chain Tenant', 'enterprise')
      ON CONFLICT DO NOTHING;
      INSERT INTO organizations (tenant_id, id, name)
      VALUES ('${CHAIN_TENANT}', '${CHAIN_ORG}', 'Chain Org')
      ON CONFLICT DO NOTHING;
    `);
  });

  it('builds a 50-record chain across two months and verifyChain() passes', async () => {
    const records: Parameters<AuditWriter['appendBatch']>[1] = [];
    for (let i = 0; i < 50; i++) {
      // Alternate months to test cross-partition chain.
      const occurredAt = i % 2 === 0 ? new Date(NOW.getTime() + i * 1000) : new Date(PREV_MONTH.getTime() + i * 1000);
      records.push({
        tenantId: CHAIN_TENANT,
        actorType: 'user',
        actorId: ACTOR_ID,
        action: 'update',
        resourceType: 'ticket',
        resourceId: RESOURCE_ID,
        source: 'api',
        traceId: `trace-chain-${i}`,
        occurredAt,
      });
    }

    // Insert all 50 records in a single batch so appendBatch's internal sort
    // produces a consistent time-ordered chain across both monthly partitions.
    await sql.begin(async (tx) => {
      await writer.appendBatch(tx as unknown as typeof sql, records);
    });

    const minDate = new Date(Math.min(NOW.getTime(), PREV_MONTH.getTime()) - 60_000);
    const maxDate = new Date(Math.max(NOW.getTime(), PREV_MONTH.getTime()) + 60_000);

    const result = await writer.verifyChain(sql, CHAIN_TENANT, minDate, maxDate);
    expect(result.ok).toBe(true);
    expect(result.checkedCount).toBe(50);
  });

  it('verifyChain() detects a tampered row injected as superuser', async () => {
    // Get the first record in the chain.
    const [firstRow] = await sql<[{ id: string; hash_self: Buffer }?]>`
      SELECT id, hash_self
      FROM audit_logs
      WHERE tenant_id = ${CHAIN_TENANT}::uuid
      ORDER BY occurred_at ASC, id ASC
      LIMIT 1
    `;
    if (!firstRow) throw new Error('No chain rows found');

    // Tamper via direct pg update using session_replication_role = 'replica'
    // which disables all triggers for the session (requires superuser).
    // This simulates a compromised DBA or a direct DB attack.
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL session_replication_role = 'replica'`);
      await tx.unsafe(
        `UPDATE audit_logs SET action = 'TAMPERED' WHERE id = '${firstRow.id}'`,
      );
    });

    const minDate = new Date(Math.min(NOW.getTime(), PREV_MONTH.getTime()) - 60_000);
    const maxDate = new Date(Math.max(NOW.getTime(), PREV_MONTH.getTime()) + 60_000);

    const result = await writer.verifyChain(sql, CHAIN_TENANT, minDate, maxDate);
    expect(result.ok).toBe(false);
    expect(result.firstDivergentId).toBe(firstRow.id);
  });
});

// ---------------------------------------------------------------------------
// 5. Partition maintenance: idempotency
// ---------------------------------------------------------------------------

describe('Partition maintenance: ensure_audit_partitions()', () => {
  it('is idempotent when called twice', async () => {
    await expect(sql`SELECT ensure_audit_partitions(3)`).resolves.toBeDefined();
    await expect(sql`SELECT ensure_audit_partitions(3)`).resolves.toBeDefined();
  });

  it('creates current-month partition', async () => {
    const [row] = await sql<[{ exists: boolean }]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'audit_logs_' || to_char(CURRENT_DATE, 'YYYY_MM')
      ) AS exists
    `;
    expect(row?.exists).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Batch throughput: 500 records in under 1 second
// ---------------------------------------------------------------------------

describe('Throughput: appendBatch of 500 records', () => {
  const THROUGHPUT_TENANT = 'ee000000-0000-0000-0000-000000000001';
  const THROUGHPUT_ORG    = 'ee000000-0000-0000-0001-000000000001';

  beforeAll(async () => {
    await sql.unsafe(`
      INSERT INTO tenants (id, name, plan_tier)
      VALUES ('${THROUGHPUT_TENANT}', 'Throughput Tenant', 'enterprise')
      ON CONFLICT DO NOTHING;
      INSERT INTO organizations (tenant_id, id, name)
      VALUES ('${THROUGHPUT_TENANT}', '${THROUGHPUT_ORG}', 'Throughput Org')
      ON CONFLICT DO NOTHING;
    `);
  });

  it('inserts 500 records in under 1 000 ms', async () => {
    const records: Parameters<AuditWriter['appendBatch']>[1] = [];
    for (let i = 0; i < 500; i++) {
      records.push({
        tenantId: THROUGHPUT_TENANT,
        actorType: 'system',
        action: 'create',
        resourceType: 'ticket',
        resourceId: `ff${i.toString().padStart(6, '0')}-0000-0000-0000-000000000001`,
        source: 'worker',
        occurredAt: new Date(NOW.getTime() + i * 100),
      });
    }

    const start = Date.now();
    await sql.begin(async (tx) => {
      await writer.appendBatch(tx as unknown as typeof sql, records);
    });
    const elapsed = Date.now() - start;

    const count = await sql<[{ cnt: string }]>`
      SELECT count(*)::text AS cnt FROM audit_logs
      WHERE tenant_id = ${THROUGHPUT_TENANT}::uuid
    `;
    expect(Number(count[0]?.cnt ?? 0)).toBe(500);
    expect(elapsed, `Batch took ${elapsed}ms, expected < 1000ms`).toBeLessThan(1_000);
  });
});

// ---------------------------------------------------------------------------
// 7. Fixture loader: multi-tenant seed
// ---------------------------------------------------------------------------

describe('Fixture loader: loadAuditFixtures', () => {
  beforeAll(async () => {
    // Insert seed tenants and records via the fixture generator.
    await loadAuditFixtures(sql as unknown as ReturnType<typeof import('postgres').default>);
  }, 60_000);

  it('loads 500 records per seed tenant (3 tenants total = 1 500 records)', async () => {
    for (const tenantId of SEED_TENANTS) {
      const [row] = await sql<[{ cnt: string }]>`
        SELECT count(*)::text AS cnt FROM audit_logs
        WHERE tenant_id = ${tenantId}::uuid
      `;
      expect(Number(row?.cnt ?? 0)).toBe(RECORDS_PER_TENANT);
    }
  });

  it('all seed records have non-null hash_self', async () => {
    for (const tenantId of SEED_TENANTS) {
      const [row] = await sql<[{ cnt: string }]>`
        SELECT count(*)::text AS cnt FROM audit_logs
        WHERE tenant_id = ${tenantId}::uuid AND hash_self IS NULL
      `;
      expect(Number(row?.cnt ?? 0)).toBe(0);
    }
  });

  it('verifyChain passes for each seed tenant', async () => {
    const from = new Date('2020-01-01T00:00:00Z');
    const to   = new Date('2030-12-31T23:59:59Z');

    for (const tenantId of SEED_TENANTS) {
      const result = await writer.verifyChain(sql, tenantId, from, to);
      expect(result.ok, `chain broken for ${tenantId}: first divergent ${result.firstDivergentId}`).toBe(true);
      expect(result.checkedCount).toBe(RECORDS_PER_TENANT);
    }
  }, 60_000);
});
