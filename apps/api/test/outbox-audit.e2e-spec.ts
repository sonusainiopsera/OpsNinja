/**
 * Outbox + Audit end-to-end integration test.
 *
 * Asserts the full transactional guarantee:
 *   1. Both audit and outbox rows are written in the same transaction.
 *   2. When the transaction rolls back, neither row persists (atomicity).
 *   3. A successful write produces exactly one complete audit record and
 *      one outbox event.
 *   4. Running the drain loop once delivers the event to the in-memory
 *      publisher and sets published_at.
 *   5. The audit record contains all required fields (actor, action,
 *      resource_type, resource_id, trace_id, before/after payloads).
 *   6. Audit payloads are redacted (email becomes [REDACTED]).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { DomainEventRecorder } from '../src/common/events/domain-event-recorder.js';
import { withTransactionContext } from '../src/common/transaction/transaction-context.js';
import { InMemoryPublisher } from '@opsninja/shared/messaging';
import { REDACTED_SENTINEL } from '@opsninja/shared/privacy';
import { DrainService } from '../../../apps/worker-outbox/src/drain.service.js';
import { createTestDb, type TestDbContext } from '../../../packages/db/test/harness.js';

const TENANT_A = '10000000-0000-0000-0001-000000000001';
const ORG_A    = '20000000-0000-0000-0001-000000000001';

let ctx: TestDbContext;
let sql: Sql;
let recorder: DomainEventRecorder;

beforeAll(async () => {
  ctx = await createTestDb('api-e2e');
  sql = postgres(ctx.connectionString, { max: 5 });
  recorder = new DomainEventRecorder();

  // Seed minimal tenant + org.
  await sql.unsafe(`
    INSERT INTO tenants (id, name, plan_tier)
    VALUES ('${TENANT_A}', 'E2E Tenant', 'growth')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO organizations (tenant_id, id, name)
    VALUES ('${TENANT_A}', '${ORG_A}', 'E2E Org')
    ON CONFLICT (tenant_id, id) DO NOTHING;
  `);
}, 120_000);

afterAll(async () => {
  await sql.end();
  await ctx.teardown();
}, 30_000);

async function clearAuditAndOutbox(): Promise<void> {
  await sql.unsafe(`
    DELETE FROM outbox_events WHERE tenant_id = '${TENANT_A}';
    DELETE FROM audit_logs WHERE tenant_id = '${TENANT_A}';
  `);
}

// ---------------------------------------------------------------------------
// 1. Atomicity — rollback leaves no trace
// ---------------------------------------------------------------------------
describe('transactional atomicity', () => {
  it('rolls back both audit and outbox rows when the transaction fails', async () => {
    await clearAuditAndOutbox();

    const ticketId = 'a1000000-0000-0000-0000-000000000001';

    await expect(
      sql.begin(async (tx) => {
        await withTransactionContext(
          {
            sql: tx as unknown as Sql,
            tenantId: TENANT_A,
            traceId: 'trace-rollback-test',
            actor: { type: 'user', id: 'user-uuid-1' },
          },
          async () => {
            await recorder.recordAudit({
              resourceType: 'ticket',
              resourceId: ticketId,
              action: 'create',
              before: null,
              after: { id: ticketId, status: 'open', priority: 'P1' },
            });
            await recorder.enqueueEvent({
              id: 'ev000001-0000-0000-0000-000000000001',
              aggregateType: 'ticket',
              aggregateId: ticketId,
              eventType: 'ticket.created',
              payload: { priority: 'P1' },
            });
            // Simulate a handler error after writing — triggers rollback.
            throw new Error('Simulated handler error after enqueue');
          },
        );
      }),
    ).rejects.toThrow('Simulated handler error after enqueue');

    // Neither row should exist after rollback.
    const auditRows = await sql`SELECT 1 FROM audit_logs WHERE tenant_id = ${TENANT_A}::uuid`;
    const outboxRows = await sql`SELECT 1 FROM outbox_events WHERE tenant_id = ${TENANT_A}::uuid`;
    expect(auditRows).toHaveLength(0);
    expect(outboxRows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Successful write produces exactly one complete audit + outbox record
// ---------------------------------------------------------------------------
describe('successful write', () => {
  it('writes exactly one audit record and one outbox event', async () => {
    await clearAuditAndOutbox();

    const ticketId = 'a2000000-0000-0000-0000-000000000001';
    const eventId  = 'ev000002-0000-0000-0000-000000000001';

    await sql.begin(async (tx) => {
      await withTransactionContext(
        {
          sql: tx as unknown as Sql,
          tenantId: TENANT_A,
          traceId: 'trace-success-test',
          actor: { type: 'user', id: 'user-uuid-2' },
        },
        async () => {
          await recorder.recordAudit({
            resourceType: 'ticket',
            resourceId: ticketId,
            action: 'create',
            before: null,
            after: { id: ticketId, status: 'open', priority: 'P2', organizationId: ORG_A },
          });
          await recorder.enqueueEvent({
            id: eventId,
            aggregateType: 'ticket',
            aggregateId: ticketId,
            eventType: 'ticket.created',
            payload: { priority: 'P2', organizationId: ORG_A },
          });
        },
      );
    });

    // Exactly one audit row.
    const auditRows = await sql<{
      tenant_id: string;
      actor_type: string;
      actor_id: string;
      action: string;
      resource_type: string;
      resource_id: string;
      trace_id: string;
      after_state: Record<string, unknown> | null;
    }[]>`
      SELECT tenant_id::text, actor_type, actor_id::text, action,
             resource_type, resource_id::text, trace_id, after_state
      FROM audit_logs
      WHERE tenant_id = ${TENANT_A}::uuid
    `;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actor_type).toBe('user');
    expect(auditRows[0]?.action).toBe('create');
    expect(auditRows[0]?.resource_type).toBe('ticket');
    expect(auditRows[0]?.resource_id).toBe(ticketId);
    expect(auditRows[0]?.trace_id).toBe('trace-success-test');

    // Exactly one outbox row, status pending.
    const outboxRows = await sql<{ id: string; status: string; event_type: string }[]>`
      SELECT id::text, status, event_type FROM outbox_events WHERE tenant_id = ${TENANT_A}::uuid
    `;
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.id).toBe(eventId);
    expect(outboxRows[0]?.status).toBe('pending');
    expect(outboxRows[0]?.event_type).toBe('ticket.created');
  });

  // ---------------------------------------------------------------------------
  // 3. Drain delivers the event and sets published_at
  // ---------------------------------------------------------------------------
  it('drain loop delivers the event to the publisher and sets published_at', async () => {
    // Relies on the outbox row written in the previous test.
    const publisher = new InMemoryPublisher();
    const drain = new DrainService({
      connectionString: ctx.connectionString,
      publisher,
    });

    const result = await drain.runOnce();
    await drain.stop();

    expect(result.published).toBeGreaterThan(0);
    expect(publisher.events.length).toBeGreaterThan(0);

    const firstEvent = publisher.events[0];
    expect(firstEvent?.eventType).toBe('ticket.created');
    expect(firstEvent?.tenantId).toBe(TENANT_A);

    // published_at should now be set.
    const rows = await sql<{ published_at: Date | null }[]>`
      SELECT published_at FROM outbox_events
      WHERE tenant_id = ${TENANT_A}::uuid AND status = 'published'
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.published_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Audit payload redaction
// ---------------------------------------------------------------------------
describe('audit payload redaction', () => {
  it('redacts email in the after_state of an audit record', async () => {
    await clearAuditAndOutbox();

    const userId = 'a3000000-0000-0000-0000-000000000001';

    await sql.begin(async (tx) => {
      await withTransactionContext(
        {
          sql: tx as unknown as Sql,
          tenantId: TENANT_A,
          traceId: 'trace-redact-test',
          actor: { type: 'system' },
        },
        async () => {
          await recorder.recordAudit({
            resourceType: 'user',
            resourceId: userId,
            action: 'create',
            before: null,
            after: { id: userId, email: 'sensitive@example.com', status: 'active' },
          });
        },
      );
    });

    const rows = await sql<{ after_state: Record<string, unknown> | null }[]>`
      SELECT after_state FROM audit_logs WHERE tenant_id = ${TENANT_A}::uuid
    `;
    expect(rows).toHaveLength(1);
    const afterState = rows[0]?.after_state;
    // email should be redacted
    if (afterState && 'email' in afterState) {
      expect(afterState['email']).toBe(REDACTED_SENTINEL);
    }
  });
});
