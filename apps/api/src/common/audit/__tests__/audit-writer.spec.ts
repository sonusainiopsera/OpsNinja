import { AuditWriter } from '../audit-writer';
import { AuditContext } from '../audit-context';
import { DefaultRedactor } from '../redaction.port';

// Mock the RequestContextStore and TenantContextMissingError
const mockInsert = jest.fn();
const mockOnConflictDoNothing = jest.fn().mockResolvedValue(undefined);
const mockInsertChain = { onConflictDoNothing: mockOnConflictDoNothing };

jest.mock('../../../observability/request-context', () => ({
  RequestContextStore: {
    getTx: jest.fn(),
  },
  TenantContextMissingError: class TenantContextMissingError extends Error {
    constructor(message?: string) { super(message); this.name = 'TenantContextMissingError'; }
  },
}));

import { RequestContextStore, TenantContextMissingError } from '../../../observability/request-context';

const mockTx = {
  insert: jest.fn().mockReturnValue({ values: jest.fn().mockReturnValue(mockInsertChain) }),
};

const baseAuditCtx = {
  tenantId: 'tenant-1',
  actorType: 'user' as const,
  actorId: 'user-1',
  actorRole: 'admin',
  traceId: 'trace-1',
  requestId: 'req-1',
  hashedIp: null,
  userAgent: null,
  source: null,
};

describe('AuditWriter', () => {
  let writer: AuditWriter;

  beforeEach(() => {
    jest.clearAllMocks();
    (RequestContextStore.getTx as jest.Mock).mockReturnValue(mockTx);
    mockTx.insert.mockReturnValue({ values: jest.fn().mockReturnValue(mockInsertChain) });
    writer = new AuditWriter(new DefaultRedactor());
  });

  it('appends an audit record within an AuditContext', async () => {
    await AuditContext.run(baseAuditCtx, async () => {
      await writer.append({ action: 'ticket.created', resourceType: 'ticket', resourceId: 'tkt-1' });
    });
    expect(mockTx.insert).toHaveBeenCalledTimes(1);
  });

  it('throws AuditContextMissingError when called outside AuditContext', async () => {
    await expect(
      writer.append({ action: 'ticket.created', resourceType: 'ticket' }),
    ).rejects.toThrow('AUDIT_CONTEXT_MISSING');
  });

  it('skips no-op mutations when changedFields is empty and forceEmit is false', async () => {
    await AuditContext.run(baseAuditCtx, async () => {
      await writer.append({
        action: 'ticket.updated',
        resourceType: 'ticket',
        beforeState: { status: 'open' },
        afterState: { status: 'open' },  // no change
      });
    });
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it('emits when forceEmit=true even with no changed fields', async () => {
    await AuditContext.run(baseAuditCtx, async () => {
      await writer.append({
        action: 'ticket.status_transitioned',
        resourceType: 'ticket',
        beforeState: { status: 'open' },
        afterState: { status: 'open' },
        forceEmit: true,
      });
    });
    expect(mockTx.insert).toHaveBeenCalledTimes(1);
  });

  it('emits when before/after have actual changes', async () => {
    await AuditContext.run(baseAuditCtx, async () => {
      await writer.append({
        action: 'ticket.updated',
        resourceType: 'ticket',
        beforeState: { status: 'open' },
        afterState: { status: 'closed' },
      });
    });
    expect(mockTx.insert).toHaveBeenCalledTimes(1);
  });

  it('re-throws DB errors so transaction rolls back', async () => {
    const dbError = new Error('DB connection lost');
    mockTx.insert.mockReturnValueOnce({
      values: jest.fn().mockReturnValue({
        onConflictDoNothing: jest.fn().mockRejectedValue(dbError),
      }),
    });

    await expect(
      AuditContext.run(baseAuditCtx, () =>
        writer.append({
          action: 'ticket.created',
          resourceType: 'ticket',
          forceEmit: true,
        }),
      ),
    ).rejects.toThrow('DB connection lost');
  });

  it('appendBatch writes each item in sequence', async () => {
    await AuditContext.run(baseAuditCtx, async () => {
      await writer.appendBatch([
        { action: 'ticket.created', resourceType: 'ticket', resourceId: '1', forceEmit: true },
        { action: 'ticket.updated', resourceType: 'ticket', resourceId: '1', forceEmit: true },
      ]);
    });
    expect(mockTx.insert).toHaveBeenCalledTimes(2);
  });

  it('appendAuthEvent inserts without requiring AuditContext', async () => {
    const mockDbInsert = jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) });
    const mockDb = { insert: mockDbInsert } as unknown as import('@opsninja/db').DB;
    await writer.appendAuthEvent(mockDb, {
      action: 'auth.logout',
      actorId: 'user-1',
      tenantId: 'tenant-1',
      outcome: 'success',
    });
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });

  it('throws AuditContextMissingError when no DB transaction is active', async () => {
    (RequestContextStore.getTx as jest.Mock).mockImplementationOnce(() => {
      throw new TenantContextMissingError('no tx');
    });
    await expect(
      AuditContext.run(baseAuditCtx, () =>
        writer.append({ action: 'ticket.created', resourceType: 'ticket', forceEmit: true }),
      ),
    ).rejects.toThrow('append() requires an active DB transaction');
  });
});
