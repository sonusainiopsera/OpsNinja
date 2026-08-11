/**
 * TenantScopedReplicaRunner
 *
 * Opens a read-only transaction on the reporting replica, issues
 * `set_config('app.current_tenant', tenantId, true)` before any application
 * query runs, then executes the caller-supplied callback.
 *
 * This mirrors the primary-side UnitOfWork.withTenantTransaction() pattern
 * but against the smaller, read-only replica pool.  The local flag (third
 * arg = true) makes the GUC transaction-scoped — safe for PgBouncer
 * transaction pooling.
 *
 * Throws ReplicaTenantContextMissingError when called outside an
 * established RequestContext (no authenticated principal in scope).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { RequestContextStore } from '../../../observability/request-context';
import { ReplicaTenantContextMissingError } from './reporting-errors';
import { REPORTING_DB } from './reporting-replica.module';

@Injectable()
export class TenantScopedReplicaRunner {
  private readonly logger = new Logger(TenantScopedReplicaRunner.name);

  constructor(
    @Inject(REPORTING_DB)
    private readonly db: NodePgDatabase,
  ) {}

  /**
   * Executes `fn` inside a tenant-bound replica transaction.
   *
   * The transaction:
   *  1. Sets `app.current_tenant` via set_config (local=true).
   *  2. Sets `statement_timeout` via set_config (local=true, 30 s override).
   *  3. Sets `idle_in_transaction_session_timeout` via set_config (local=true).
   *  4. Runs the caller callback.
   *  5. Rolls back (read-only; no writes to commit).
   *
   * @param fn Callback that receives the transaction handle.
   * @throws {ReplicaTenantContextMissingError} When no tenant context exists.
   */
  async run<T>(fn: (tx: NodePgDatabase) => Promise<T>): Promise<T> {
    const ctx = RequestContextStore.get();
    const principal = ctx?.principal;

    if (!principal?.tenantId) {
      throw new ReplicaTenantContextMissingError(
        'run() called without an active RequestContext — ensure all replica queries ' +
          'originate within a request interceptor that sets the principal.',
      );
    }

    const { tenantId, traceId } = principal;

    this.logger.debug('Opening replica transaction', { tenantId, traceId });

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT
          set_config('app.current_tenant',                    ${tenantId},  true),
          set_config('statement_timeout',                     ${'30000'},   true),
          set_config('idle_in_transaction_session_timeout',   ${'60000'},   true)
      `);

      return fn(tx as unknown as NodePgDatabase);
    });
  }
}
