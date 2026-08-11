/**
 * Unit of Work — withTenantTransaction
 *
 * This is the SINGLE entry point for all database access in the codebase.
 * It is the only place that:
 *  1. Acquires a raw PoolClient from the pg pool.
 *  2. Issues BEGIN.
 *  3. Sets all per-transaction session variables via set_config(..., true)
 *     in a SINGLE round trip (so RLS and timeout settings are active before
 *     any handler code runs).
 *  4. Binds the Drizzle transaction handle and PrincipalContext into
 *     AsyncLocalStorage so that any service in the call chain can read them.
 *  5. Commits on success, rolls back on any thrown error.
 *  6. Releases the connection back to PgBouncer.
 *
 * Nested calls reuse the existing transaction rather than opening a second one.
 *
 * PgBouncer transaction-pooling compatibility:
 *   All session-variable writes use set_config(name, value, true) which is
 *   equivalent to SET LOCAL — the setting is scoped to the current transaction
 *   and is cleared when the transaction ends. Session-level SET is forbidden
 *   (see eslint rule and code review note) because PgBouncer reuses connections
 *   across tenants.
 */

import { PoolClient } from 'pg';
import { pool, createTransactionHandle } from '@opsninja/db';
import type { TxHandle } from '@opsninja/db';
import {
  PrincipalContext,
  RequestContext,
  requestContextStore,
} from '../observability/request-context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default statement timeout for interactive HTTP routes (5s).
 * Workers and batch jobs may pass a higher value via options.
 */
const DEFAULT_STATEMENT_TIMEOUT_MS = parseInt(
  process.env['DB_STATEMENT_TIMEOUT_MS'] ?? '5000',
  10,
);

/**
 * Default idle-in-transaction timeout (30s).
 * A held connection that goes idle (e.g. waiting for an external Jira call)
 * will be rolled back and released after this period.
 */
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = parseInt(
  process.env['DB_IDLE_IN_TRANSACTION_TIMEOUT_MS'] ?? '30000',
  10,
);

/**
 * Maximum number of org-scope IDs that can be packed into the
 * app.current_org_ids session variable as a comma-separated string.
 * If a principal's org set exceeds this we fall back gracefully and
 * emit a metric warning.
 */
