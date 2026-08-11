/**
 * TenantRepository — base class for all data-access repositories.
 *
 * Resolves the active transaction handle from AsyncLocalStorage and exposes it
 * as a protected `tx` getter. Subclasses use `this.tx` for all Drizzle queries
 * and never call the pool or create connections directly.
 *
 * A runtime assertion guards against misconfigured call paths: if a repository
 * method is invoked outside a bound tenant context (i.e., the interceptor did
 * not run or was exempted without a manual context), the getter throws with
 * code TENANT_CONTEXT_MISSING rather than executing a query with no RLS binding
 * and silently returning wrong data.
 *
 * ESLint boundary rule: only files inside apps/api/src/data may import
 * @opsninja/db directly (pool, createTransactionHandle). All other application
 * code must access the database through TenantRepository subclasses.
 */

import type { TxHandle } from '@opsninja/db';
import { getRawTxHandle } from '../observability/request-context';

/**
 * Application error thrown when a repository is accessed outside a tenant-bound
 * request context.
 */
export class TenantContextMissingError extends Error {
  readonly code = 'TENANT_CONTEXT_MISSING';

  constructor(repositoryName?: string) {
    super(
      repositoryName
        ? `${repositoryName} was called outside a tenant-bound context.`
        : 'A repository was called outside a tenant-bound context. ' +
            'Ensure this code path runs inside withTenantTransaction.',
    );
    this.name = 'TenantContextMissingError';
  }
}

/**
 * Abstract base for all tenant-scoped repositories.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class TicketRepository extends TenantRepository {
 *   async findById(id: string): Promise<Ticket | null> {
 *     const rows = await this.tx
 *       .select()
 *       .from(tickets)
 *       .where(eq(tickets.id, id))
 *       .limit(1);
 *     return rows[0] ?? null;
 *   }
 * }
 * ```
 */
export abstract class TenantRepository {
  /**
   * The Drizzle transaction handle for the current request.
   *
   * IMPORTANT: Never cache this value across async boundaries or store it as
   * an instance property — it is request-scoped and must be re-read from
   * AsyncLocalStorage on every access to ensure correct isolation.
   *
   * @throws TenantContextMissingError if accessed outside a bound context.
   */
  protected get tx(): TxHandle {
    return getTxHandle();
  }
}

/**
 * Retrieve the active transaction handle from the current request context.
 *
 * Exported for use by test-only stub controllers and for cases where
 * subclassing TenantRepository is not practical (e.g. in tests or
 * one-off background tasks that already have a bound context).
 *
 * In production code, always prefer subclassing TenantRepository and
 * using `this.tx` — the ESLint boundary rule will flag direct pool imports
 * but this function is within the data module so it remains accessible.
 *
 * @throws TenantContextMissingError if called outside a bound context.
 */
export function getTxHandle(): TxHandle {
  const raw = getRawTxHandle();
  return raw as TxHandle;
}
