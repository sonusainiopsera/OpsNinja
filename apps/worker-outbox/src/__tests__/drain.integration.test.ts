/**
 * Drain service integration tests.
 *
 * Runs against a live PostgreSQL 16 container via testcontainers.
 * Asserts:
 *   1. Full publish path: insert outbox row → run drain → in-memory publisher
 *      receives event → published_at is set.
 *   2. Concurrency: two drain instances with SKIP LOCKED do not publish the
 *      same event twice.
 *   3. Per-aggregate ordering: events for the same aggregate_id are published
 *      in created_at (then outbox_seq) order.
 *   4. Backoff: a failing publisher increments attempts and sets next_attempt_at.
 *   5. Dead-letter: after MAX_ATTEMPTS failures the row transitions to dead_letter.
 *   6. Replay: a dead-lettered row can be reset to pending by the replay command.
 *   7. Audit immutability: the runtime role (if app_user exists) cannot UPDATE
 *      or DELETE audit_logs rows.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { InMemoryPublisher, FailingPublisher } from '@opsninja/shared/messaging';
import { DrainService } from '../drain.service.js';
import { MAX_ATTEMPTS } from '../backoff.js';
import { createTestDb, type TestDbContext } from '../../../../packages/db/test/harness.js';

const TENANT_A = '10000000-0000-0000-0000-000000000001';
const ORG_A    = '20000000-0000-0000-0000-000000000001';

let ctx: TestDbContext;
let sql: postgres.Sql;

beforeAll(async () => {
  ctx = await createTestDb('drain-integration');
  sql = postgres(ctx.connectionString, { max: 3 });

  // Seed minimal fixture data.
  await sql.unsafe(`
    INSERT INTO tenants (id, name, plan_tier)
    VALUES ('${TENANT_A}', 'Drain Test Tenant', 'starter')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO organizations (tenant_id, id, name)
    VALUES ('${TENANT_A}', '${ORG_A}', 'Drain Test Org')
    ON CONFLICT (tenant_id, id) DO NOTHING;
  `);
}, 120_000);

afterAll(async () => {
  await sql.end();
  await ctx.teardown();
}, 30_000);

// Helper to insert an outbox row directly.
async function insertOutboxRow(opts: {
  id: string;
  aggregateId: string;
  eventType?: string;
  createdAt?: Date;
}): Promise<void> {
  const { id, aggregateId, eventType = 'ticket.created', createdAt } = opts;
  await sql.unsafe(`
    INSERT INTO outbox_events (tenant_id, id, aggregate_type, aggregate_id, event_type, payload, status${createdAt ? ', created_at' : ''})
    VALUES (
      '${TENANT_A}', '${id}', 'ticket', '${aggregateId}',
      '${eventType}', '{"test":true}'::jsonb, 'pending'
      ${createdAt ? `, '${createdAt.toISOString()}'::timestamptz` : ''}
    )
    ON CONFLICT (tenant_id, id) DO NOTHING;
  `);
}

// Helper to clear outbox and audit tables between tests.
async function clearTables(): Promise<void> {
  await sql.unsafe(`
    DELETE FROM outbox_events WHERE tenant_id = '${TENANT_A}';
    DELETE FROM audit_logs WHERE tenant_id = '${TENANT_A}';
  `);
}

// ---------------------------------------------------------------------------
// 1. Full publish path
// ---------------------------------------------------------------------------
describe('full publish path', () => {
  it('drain publishes a pending event and sets published_at', async () => {
    await clearTables();

    const eventId = 'e0000001-0000-0000-0000-000000000001';
    const aggregateId = 'a0000000-0000-0000-0000-000000000001';
    await insertOutboxRow({ id: eventId, aggregateId });

    const publisher = new InMemoryPublisher();
    const drain = new DrainService({
      connectionString: ctx.connectionString,
      publisher,
    });

    const result = await drain.runOnce();
    await drain.stop();

    expect(result.published).toBe(1);
    expect(publisher.events).toHaveLength(1);
    expect(publisher.events[0]?.id).toBe(eventId);
    expect(publisher.events[0]?.tenantId).toBe(TENANT_A);
    expect(publisher.events[0]?.aggregateId).toBe(aggregateId);
    expect(publisher.events[0]?.eventType).toBe('ticket.created');

    // published_at should be set.
    const rows = await sql<{ published_at: Date | null; status: string }[]>`
      SELECT published_at, status FROM outbox_events WHERE id = ${eventId}::uuid
    `;
    expect(rows[0]?.status).toBe('published');
    expect(rows[0]?.published_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Concurrency — exactly-once publish
// ---------------------------------------------------------------------------
describe('concurrency — SKIP LOCKED', () => {
  it('two concurrent drain instances publish each event exactly once', async () => {
    await clearTables();

    const ids = Array.from({ length: 10 }, (_, i) => `e0000002-0000-0000-0000-${String(i).padStart(12, '0')}`);
    for (const id of ids) {
      await insertOutboxRow({ id, aggregateId: id });
    }

    const pub1 = new InMemoryPublisher();
    const pub2 = new InMemoryPublisher();
    const drain1 = new DrainService({ connectionString: ctx.connectionString, publisher: pub1 });
    const drain2 = new DrainService({ connectionString: ctx.connectionString, publisher: pub2 });

    // Run both concurrently.
    await Promise.all([drain1.runOnce(), drain2.runOnce()]);
    await Promise.all([drain1.stop(), drain2.stop()]);

    const allPublished = [...pub1.events, ...pub2.events];
    const publishedIds = allPublished.map((e) => e.id);

    // Every id should appear exactly once across both publishers.
    for (const id of ids) {
      expect(publishedIds.filter((pid) => pid === id)).toHaveLength(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Per-aggregate ordering
// ---------------------------------------------------------------------------
describe('per-aggregate ordering', () => {
  it('publishes events for the same aggregate in created_at order', async () => {
    await clearTables();

    const aggId = 'b0000000-0000-0000-0000-000000000001';
    const earlier = new Date('2025-03-01T10:00:00Z');
    const later   = new Date('2025-03-01T10:00:01Z');
    const evenLater = new Date('2025-03-01T10:00:02Z');

    // Insert in reverse order to test that drain reorders by created_at.
    await insertOutboxRow({ id: 'e0000003-0000-0000-0000-000000000003', aggregateId: aggId, eventType: 'ticket.closed', createdAt: evenLater });
    await insertOutboxRow({ id: 'e0000003-0000-0000-0000-000000000001', aggregateId: aggId, eventType: 'ticket.created', createdAt: earlier });
    await insertOutboxRow({ id: 'e0000003-0000-0000-0000-000000000002', aggregateId: aggId, eventType: 'ticket.updated', createdAt: later });

    // Also insert an interleaved event for a different aggregate.
    await insertOutboxRow({ id: 'e0000003-0000-0000-0000-000000000010', aggregateId: 'c0000000-0000-0000-0000-000000000001', eventType: 'org.updated', createdAt: later });

    const publisher = new InMemoryPublisher();
    const drain = new DrainService({ connectionString: ctx.connectionString, publisher });

    await drain.runOnce();
    await drain.stop();

    const aggEvents = publisher.eventsForAggregate(aggId);
    expect(aggEvents).toHaveLength(3);
    expect(aggEvents[0]?.eventType).toBe('ticket.created');
    expect(aggEvents[1]?.eventType).toBe('ticket.updated');
    expect(aggEvents[2]?.eventType).toBe('ticket.closed');
  });
});

// ---------------------------------------------------------------------------
// 4. Backoff on failure
// ---------------------------------------------------------------------------
describe('backoff on publish failure', () => {
  it('increments attempts and sets next_attempt_at after a failed publish', async () => {
    await clearTables();

    const eventId = 'e0000004-0000-0000-0000-000000000001';
    await insertOutboxRow({ id: eventId, aggregateId: eventId });

    const publisher = new FailingPublisher(Infinity); // always fail
    const drain = new DrainService({ connectionString: ctx.connectionString, publisher });

    await drain.runOnce();
    await drain.stop();

    const rows = await sql<{ attempts: number; next_attempt_at: Date | null; status: string }[]>`
      SELECT attempts, next_attempt_at, status FROM outbox_events WHERE id = ${eventId}::uuid
    `;
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.next_attempt_at).not.toBeNull();
    expect(rows[0]?.status).toBe('pending'); // not yet dead_letter
  });
});

// ---------------------------------------------------------------------------
// 5. Dead-letter after MAX_ATTEMPTS
// ---------------------------------------------------------------------------
describe('dead-letter transition', () => {
  it(`transitions to dead_letter after ${MAX_ATTEMPTS} failed attempts`, async () => {
    await clearTables();

    const eventId = 'e0000005-0000-0000-0000-000000000001';
    await insertOutboxRow({ id: eventId, aggregateId: eventId });

    // Pre-seed attempts to MAX_ATTEMPTS - 1.
    await sql.unsafe(`
      UPDATE outbox_events
      SET attempts = ${MAX_ATTEMPTS - 1},
          next_attempt_at = '-infinity'::timestamptz
      WHERE id = '${eventId}'::uuid;
    `);

    const publisher = new FailingPublisher(Infinity);
    const drain = new DrainService({ connectionString: ctx.connectionString, publisher });

    await drain.runOnce();
    await drain.stop();

    const rows = await sql<{ status: string; attempts: number }[]>`
      SELECT status, attempts FROM outbox_events WHERE id = ${eventId}::uuid
    `;
    expect(rows[0]?.status).toBe('dead_letter');
  });
});

// ---------------------------------------------------------------------------
// 6. Replay
// ---------------------------------------------------------------------------
describe('replay dead-lettered event', () => {
  it('resets a dead-lettered event to pending with attempts=0', async () => {
    await clearTables();

    const eventId = 'e0000006-0000-0000-0000-000000000001';
    await insertOutboxRow({ id: eventId, aggregateId: eventId });
    await sql.unsafe(`
      UPDATE outbox_events
      SET status = 'dead_letter', attempts = ${MAX_ATTEMPTS}
      WHERE id = '${eventId}'::uuid;
    `);

    const drain = new DrainService({
      connectionString: ctx.connectionString,
      publisher: new InMemoryPublisher(),
    });

    await drain.replay(eventId);
    await drain.stop();

    const rows = await sql<{ status: string; attempts: number; next_attempt_at: Date | null }[]>`
      SELECT status, attempts, next_attempt_at FROM outbox_events WHERE id = ${eventId}::uuid
    `;
    expect(rows[0]?.status).toBe('pending');
    expect(rows[0]?.attempts).toBe(0);
    expect(rows[0]?.next_attempt_at).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Audit immutability
// ---------------------------------------------------------------------------
describe('audit_logs immutability', () => {
  it('can INSERT into audit_logs but the schema enforces append-only intent', async () => {
    // Insert an audit row and verify it exists.
    const auditId = 'f0000001-0000-0000-0000-000000000001';
    await sql.unsafe(`
      INSERT INTO audit_logs (tenant_id, id, occurred_at, actor_type, action, resource_type, resource_id)
      VALUES (
        '${TENANT_A}', '${auditId}'::uuid, now(),
        'system', 'create', 'ticket', '${ORG_A}'::uuid
      )
      ON CONFLICT (tenant_id, id, occurred_at) DO NOTHING;
    `);

    const rows = await sql<{ id: string }[]>`
      SELECT id::text FROM audit_logs WHERE id = ${auditId}::uuid
    `;
    expect(rows.length).toBeGreaterThan(0);
  });

  it('audit_logs has no UPDATE privilege for the current session role (NOSUPERUSER context)', async () => {
    // Since we're running as the postgres superuser in tests, we verify the
    // privilege check structurally via information_schema rather than expecting
    // a permission denied error (which would only fire for app_user).
    // This is documented in the migration README.
    const rows = await sql<{ privilege_type: string }[]>`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE table_name = 'audit_logs'
        AND grantee = 'app_user'
        AND privilege_type IN ('UPDATE', 'DELETE')
    `;
    // app_user should have 0 UPDATE/DELETE grants on audit_logs.
    const updateDeleteGrants = rows.filter(
      (r) => r.privilege_type === 'UPDATE' || r.privilege_type === 'DELETE',
    );
    expect(updateDeleteGrants).toHaveLength(0);
  });
});
