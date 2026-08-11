/**
 * Reporting replica pool.
 *
 * Creates a dedicated node-postgres Pool pointed at REPORTING_REPLICA_URL.
 * This pool is injected under the REPORTING_DB DI token and is the ONLY
 * data connection the reporting module may use. The primary pool (pool from
 * @opsninja/db) is never resolvable inside this module.
 *
 * On-connect hook sets three session-level safety properties:
 *   statement_timeout                  30 s  → maps to StatementTimeoutError (504)
 *   idle_in_transaction_session_timeout 60 s  → aborts stalled transactions
 *   default_transaction_read_only      on    → second line of defence; no write can
 *                                             accidentally land on the replica
 *
 * Credentials are injected at runtime via REPORTING_REPLICA_URL from Secrets
 * Manager. No connection string appears in any committed file.
 */

import { Pool, PoolClient } from 'pg';

export const REPORTING_DB = Symbol('REPORTING_DB');

export function createReplicaPool(): Pool {
  const replicaPool = new Pool({
    connectionString: process.env['REPORTING_REPLICA_URL'],
    max: 8,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: false,
  });

  replicaPool.on('connect', (client: PoolClient) => {
    void client
      .query(`
        SET statement_timeout = 30000;
        SET idle_in_transaction_session_timeout = 60000;
        SET default_transaction_read_only = on
      `)
      .catch((err: Error) => {
        console.error(
          '[reporting-replica:pool] Session setup failed on connect',
          { message: err.message },
        );
      });
  });

  replicaPool.on('error', (err: Error) => {
    console.error('[reporting-replica:pool] Unexpected client error', {
      message: err.message,
      code: (err as NodeJS.ErrnoException).code,
    });
  });

  return replicaPool;
}
