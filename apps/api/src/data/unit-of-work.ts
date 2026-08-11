/**
 * Unit of Work – the single funnel for all database access in the API.
 *
 * Every HTTP request and every worker job must enter the database through
 * `withTenantTransaction()`.  This function:
 *
 *  1. Checks whether we're already inside a bound transaction (nested calls
 *     reuse the existing handle rather than opening a second one and deadlocking).
 *  2. Acquires a connection from the PgBouncer-managed pool.
 *  3. Begins an explicit transaction.
 *  4. Issues a single batched SELECT that calls set_config() for all four
 *     session variables + the two timeout GUCs — one round trip total.
 *  5. Stores the transaction handle in AsyncLocalStorage.
 *  6. Runs the caller-supplied callback.
 *  7. Commits on success, rolls back on any thrown error.
 *
 * PgBouncer compatibility: only `set_config(name, value, true)` (transaction-
 * local) is ever used; session-level SET is forbidden so that PgBouncer
 * transaction pooling cannot leak settings across tenants.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DB, DrizzleHandle, sql } from '@opsninja/db';
import { PrincipalContext, RequestContextStore } from '../observability/request-context';

/** Maximum number of org-scope UUIDs written into app.current_org_ids. */
const MAX_ORG_IDS = 100;

export interface UoWOptions {
  /** Per-statement timeout in milliseconds (default: 5 000). */
  statementTimeoutMs?: number;
  /** Max idle time inside an open transaction in milliseconds (default: 5 000). */
  idleInTransactionTimeoutMs?: number;
}

/**
 * Injectable service; registered in DbModule and consumed by the
 * TenantContextInterceptor and all worker entry points.
 */
@Injectable()
export class UnitOfWork {
  private readonly logger = new Logger(UnitOfWork.name);

  constructor(
    private readonly db: DB,
    private readonly config: ConfigService,
  ) {}

  /**
   * Opens a tenant-bound database transaction and executes `fn` inside it.
   *
   * @param principal  The resolved, authenticated principal.
   * @param fn         Callback that receives the Drizzle transaction handle.
   * @param options    Optional timeout overrides.
   */
  async withTenantTransaction<T>(
    principal: PrincipalContext,
    fn: (tx: DrizzleHandle) => Promise<T>,
    options?: UoWOptions,
  ): Promise<T> {
    // ── Nested-call guard ──────────────────────────────────────────────────────
    // If we are already inside a bound transaction (e.g. a service calls another
    // service that also uses UoW), reuse the existing handle.
    const existing = RequestContextStore.get();
    if (existing?.tx) {
      this.logger.verbose(
        `withTenantTransaction: reusing existing transaction for tenant ${principal.tenantId}`,
      );
      return fn(existing.tx);
    }

    const statementTimeoutMs =
      options?.statementTimeoutMs ??
      this.config.get<number>('DB_STATEMENT_TIMEOUT_MS', 5_000);
    const idleInTransactionTimeoutMs =
      options?.idleInTransactionTimeoutMs ??
      this.config.get<number>('DB_IDLE_IN_TRANSACTION_TIMEOUT_MS', 5_000);

    // Truncate org IDs to prevent exceeding PostgreSQL's internal setting length.
    const orgScopeIds = principal.orgScopeIds ?? [];
    if (orgScopeIds.length > MAX_ORG_IDS) {
      this.logger.warn(
        `Principal ${principal.userId} has ${orgScopeIds.length} org scope IDs; ` +
          `truncating to ${MAX_ORG_IDS}. Downstream queries using join-based org ` +
          `predicate should be used for this principal.`,
        { userId: principal.userId, tenantId: principal.tenantId },
      );
    }
    const orgIds = orgScopeIds.slice(0, MAX_ORG_IDS).join(',');

    return this.db.transaction(async (tx) => {
      // ── Single-round-trip session-variable batch ─────────────────────────────
      // All set_config calls use local=true (third argument) which makes them
      // transaction-scoped.  PgBouncer transaction pooling is therefore safe:
      // settings are cleared automatically when the transaction ends.
      //
      // statement_timeout and idle_in_transaction_session_timeout are standard
      // PostgreSQL GUC parameters and can also be set via set_config.
      await tx.execute(sql`
        SELECT
          set_config('app.current_tenant',                    ${principal.tenantId},               true),
          set_config('app.current_user',                      ${principal.userId},                  true),
          set_config('app.principal_kind',                    ${principal.principalKind},           true),
          set_config('app.current_org_ids',                   ${orgIds},                            true),
          set_config('statement_timeout',                     ${String(statementTimeoutMs)},        true),
          set_config('idle_in_transaction_session_timeout',   ${String(idleInTransactionTimeoutMs)}, true)
      `);

      // ── Store handle in AsyncLocalStorage ─────────────────────────────────────
      // We must do this inside the transaction callback so the handle is
      // available to all downstream services before any of them execute a query.
      return RequestContextStore.run(
        {
          principal,
          tx: tx as unknown as DrizzleHandle,
          requestStartedAt: process.hrtime.bigint(),
        },
        () => fn(tx as unknown as DrizzleHandle),
      );
    });
  }
}
