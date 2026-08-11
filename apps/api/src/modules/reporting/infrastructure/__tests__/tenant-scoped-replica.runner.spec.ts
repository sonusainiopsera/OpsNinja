import { TenantScopedReplicaRunner } from '../tenant-scoped-replica.runner';
import { ReplicaTenantContextMissingError } from '../reporting-errors';
import { RequestContextStore } from '../../../../observability/request-context';
import type { PrincipalContext } from '../../../../observability/request-context';

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockExecute = jest.fn().mockResolvedValue({ rows: [] });
const mockTransaction = jest.fn().mockImplementation(async (fn: (tx: unknown) => unknown) => {
  return fn({ execute: mockExecute });
});

const mockDb = {
  transaction: mockTransaction,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPrincipal(overrides?: Partial<PrincipalContext>): PrincipalContext {
  return {
    tenantId: 'tenant-abc',
    userId: 'user-1',
    principalKind: 'staff',
    roles: [],
    orgScopeIds: [],
    traceId: 'trace-001',
    ...overrides,
  };
}

function runWithPrincipal<T>(
  principal: PrincipalContext | null,
  fn: () => Promise<T>,
): Promise<T> {
  if (!principal) {
    return RequestContextStore.run({}, fn);
  }
  return RequestContextStore.run({ principal }, fn);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TenantScopedReplicaRunner', () => {
  let runner: TenantScopedReplicaRunner;

  beforeEach(() => {
    jest.clearAllMocks();
    runner = new TenantScopedReplicaRunner(mockDb as never);
  });

  it('opens a transaction and sets app.current_tenant for a valid principal', async () => {
    const principal = buildPrincipal({ tenantId: 'tenant-xyz' });

    await runWithPrincipal(principal, () => runner.run(async () => 'result'));

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const sqlArg = String(mockExecute.mock.calls[0][0]);
    expect(sqlArg).toMatch(/set_config/i);
    expect(sqlArg).toContain('app.current_tenant');
  });

  it('returns the value from the callback', async () => {
    const principal = buildPrincipal();
    const result = await runWithPrincipal(principal, () => runner.run(async () => 42));
    expect(result).toBe(42);
  });

  it('throws ReplicaTenantContextMissingError when no RequestContext is active', async () => {
    await expect(runner.run(async () => void 0)).rejects.toBeInstanceOf(
      ReplicaTenantContextMissingError,
    );
  });

  it('throws ReplicaTenantContextMissingError when principal is absent from context', async () => {
    await expect(
      runWithPrincipal(null, () => runner.run(async () => void 0)),
    ).rejects.toBeInstanceOf(ReplicaTenantContextMissingError);
  });

  it('propagates errors thrown by the callback', async () => {
    const principal = buildPrincipal();
    const boom = new Error('query exploded');

    mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
      await fn({ execute: mockExecute });
    });

    await expect(
      runWithPrincipal(principal, () =>
        runner.run(async () => {
          throw boom;
        }),
      ),
    ).rejects.toBe(boom);
  });
});
