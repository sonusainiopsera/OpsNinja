/**
 * Request-scoped AsyncLocalStorage context.
 *
 * Stores the authenticated principal and the active database transaction handle
 * so that any service or repository can read the current actor without threading
 * parameters through every function signature.
 *
 * Usage:
 *   - The tenant-context interceptor calls requestContextStore.run() to bind
 *     the context before handler execution.
 *   - Repositories call getPrincipalContext() / getTxHandle() to retrieve the
 *     bound values.
 *   - Both getters throw with code TENANT_CONTEXT_MISSING if accessed outside
 *     a bound context, satisfying the fail-loudly requirement.
 */

import { AsyncLocalStorage } from 'async_hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The principal kind mirrors the three populations defined in the auth model:
 * - staff     — internal agents, managers, admins
 * - portal    — external customer end-users
 * - machine   — workers, Jira webhook receiver
 */
export type PrincipalKind = 'staff' | 'portal' | 'machine';

/**
 * Typed representation of the authenticated actor, extracted from the JWT
 * (or job payload for machine principals) and available to all services via
 * AsyncLocalStorage.
 */
export interface PrincipalContext {
  /** UUID of the tenant this request is scoped to. */
  tenantId: string;
  /** UUID of the authenticated user or worker identity. */
  userId: string;
  /** Population this principal belongs to. */
  principalKind: PrincipalKind;
  /** RBAC roles granted to this principal (from JWT claim). */
  roles: string[];
  /**
   * Organisation IDs this principal may access (populated for staff from the
   * org-scope Redis cache; empty for machine principals which use a direct
   * tenant predicate).
   */
  orgScopeIds: string[];
  /** Trace ID carried through the request for correlated logging. */
  traceId: string;
}

/**
 * The full request context stored in AsyncLocalStorage.
 * txHandle is typed as unknown here and cast to TxHandle in the data layer to
 * avoid a circular dependency between observability and data modules.
 */
export interface RequestContext {
  traceId: string;
  principal?: PrincipalContext;
  /** Drizzle transaction handle; typed as TxHandle in the data layer. */
  txHandle?: unknown;
  /** Monotonic timestamp (ms) when the request/job started. */
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Store singleton
// ---------------------------------------------------------------------------

/**
 * Singleton AsyncLocalStorage for the request context.
 *
 * Exported so that the tenant-context interceptor can call .run() and so that
 * unit tests can inspect the store directly. All other reads must go through
 * the typed getters below.
 */
export const requestContextStore = new AsyncLocalStorage<RequestContext>();

// ---------------------------------------------------------------------------
// Typed getters
// ---------------------------------------------------------------------------

/**
 * Returns the current RequestContext or undefined when called outside a bound
 * context (e.g. from module initialization code).
 */
export function getRequestContext(): RequestContext | undefined {
  return requestContextStore.getStore();
}

/**
 * Returns the PrincipalContext for the current request.
 *
 * @throws Error with code TENANT_CONTEXT_MISSING when called outside a
 *   tenant-bound context. This is a programming-error (500-class defect) and
 *   must never be swallowed or downgraded to a 200.
 */
export function getPrincipalContext(): PrincipalContext {
  const ctx = requestContextStore.getStore();
  if (!ctx?.principal) {
    const err = new Error(
      'No tenant context is bound to this request. ' +
        'Ensure the TenantContextInterceptor is registered globally and that ' +
        'this code path is not called from an exempt route without a manual context.',
    );
    (err as NodeJS.ErrnoException).code = 'TENANT_CONTEXT_MISSING';
    throw err;
  }
  return ctx.principal;
}

/**
 * Returns the raw (unknown-typed) transaction handle for the current request.
 * The data layer casts this to TxHandle to avoid a circular import.
 *
 * @throws Error with code TENANT_CONTEXT_MISSING when no transaction is bound.
 */
export function getRawTxHandle(): unknown {
  const ctx = requestContextStore.getStore();
  if (!ctx?.txHandle) {
    const err = new Error(
      'No database transaction handle is bound to this request. ' +
        'Ensure all repository access runs through withTenantTransaction.',
    );
    (err as NodeJS.ErrnoException).code = 'TENANT_CONTEXT_MISSING';
    throw err;
  }
  return ctx.txHandle;
}
