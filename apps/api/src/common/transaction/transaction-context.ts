/**
 * Request-scoped transaction context.
 *
 * Uses Node.js AsyncLocalStorage to propagate the active postgres.js
 * transaction handle through the call stack without explicit parameter
 * threading. NestJS interceptors (from WOREF-004) will call `withTransaction`
 * to open the transaction and bind it to the current async context.
 *
 * This module is framework-agnostic: it only depends on Node.js built-ins and
 * postgres.js. NestJS integration is a thin wrapper added in the API setup.
 *
 * Design: every feature module calls `getTransaction()` to get the current
 * handle; if no transaction is active, it throws `TENANT_CONTEXT_MISSING`
 * which is caught by the global error filter and converted to 500.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class TenantContextMissingError extends Error {
  readonly code = 'TENANT_CONTEXT_MISSING';

  constructor(message = 'No active transaction context. DomainEventRecorder must be called within a request transaction.') {
    super(message);
    this.name = 'TenantContextMissingError';
  }
}

// ---------------------------------------------------------------------------
// Transaction context storage
// ---------------------------------------------------------------------------

export interface TransactionContext {
  /** The active postgres.js transaction SQL instance. */
  sql: Sql;
  /** Current tenant ID extracted from the JWT. */
  tenantId: string;
  /** Trace ID propagated from the X-Trace-Id request header. */
  traceId?: string;
  /** Actor information from the verified JWT. */
  actor: {
    type: 'user' | 'system' | 'integration';
    id?: string;
  };
}

const storage = new AsyncLocalStorage<TransactionContext>();

/**
 * Run `fn` with the given transaction context bound to the async context.
 * Any code called from within `fn` can call `getTransactionContext()` to
 * access the same context.
 */
export function withTransactionContext<T>(
  ctx: TransactionContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Returns the active transaction context, or throws `TenantContextMissingError`
 * if called outside a request transaction scope.
 */
export function getTransactionContext(): TransactionContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new TenantContextMissingError();
  }
  return ctx;
}

/**
 * Returns the active context or undefined (for optional usage patterns).
 */
export function tryGetTransactionContext(): TransactionContext | undefined {
  return storage.getStore();
}
