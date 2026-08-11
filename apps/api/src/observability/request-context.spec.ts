/**
 * Unit tests for request-context.ts.
 *
 * Key concerns:
 *  - getPrincipalContext() throws TENANT_CONTEXT_MISSING outside bound context
 *  - getRawTxHandle() throws TENANT_CONTEXT_MISSING outside bound context
 *  - Concurrent async operations each see their own tenant context (no leakage)
 */

import { randomUUID } from 'crypto';
import {
  requestContextStore,
  getPrincipalContext,
  getRawTxHandle,
  getRequestContext,
  PrincipalContext,
  RequestContext,
} from './request-context';
import { tenantAStaffPrincipal, tenantBStaffPrincipal } from '../../test/factories/principal-context.factory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildCtx(principal: PrincipalContext, txHandle?: unknown): RequestContext {
  return {
    traceId: principal.traceId,
    principal,
    txHandle: txHandle ?? { __fakeTx: true },
    startedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('requestContextStore', () => {
  describe('outside a bound context', () => {
    it('getRequestContext() returns undefined', () => {
      expect(getRequestContext()).toBeUndefined();
    });

    it('getPrincipalContext() throws with code TENANT_CONTEXT_MISSING', () => {
      expect(() => getPrincipalContext()).toThrow(
        expect.objectContaining({ code: 'TENANT_CONTEXT_MISSING' }),
      );
    });

    it('getRawTxHandle() throws with code TENANT_CONTEXT_MISSING', () => {
      expect(() => getRawTxHandle()).toThrow(
        expect.objectContaining({ code: 'TENANT_CONTEXT_MISSING' }),
      );
    });
  });

  describe('inside a bound context', () => {
    it('getPrincipalContext() returns the bound principal', async () => {
      const principal = tenantAStaffPrincipal();
      await requestContextStore.run(buildCtx(principal), async () => {
        const p = getPrincipalContext();
        expect(p).toEqual(principal);
      });
    });

    it('getRawTxHandle() returns the bound tx handle', async () => {
      const principal = tenantAStaffPrincipal();
      const txHandle = { __testTx: 'bound' };
      await requestContextStore.run(buildCtx(principal, txHandle), async () => {
        expect(getRawTxHandle()).toBe(txHandle);
      });
    });
  });

  describe('concurrent isolation', () => {
    /**
     * Runs N interleaved async operations, each with a different tenant context,
     * and asserts that each operation only sees its own tenantId.
     *
     * This is the key concurrency-isolation test: AsyncLocalStorage must ensure
     * tenant A's context never bleeds into tenant B's concurrent request.
     */
    it('does not leak context between concurrent requests', async () => {
      const CONCURRENCY = 50;
      const errors: string[] = [];

      async function runRequest(tenantId: string): Promise<void> {
        const principal: PrincipalContext = {
          tenantId,
          userId: randomUUID(),
          principalKind: 'staff',
          roles: ['agent'],
          orgScopeIds: [],
          traceId: randomUUID(),
        };

        await requestContextStore.run(buildCtx(principal), async () => {
          // Simulate async work that yields to the event loop.
          await new Promise<void>((resolve) => setImmediate(resolve));

          const observed = getPrincipalContext();
          if (observed.tenantId !== tenantId) {
            errors.push(
              `Expected tenantId ${tenantId} but got ${observed.tenantId}`,
            );
          }

          // Yield again and re-check.
          await new Promise<void>((resolve) => setImmediate(resolve));
          const observed2 = getPrincipalContext();
          if (observed2.tenantId !== tenantId) {
            errors.push(
              `Second check: expected tenantId ${tenantId} but got ${observed2.tenantId}`,
            );
          }
        });
      }

      // Interleave CONCURRENCY requests alternating between tenant A and tenant B.
      const requests = Array.from({ length: CONCURRENCY }, (_, i) =>
        runRequest(i % 2 === 0 ? '11111111-0000-0000-0000-000000000000' : '22222222-0000-0000-0000-000000000000'),
      );
      await Promise.all(requests);

      expect(errors).toHaveLength(0);
    });

    it('does not leak context between sequential pooled requests', async () => {
      // Simulate two sequential requests over the same execution context.
      const principalA = tenantAStaffPrincipal();
      const principalB = tenantBStaffPrincipal();

      // First request
      await requestContextStore.run(buildCtx(principalA), async () => {
        expect(getPrincipalContext().tenantId).toBe(principalA.tenantId);
      });

      // After the first request's context exits, there should be no context.
      expect(getRequestContext()).toBeUndefined();

      // Second request should have its own isolated context.
      await requestContextStore.run(buildCtx(principalB), async () => {
        expect(getPrincipalContext().tenantId).toBe(principalB.tenantId);
      });
    });
  });
});
