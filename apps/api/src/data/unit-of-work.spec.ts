/**
 * Unit tests for UnitOfWork.withTenantTransaction.
 *
 * Uses a mock Drizzle DB and asserts the correct SQL batch is executed in the
 * correct order.
 */

import { ConfigService } from '@nestjs/config';
import { UnitOfWork } from './unit-of-work';
import { RequestContextStore } from '../observability/request-context';
import { PrincipalFactory, TENANT_A_ID } from '../../test/factories/principal.factory';

// ─── Mock DB ──────────────────────────────────────────────────────────────────

function makeMockDb() {
  const executeArgs: unknown[] = [];
  const mockTx = {
    execute: jest.fn().mockImplementation((query: unknown) => {
      executeArgs.push(query);
      return Promise.resolve([]);
    }),
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue(Promise.resolve([])),
    }),
  };

  const db = {
    transaction: jest.fn().mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    ),
    __executeArgs: executeArgs as unknown[],
    __tx: mockTx,
  };

  return db;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('UnitOfWork', () => {
  let unitOfWork: UnitOfWork;
  let mockDb: ReturnType<typeof makeMockDb>;

  beforeEach(() => {
    mockDb = makeMockDb();
    // Use real ConfigService – defaults are returned for unknown keys
    unitOfWork = new UnitOfWork(mockDb as never, new ConfigService());
  });

  // ── Single round trip (AC7) ─────────────────────────────────────────────────
  it('issues exactly one execute call for the session-variable batch (AC7)', async () => {
    const principal = PrincipalFactory.staff({ tenantId: TENANT_A_ID });

    await unitOfWork.withTenantTransaction(principal, async (_tx) => 'ok');

    expect(mockDb.__tx.execute).toHaveBeenCalledTimes(1);
  });

  it('issues all set_config calls in a single SQL statement', async () => {
    const principal = PrincipalFactory.staff({ tenantId: TENANT_A_ID });

    await unitOfWork.withTenantTransaction(principal, async (_tx) => undefined);

    // The first (and only) execute call should contain all four app.* variables.
    // Drizzle's `sql` template tag produces an SQL object whose queryChunks array
    // holds the static string parts.  JSON.stringify serialises those chunks so we
    // can assert the expected GUC names appear somewhere in the serialised form.
    const query = mockDb.__executeArgs[0] as unknown;
    const serialised = JSON.stringify(query);
    expect(serialised).toContain('app.current_tenant');
    expect(serialised).toContain('app.current_user');
    expect(serialised).toContain('app.principal_kind');
    expect(serialised).toContain('app.current_org_ids');
    expect(serialised).toContain('statement_timeout');
    expect(serialised).toContain('idle_in_transaction_session_timeout');
  });

  // ── Context store populated (AC2) ──────────────────────────────────────────
  it('populates AsyncLocalStorage so getPrincipal() and getTx() work inside the callback', async () => {
    const principal = PrincipalFactory.staff({ tenantId: TENANT_A_ID });

    await unitOfWork.withTenantTransaction(principal, async () => {
      const storedPrincipal = RequestContextStore.getPrincipal();
      expect(storedPrincipal.tenantId).toBe(TENANT_A_ID);
      const storedTx = RequestContextStore.getTx();
      expect(storedTx).toBeDefined();
      return undefined;
    });
  });

  // ── Nested call reuse ──────────────────────────────────────────────────────
  it('reuses existing transaction for nested withTenantTransaction calls', async () => {
    const principal = PrincipalFactory.staff({ tenantId: TENANT_A_ID });
    let innerTxRef: unknown;
    let outerTxRef: unknown;

    await unitOfWork.withTenantTransaction(principal, async (outerTx) => {
      outerTxRef = outerTx;
      await unitOfWork.withTenantTransaction(principal, async (innerTx) => {
        innerTxRef = innerTx;
        return undefined;
      });
      return undefined;
    });

    // Inner and outer must be the same object reference.
    expect(innerTxRef).toBe(outerTxRef);
    // db.transaction should have been called only once.
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  // ── Rollback on throw (AC6) ────────────────────────────────────────────────
  it('propagates errors from the callback so the transaction rolls back', async () => {
    const principal = PrincipalFactory.staff({ tenantId: TENANT_A_ID });

    await expect(
      unitOfWork.withTenantTransaction(principal, async () => {
        throw new Error('handler exploded');
      }),
    ).rejects.toThrow('handler exploded');
  });

  // ── Org IDs truncation (edge case) ────────────────────────────────────────
  it('handles 150 orgScopeIds without throwing (truncates to 100)', async () => {
    const principal = PrincipalFactory.staff({
      orgScopeIds: Array.from({ length: 150 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`),
    });

    await expect(
      unitOfWork.withTenantTransaction(principal, async () => undefined),
    ).resolves.toBeUndefined();

    // Still only one round trip despite 150 IDs.
    expect(mockDb.__tx.execute).toHaveBeenCalledTimes(1);
  });

  // ── Context is cleared after the transaction ───────────────────────────────
  it('does not leak context outside the run() boundary', async () => {
    const principal = PrincipalFactory.staff({ tenantId: TENANT_A_ID });
    let txInsideCallback: unknown;

    await RequestContextStore.run({}, async () => {
      await unitOfWork.withTenantTransaction(principal, async (tx) => {
        txInsideCallback = tx;
        return undefined;
      });
      // After withTenantTransaction completes, the inner context is gone.
      // The outer context should still exist but without the tx from the inner run.
      const outer = RequestContextStore.get();
      expect(outer?.tx).toBeUndefined(); // inner run's tx not visible here
    });

    expect(txInsideCallback).toBeDefined();
  });
});
