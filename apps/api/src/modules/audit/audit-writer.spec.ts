/**
 * Unit tests for AuditWriter.
 *
 * Uses a fake TxHandle and mock AuditContext to avoid DB dependencies.
 */

import { AuditWriter } from './audit-writer';
import { DefaultRedactor } from './redaction.port';
import { runWithAuditContext, AuditContext } from './audit-context';
import { requestContextStore } from '../../observability/request-context';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AUDIT_CTX: AuditContext = {
  tenantId: 'tenant-a',
  actorId: 'user-1',
  actorType: 'user',
  actorRole: 'support_agent',
  traceId: 'trace-abc',
  requestId: 'req-123',
  ipHash: 'abc123hash',
  userAgent: 'Mozilla/5.0',
  source: null,
};

function makeFakeTx() {
  const inserted: unknown[] = [];
  const tx = {
    insert: (_table: unknown) => ({
      values: (vals: unknown) => ({
        onConflictDoNothing: () => {
          inserted.push(vals);
          return Promise.resolve();
        },
      }),
    }),
    _inserted: inserted,
  };
  return tx;
}

function buildRequestCtx(tx: ReturnType<typeof makeFakeTx>) {
  return {
    traceId: 'trace-abc',
    principal: {
      tenantId: 'tenant-a',
      userId: 'user-1',
      principalKind: 'staff' as const,
      roles: ['support_agent'],
      orgScopeIds: [],
      traceId: 'trace-abc',
    },
    txHandle: tx,
    startedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditWriter', () => {
  it('inserts a record with correct fields', async () => {
    const tx = makeFakeTx();
    const reqCtx = buildRequestCtx(tx);
    const writer = new AuditWriter(new DefaultRedactor());

    await requestContextStore.run(reqCtx, () =>
      runWithAuditContext(AUDIT_CTX, () =>
        writer.append({
          resourceType: 'ticket_comment',
          action: 'create',
          resourceId: 'comment-1',
          afterState: { id: 'comment-1', body: 'Hello world', ticketId: 'ticket-1' },
        }),
      ),
    );

    expect(tx._inserted).toHaveLength(1);
    const record = tx._inserted[0] as Record<string, unknown>;
    expect(record['resourceType']).toBe('ticket_comment');
    expect(record['action']).toBe('create');
    expect(record['resourceId']).toBe('comment-1');
    expect(record['tenantId']).toBe('tenant-a');
    expect(record['actorId']).toBe('user-1');
  });

  it('redacts email in afterState before insert', async () => {
    const tx = makeFakeTx();
    const reqCtx = buildRequestCtx(tx);
    const writer = new AuditWriter(new DefaultRedactor());

    await requestContextStore.run(reqCtx, () =>
      runWithAuditContext(AUDIT_CTX, () =>
        writer.append({
          resourceType: 'ticket_comment',
          action: 'create',
          afterState: { body: 'msg', email: 'secret@example.com' },
        }),
      ),
    );

    const record = tx._inserted[0] as Record<string, unknown>;
    const afterState = record['afterState'] as Record<string, unknown>;
    expect(afterState['email']).not.toBe('secret@example.com');
  });

  it('skips emit when before and after are identical (no-op PATCH)', async () => {
    const tx = makeFakeTx();
    const reqCtx = buildRequestCtx(tx);
    const writer = new AuditWriter(new DefaultRedactor());
    const snapshot = { status: 'open', priority: 'P2' };

    await requestContextStore.run(reqCtx, () =>
      runWithAuditContext(AUDIT_CTX, () =>
        writer.append({
          resourceType: 'ticket',
          action: 'update',
          beforeState: snapshot,
          afterState: snapshot,
        }),
      ),
    );

    expect(tx._inserted).toHaveLength(0);
  });

  it('throws AUDIT_CONTEXT_MISSING when no context is bound', async () => {
    const tx = makeFakeTx();
    const reqCtx = buildRequestCtx(tx);
    const writer = new AuditWriter(new DefaultRedactor());

    await expect(
      requestContextStore.run(reqCtx, () =>
        writer.append({ resourceType: 'ticket', action: 'create' }),
      ),
    ).rejects.toMatchObject({ code: 'AUDIT_CONTEXT_MISSING' });
  });

  describe('deriveIdempotencyKey', () => {
    it('produces consistent hex strings', () => {
      const k1 = AuditWriter.deriveIdempotencyKey('tenant-a', 'event-1', 'create');
      const k2 = AuditWriter.deriveIdempotencyKey('tenant-a', 'event-1', 'create');
      expect(k1).toBe(k2);
      expect(k1).toHaveLength(64); // SHA-256 hex
    });

    it('produces different keys for different inputs', () => {
      const k1 = AuditWriter.deriveIdempotencyKey('tenant-a', 'event-1', 'create');
      const k2 = AuditWriter.deriveIdempotencyKey('tenant-a', 'event-1', 'update');
      expect(k1).not.toBe(k2);
    });
  });
});
