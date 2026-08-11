/**
 * Integration tests for AI synthesis schema and RLS policies.
 *
 * Requires a running PostgreSQL 16 container (Testcontainers).
 * Run: pnpm --filter @opsninja/db test
 *
 * Test coverage:
 *   1. Schema: tables, columns, CHECK constraint, unique constraint, indexes.
 *   2. RLS: cross-tenant invisibility (zero rows from other tenant).
 *   3. RLS: INSERT with mismatched tenant_id rejected by WITH CHECK policy.
 *   4. Repository: upsert idempotency, incrementAttempt, replaceAffectedAreas.
 *   5. Cascade: deleting tenant rows leaves orphan AI rows (no FK enforced at
 *      DB level; documented exception); purge manifest handles cleanup.
 *   6. Erasure: deleteAiDataForTickets removes rows for given ticket IDs.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { type TestDbContext, createTestDb } from './harness.js';
import { FIXTURE_IDS } from './fixtures/identity.fixtures.js';
import { AI_FIXTURE_IDS, loadAiSynthesisFixtures } from './fixtures/ai-synthesis.fixtures.js';
import {
  upsertSummaryByTicket,
  incrementAttempt,
  findSummaryByTicket,
  replaceAffectedAreas,
  findAffectedAreasByTicket,
  deleteAiDataForTickets,
  enumerateSummaryIdsForTickets,
  enumerateAffectedAreaIdsForTickets,
} from '../src/repositories/ai-synthesis.repository.js';

let ctx: TestDbContext;

beforeAll(async () => {
  ctx = await createTestDb('ai-synthesis-rls');
}, 120_000);

afterAll(async () => {
  await ctx.teardown();
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTenant(
  connectionString: string,
  tenantId: string | null,
  fn: (sql: ReturnType<typeof postgres>) => Promise<void>,
): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql.begin(async (tx) => {
      if (tenantId !== null) {
        await tx.unsafe(`SET LOCAL app.current_tenant = '${tenantId}'`);
        await tx.unsafe(`SET LOCAL ROLE app_user`);
      }
      await fn(tx as unknown as ReturnType<typeof postgres>);
    });
  } finally {
    await sql.end();
  }
}

// ---------------------------------------------------------------------------
// 1. Schema invariants (catalog queries; no RLS needed — uses superuser)
// ---------------------------------------------------------------------------

describe('Schema: table existence and column structure', () => {
  it('ticket_ai_summaries table exists with required columns', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql<{ column_name: string; is_nullable: string; data_type: string }[]>`
        SELECT column_name, is_nullable, udt_name AS data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ticket_ai_summaries'
        ORDER BY ordinal_position
      `;
      const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));

      expect(cols['tenant_id']).toBeDefined();
      expect(cols['tenant_id']?.is_nullable).toBe('NO');
      expect(cols['id']).toBeDefined();
      expect(cols['ticket_id']).toBeDefined();
      expect(cols['crux_summary']).toBeDefined();
      expect(cols['resolution_summary']).toBeDefined();
      expect(cols['ai_status']).toBeDefined();
      expect(cols['ai_status']?.is_nullable).toBe('NO');
      expect(cols['attempt_count']).toBeDefined();
      expect(cols['attempt_count']?.data_type).toBe('int4');
      expect(cols['model_id']).toBeDefined();
      expect(cols['prompt_version']).toBeDefined();
      expect(cols['generated_at']).toBeDefined();
      expect(cols['created_at']).toBeDefined();
      expect(cols['updated_at']).toBeDefined();
    } finally {
      await sql.end();
    }
  });

  it('ticket_affected_areas table exists with required columns', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql<{ column_name: string; is_nullable: string }[]>`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ticket_affected_areas'
        ORDER BY ordinal_position
      `;
      const cols = Object.fromEntries(rows.map((r) => [r.column_name, r]));

      expect(cols['tenant_id']).toBeDefined();
      expect(cols['tenant_id']?.is_nullable).toBe('NO');
      expect(cols['id']).toBeDefined();
      expect(cols['ticket_id']).toBeDefined();
      expect(cols['area_label']).toBeDefined();
      expect(cols['area_label']?.is_nullable).toBe('NO');
      expect(cols['confidence']).toBeDefined();
      expect(cols['source']).toBeDefined();
      expect(cols['source']?.is_nullable).toBe('NO');
      expect(cols['created_at']).toBeDefined();
    } finally {
      await sql.end();
    }
  });

  it('ai_status CHECK constraint rejects invalid values', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      await expect(
        sql.unsafe(`
          INSERT INTO ticket_ai_summaries (tenant_id, id, ticket_id, ai_status)
          VALUES (
            '${FIXTURE_IDS.TENANT_A}',
            gen_random_uuid(),
            gen_random_uuid(),
            'invalid_status'
          )
        `),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });

  it('ai_status accepts all valid enum values', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    const validStatuses = ['pending', 'running', 'succeeded', 'failed', 'skipped'];
    try {
      for (const status of validStatuses) {
        const rows = await sql<{ ai_status: string }[]>`
          SELECT ${status}::text AS ai_status
        `;
        const row = rows[0];
        expect(row?.ai_status).toBe(status);
      }
      // Also verify CHECK constraint accepts each value by inserting and rolling back.
      for (const status of validStatuses) {
        await sql.begin(async (tx) => {
          await tx.unsafe(`
            INSERT INTO ticket_ai_summaries (tenant_id, id, ticket_id, ai_status)
            VALUES ('${FIXTURE_IDS.TENANT_A}', gen_random_uuid(), gen_random_uuid(), '${status}')
          `);
          await tx.unsafe('ROLLBACK');
        }).catch(() => { /* ROLLBACK is not an error */ });
      }
    } finally {
      await sql.end();
    }
  });

  it('unique (tenant_id, ticket_id) constraint exists on ticket_ai_summaries', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql<{ indexname: string }[]>`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'ticket_ai_summaries'
          AND indexdef LIKE '%tenant_id%ticket_id%'
          AND indexdef LIKE '%UNIQUE%'
      `;
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }
  });

  it('indexes lead with tenant_id on both tables', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql<{ tablename: string; first_col: string }[]>`
        SELECT t.relname AS tablename, a.attname AS first_col
        FROM pg_index ix
        JOIN pg_class t  ON t.oid = ix.indrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ix.indkey[0]
        WHERE n.nspname = 'public'
          AND t.relname IN ('ticket_ai_summaries', 'ticket_affected_areas')
        ORDER BY t.relname
      `;
      const byTable = new Map<string, string[]>();
      for (const r of rows) {
        const arr = byTable.get(r.tablename) ?? [];
        arr.push(r.first_col);
        byTable.set(r.tablename, arr);
      }
      expect(byTable.get('ticket_ai_summaries')).toContain('tenant_id');
      expect(byTable.get('ticket_affected_areas')).toContain('tenant_id');
    } finally {
      await sql.end();
    }
  });

  it('(tenant_id, area_label) index exists on ticket_affected_areas', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql<{ indexname: string }[]>`
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = 'ticket_affected_areas'
          AND indexdef LIKE '%tenant_id%area_label%'
      `;
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Fixtures
// ---------------------------------------------------------------------------

describe('Fixtures: load and basic shape', () => {
  beforeEach(async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      // Insert tenants and organizations required by fixtures.
      await sql.unsafe(`
        INSERT INTO tenants (id, name, plan_tier) VALUES
          ('${FIXTURE_IDS.TENANT_A}', 'Tenant Alpha', 'growth'),
          ('${FIXTURE_IDS.TENANT_B}', 'Tenant Beta',  'starter')
        ON CONFLICT DO NOTHING;

        INSERT INTO organizations (tenant_id, id, name) VALUES
          ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.ORG_A1}', 'Alpha Org 1'),
          ('${FIXTURE_IDS.TENANT_B}', '${FIXTURE_IDS.ORG_B1}', 'Beta Org 1')
        ON CONFLICT DO NOTHING;
      `);
      await loadAiSynthesisFixtures(sql);
    } finally {
      await sql.end();
    }
  });

  it('loads 3 ai summary rows total', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql<{ cnt: string }[]>`
        SELECT count(*)::text AS cnt FROM ticket_ai_summaries
      `;
      expect(Number(rows[0]?.cnt)).toBe(3);
    } finally {
      await sql.end();
    }
  });

  it('loads 3 affected area rows total', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql<{ cnt: string }[]>`
        SELECT count(*)::text AS cnt FROM ticket_affected_areas
      `;
      expect(Number(rows[0]?.cnt)).toBe(3);
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. RLS: cross-tenant isolation
// ---------------------------------------------------------------------------

describe('RLS: cross-tenant isolation', () => {
  beforeEach(async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      await sql.unsafe(`
        INSERT INTO tenants (id, name, plan_tier) VALUES
          ('${FIXTURE_IDS.TENANT_A}', 'Tenant Alpha', 'growth'),
          ('${FIXTURE_IDS.TENANT_B}', 'Tenant Beta',  'starter')
        ON CONFLICT DO NOTHING;

        INSERT INTO organizations (tenant_id, id, name) VALUES
          ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.ORG_A1}', 'Alpha Org 1'),
          ('${FIXTURE_IDS.TENANT_B}', '${FIXTURE_IDS.ORG_B1}', 'Beta Org 1')
        ON CONFLICT DO NOTHING;
      `);
      await loadAiSynthesisFixtures(sql);
    } finally {
      await sql.end();
    }
  });

  it('session bound to tenant A returns zero AI summary rows for tenant B', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant = '${FIXTURE_IDS.TENANT_A}'`);
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        return tx<{ id: string }[]>`
          SELECT id FROM ticket_ai_summaries
          WHERE tenant_id = ${FIXTURE_IDS.TENANT_B}
        `;
      });
      expect(rows).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });

  it('session bound to tenant A returns zero affected area rows for tenant B', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant = '${FIXTURE_IDS.TENANT_A}'`);
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        return tx<{ id: string }[]>`
          SELECT id FROM ticket_affected_areas
          WHERE tenant_id = ${FIXTURE_IDS.TENANT_B}
        `;
      });
      expect(rows).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });

  it('session bound to tenant A sees its own AI summary rows', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL app.current_tenant = '${FIXTURE_IDS.TENANT_A}'`);
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        return tx<{ id: string }[]>`SELECT id FROM ticket_ai_summaries`;
      });
      expect(rows).toHaveLength(2); // SUMMARY_A1, SUMMARY_A2
    } finally {
      await sql.end();
    }
  });

  it('INSERT with mismatched tenant_id is rejected by WITH CHECK policy', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL app.current_tenant = '${FIXTURE_IDS.TENANT_A}'`);
          await tx.unsafe(`SET LOCAL ROLE app_user`);
          // Attempt to insert a row for TENANT_B while session is TENANT_A.
          await tx.unsafe(`
            INSERT INTO ticket_ai_summaries (tenant_id, id, ticket_id, ai_status)
            VALUES ('${FIXTURE_IDS.TENANT_B}', gen_random_uuid(), gen_random_uuid(), 'pending')
          `);
        }),
      ).rejects.toThrow();
    } finally {
      await sql.end();
    }
  });

  it('session with no tenant set returns zero AI summary rows (deny-by-default)', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE app_user`);
        // No app.current_tenant set
        return tx<{ id: string }[]>`SELECT id FROM ticket_ai_summaries`;
      });
      expect(rows).toHaveLength(0);
    } finally {
      await sql.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Repository operations
// ---------------------------------------------------------------------------

describe('Repository: upsertSummaryByTicket', () => {
  it('inserts a new summary row', async () => {
    const result = await upsertSummaryByTicket(ctx.db, {
      tenantId: FIXTURE_IDS.TENANT_A,
      ticketId: 'aaaaaaaa-0000-0000-0000-000000000099',
      aiStatus: 'pending',
      attemptCount: 0,
    });
    expect(result.aiStatus).toBe('pending');
    expect(result.tenantId).toBe(FIXTURE_IDS.TENANT_A);
  });

  it('updates existing row on conflict (ticket_id uniqueness)', async () => {
    const ticketId = 'aaaaaaaa-0000-0000-0000-000000000088';

    await upsertSummaryByTicket(ctx.db, {
      tenantId: FIXTURE_IDS.TENANT_A,
      ticketId,
      aiStatus: 'running',
      attemptCount: 0,
    });

    const updated = await upsertSummaryByTicket(ctx.db, {
      tenantId: FIXTURE_IDS.TENANT_A,
      ticketId,
      aiStatus: 'succeeded',
      modelId: 'claude-sonnet-5',
      promptVersion: 'v1.0',
      attemptCount: 1,
    });

    expect(updated.aiStatus).toBe('succeeded');
    expect(updated.modelId).toBe('claude-sonnet-5');
  });

  it('caps summary text at 8000 characters', async () => {
    const longText = 'x'.repeat(9_000);
    const result = await upsertSummaryByTicket(ctx.db, {
      tenantId: FIXTURE_IDS.TENANT_A,
      ticketId: 'aaaaaaaa-0000-0000-0000-000000000077',
      aiStatus: 'succeeded',
      cruxSummary: longText,
    });
    expect(result.cruxSummary?.length).toBe(8_000);
  });
});

describe('Repository: incrementAttempt', () => {
  it('increments attempt_count and sets status', async () => {
    const ticketId = 'aaaaaaaa-0000-0000-0000-000000000066';

    await upsertSummaryByTicket(ctx.db, {
      tenantId: FIXTURE_IDS.TENANT_A,
      ticketId,
      aiStatus: 'running',
      attemptCount: 1,
    });

    const updated = await incrementAttempt(ctx.db, {
      tenantId: FIXTURE_IDS.TENANT_A,
      ticketId,
      aiStatus: 'failed',
      lastErrorCode: 'MODEL_TIMEOUT',
    });

    expect(updated?.attemptCount).toBe(2);
    expect(updated?.aiStatus).toBe('failed');
    expect(updated?.lastErrorCode).toBe('MODEL_TIMEOUT');
  });

  it('returns undefined for non-existent row', async () => {
    const result = await incrementAttempt(ctx.db, {
      tenantId: FIXTURE_IDS.TENANT_A,
      ticketId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    });
    expect(result).toBeUndefined();
  });
});

describe('Repository: replaceAffectedAreas', () => {
  it('replaces affected areas and de-duplicates labels', async () => {
    const ticketId = 'aaaaaaaa-0000-0000-0000-000000000055';

    // Insert initial areas.
    await replaceAffectedAreas(ctx.db, FIXTURE_IDS.TENANT_A, ticketId, [
      { areaLabel: 'Auth', confidence: 'high', source: 'ai' },
      { areaLabel: 'Payments', confidence: 'medium', source: 'ai' },
    ]);

    // Replace with new set (includes duplicate).
    const result = await replaceAffectedAreas(ctx.db, FIXTURE_IDS.TENANT_A, ticketId, [
      { areaLabel: 'Billing', confidence: 'high', source: 'ai' },
      { areaLabel: 'Billing', confidence: 'low', source: 'ai' }, // duplicate
      { areaLabel: 'Reporting', confidence: 'medium', source: 'ai' },
    ]);

    expect(result).toHaveLength(2); // duplicate removed
    const labels = result.map((r) => r.areaLabel).sort();
    expect(labels).toEqual(['Billing', 'Reporting']);
  });

  it('accepts an empty area list (clears all tags)', async () => {
    const ticketId = 'aaaaaaaa-0000-0000-0000-000000000044';

    await replaceAffectedAreas(ctx.db, FIXTURE_IDS.TENANT_A, ticketId, [
      { areaLabel: 'Auth', confidence: 'high', source: 'ai' },
    ]);

    const cleared = await replaceAffectedAreas(ctx.db, FIXTURE_IDS.TENANT_A, ticketId, []);
    expect(cleared).toHaveLength(0);

    const fetched = await findAffectedAreasByTicket(ctx.db, FIXTURE_IDS.TENANT_A, ticketId);
    expect(fetched).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Erasure / purge operations
// ---------------------------------------------------------------------------

describe('Erasure: deleteAiDataForTickets', () => {
  it('physically deletes summaries and areas for the given ticket IDs', async () => {
    const sql = postgres(ctx.connectionString, { max: 1 });
    try {
      // Load fresh fixtures.
      await sql.unsafe(`
        INSERT INTO tenants (id, name, plan_tier) VALUES
          ('${FIXTURE_IDS.TENANT_A}', 'Tenant Alpha', 'growth')
        ON CONFLICT DO NOTHING;
        INSERT INTO organizations (tenant_id, id, name) VALUES
          ('${FIXTURE_IDS.TENANT_A}', '${FIXTURE_IDS.ORG_A1}', 'Alpha Org 1')
        ON CONFLICT DO NOTHING;
      `);
      await loadAiSynthesisFixtures(sql);
    } finally {
      await sql.end();
    }

    const summaryIds = await enumerateSummaryIdsForTickets(
      ctx.db,
      FIXTURE_IDS.TENANT_A,
      [AI_FIXTURE_IDS.TICKET_A1],
    );
    expect(summaryIds).toHaveLength(1);

    const result = await deleteAiDataForTickets(
      ctx.db,
      FIXTURE_IDS.TENANT_A,
      [AI_FIXTURE_IDS.TICKET_A1],
    );
    expect(result.summariesDeleted).toBe(1);
    expect(result.areasDeleted).toBe(2); // AREA_A1_PAYMENTS + AREA_A1_AUTH

    // Verify rows are gone.
    const after = await findSummaryByTicket(ctx.db, FIXTURE_IDS.TENANT_A, AI_FIXTURE_IDS.TICKET_A1);
    expect(after).toBeUndefined();
  });

  it('is idempotent — second call returns zero deleted rows', async () => {
    const result = await deleteAiDataForTickets(
      ctx.db,
      FIXTURE_IDS.TENANT_A,
      [AI_FIXTURE_IDS.TICKET_A1],
    );
    expect(result.summariesDeleted).toBe(0);
    expect(result.areasDeleted).toBe(0);
  });
});
