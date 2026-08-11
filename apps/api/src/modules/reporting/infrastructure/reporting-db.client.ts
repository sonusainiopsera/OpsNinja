/**
 * ReportingDbClient
 *
 * Wraps the read-replica node-postgres Pool and Drizzle DB instance.
 * Attaches the session-level on-connect guardrails before any connection
 * enters the pool's idle queue.
 *
 * Exposes:
 *  - `pool`  – raw pg Pool (for tests and ReplicaLagProbe that need direct access)
 *  - `db`    – Drizzle instance (for TenantScopedReplicaRunner)
 *
 * NOTE: This class lives inside `modules/reporting/infrastructure/` and therefore
 * bypasses the ESLint restriction on apps/api/src/data/** because the reporting
 * module owns its own data-access boundary (enforcement is via REPORTING_DB DI
 * token isolation, not file-system restriction).
 */

import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

export type ReplicaDb = NodePgDatabase;

@Injectable()
export class ReportingDbClient implements OnApplicationShutdown {
  private readonly logger = new Logger(ReportingDbClient.name);

  readonly pool: Pool;
  readonly db: ReplicaDb;

  constructor(pool: Pool) {
    this.pool = pool;
    this.attachConnectHook();
    this.db = drizzle(pool);
  }

  /**
   * Sets session-level GUCs on every fresh connection before it enters the
   * idle queue.  Runs outside a transaction so SET (not set_config) is correct
   * here — each connection gets its own session defaults regardless of pooler.
   *
   * read_only is a second line of defence: even if a bug constructs a mutation,
   * Postgres will reject it at the connection level.
   */
  private attachConnectHook(): void {
    this.pool.on('connect', async (client: PoolClient) => {
      try {
        await client.query(
          'SET statement_timeout = 30000;' +
            'SET idle_in_transaction_session_timeout = 60000;' +
            'SET default_transaction_read_only = on;',
        );
      } catch (err) {
        this.logger.error('Replica on-connect hook failed; connection may be misconfigured', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