const MAX_ORG_IDS_IN_SETTING = 200;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface WithTenantTransactionOptions {
  /**
   * Per-request statement timeout in milliseconds.
   * Defaults to DEFAULT_STATEMENT_TIMEOUT_MS.
   */
  statementTimeoutMs?: number;
  /**
   * Per-request idle-in-transaction timeout in milliseconds.
   * Defaults to DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS.
   */
  idleInTransactionTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/**
 * Execute fn inside a PostgreSQL transaction that is pre-bound to the given
 * principal's tenant context.
 *
 * Before fn is called:
 *  - A connection has been acquired from the pool.
 *  - BEGIN has been issued.
 *  - A single set_config batch has set:
 *      app.current_tenant     → principal.tenantId
 *      app.current_user       → principal.userId
 *      app.principal_kind     → principal.principalKind
 *      app.current_org_ids    → comma-separated orgScopeIds (capped at MAX_ORG_IDS_IN_SETTING)
 *      statement_timeout      → statementTimeoutMs
 *      idle_in_transaction_session_timeout → idleInTransactionTimeoutMs
 *  - The PrincipalContext and TxHandle have been stored in AsyncLocalStorage.
 *
 * After fn returns (or throws):
 *  - COMMIT (success) or ROLLBACK (error) is issued.
 *  - The connection is released back to the pool.
 *
 * Nested calls reuse the existing transaction handle without opening a
 * second BEGIN/COMMIT pair, preventing deadlocks and double-commit bugs.
 *
 * @param principal  The authenticated actor, sourced from the JWT or job payload.
 * @param fn         The business-logic function that receives the typed TxHandle.
 * @param options    Optional per-request timeout overrides.
 */
export async function withTenantTransaction<T>(
  principal: PrincipalContext,
  fn: (tx: TxHandle) => Promise<T>,
  options?: WithTenantTransactionOptions,
): Promise<T> {
  // -------------------------------------------------------------------------
  // Nested-call guard: reuse the existing transaction.
  // This prevents double-BEGIN and allows services to call each other without
  // knowing whether they're already inside a transaction.
  // -------------------------------------------------------------------------
  const existingCtx = requestContextStore.getStore();
  if (existingCtx?.txHandle) {
    return fn(existingCtx.txHandle as TxHandle);
  }

  // -------------------------------------------------------------------------
  // Resolve timeouts from options or environment defaults.
  // -------------------------------------------------------------------------
  const statementTimeout = String(
    options?.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS,
  );
  const idleTimeout = String(
    options?.idleInTransactionTimeoutMs ?? DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  );

  // -------------------------------------------------------------------------
  // Org-scope IDs: cap length to avoid exceeding the GUC string limit.
  // -------------------------------------------------------------------------
  let orgIds: string;
  if (principal.orgScopeIds.length > MAX_ORG_IDS_IN_SETTING) {
    // Emit a warning metric and fall back to empty (the RLS policy must handle
    // this by falling back to a join-based predicate when the setting is empty).
    console.warn('[unit-of-work] org_ids capped', {
      tenantId: principal.tenantId,
      userId: principal.userId,
      count: principal.orgScopeIds.length,
      cap: MAX_ORG_IDS_IN_SETTING,
    });
    orgIds = '';
  } else {
    orgIds = principal.orgScopeIds.join(',');
  }

  // -------------------------------------------------------------------------
  // Acquire connection, open transaction, bind context.
  // -------------------------------------------------------------------------
  const client: PoolClient = await pool.connect();
  let committed = false;

  try {
    // BEGIN
    await client.query('BEGIN');

    // Single round trip for all session-variable setup (RLS + timeouts).
    // We use set_config(name, value, true) where true = local = transaction-scoped.
    // This is mandatory for PgBouncer transaction pooling — a session-level SET
    // would leak across subsequent requests that happen to reuse the same
    // backend connection.
    await client.query(
      `SELECT
        set_config('statement_timeout', $1, true),
        set_config('idle_in_transaction_session_timeout', $2, true),
        set_config('app.current_tenant', $3, true),
        set_config('app.current_user',   $4, true),
        set_config('app.principal_kind', $5, true),
        set_config('app.current_org_ids',$6, true)`,
      [
        statementTimeout,
        idleTimeout,
        principal.tenantId,
        principal.userId,
        principal.principalKind,
        orgIds,
      ],
    );

    // Create a Drizzle query-builder scoped to this specific client connection
    // so every ORM call within fn goes through the same transaction.
    const tx: TxHandle = createTransactionHandle(client);

    // Bind PrincipalContext + TxHandle into AsyncLocalStorage so that any
    // repository in the call chain can retrieve them without parameter threading.
    const ctx: RequestContext = {
      traceId: principal.traceId,
      principal,
      txHandle: tx,
      startedAt: Date.now(),
    };

    const result = await requestContextStore.run(ctx, () => fn(tx));

    // COMMIT
    await client.query('COMMIT');
    committed = true;

    return result;
  } catch (err) {
    // ROLLBACK on any thrown error (handler errors, RLS policy violations,
    // statement timeouts, serialization failures, client disconnects).
    if (!committed) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        // Log but swallow rollback errors — the original error is more important.
        console.error('[unit-of-work] ROLLBACK failed', {
          originalError: (err as Error).message,
          rollbackError: (rollbackErr as Error).message,
        });
      }
    }

    // Map well-known PostgreSQL error codes to structured application errors
    // so that the NestJS exception filter can return the correct HTTP status.
    throw mapDbError(err);
  } finally {
    // Always release the connection back to PgBouncer, even on error.
    client.release();
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL error mapping
// ---------------------------------------------------------------------------

/**
 * Maps PostgreSQL error codes to structured application errors that the
 * NestJS global exception filter can translate to appropriate HTTP responses.
 */
function mapDbError(err: unknown): unknown {
  if (!isDatabaseError(err)) return err;

  switch (err.code) {
    // RLS policy violation — typically means the query touched rows belonging
    // to a different tenant. Map to 403 TENANT_POLICY_VIOLATION.
    case '42501': {
      const appErr = new Error('RLS policy prevented access to the requested resource');
      (appErr as NodeJS.ErrnoException).code = 'TENANT_POLICY_VIOLATION';
      return appErr;
    }

    // Serialization failure — concurrent write conflict. Map to 409 so the
    // client can retry idempotent requests.
    case '40001': {
      const appErr = new Error('Transaction serialization conflict — retry the request');
      (appErr as NodeJS.ErrnoException).code = 'SERIALIZATION_ERROR';
      return appErr;
    }

    // Statement timeout — the query exceeded the per-request budget. Map to
    // 503 QUERY_TIMEOUT and count in a dedicated metric.
    case '57014': {
      const appErr = new Error('Query exceeded the statement timeout for this request');
      (appErr as NodeJS.ErrnoException).code = 'QUERY_TIMEOUT';
      return appErr;
    }

    default:
      return err;
  }
}

interface DatabaseError {
  code?: string;
  message: string;
}

function isDatabaseError(err: unknown): err is DatabaseError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err
  );
}

// ---------------------------------------------------------------------------
// Test helper: injectable factory
// ---------------------------------------------------------------------------

/**
 * Type of the withTenantTransaction function, used for mock injection in tests.
 */
export type WithTenantTransactionFn = typeof withTenantTransaction;
