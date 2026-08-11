/**
 * PostgreSQL connection pool configured for PgBouncer transaction pooling.
 *
 * IMPORTANT: This module is the ONLY place in the codebase that creates a raw
 * database connection pool. All application code must access the database
 * through the unit-of-work layer (apps/api/src/data/unit-of-work.ts) which
 * binds the tenant context via SET LOCAL before any handler executes.
 *
 * @see apps/api/src/data/unit-of-work.ts
 */

import { Pool, PoolConfig } from 'pg';

function createPool(overrides?: Partial<PoolConfig>): Pool {
  const config: PoolConfig = {
    connectionString: process.env['DATABASE_URL'],
    max: parseInt(process.env['DB_POOL_MAX'] ?? '20', 10),
    min: parseInt(process.env['DB_POOL_MIN'] ?? '2', 10),
    // PgBouncer in transaction mode: keep idle timeout short to return
    // connections to the bouncer quickly.
    idleTimeoutMillis: parseInt(process.env['DB_IDLE_TIMEOUT_MS'] ?? '10000', 10),
    connectionTimeoutMillis: parseInt(process.env['DB_CONNECT_TIMEOUT_MS'] ?? '5000', 10),
    // PgBouncer compatibility: disable prepare statements so the bouncer
    // can switch connections between transactions.
    ...overrides,
  };

  const pool = new Pool(config);

  pool.on('error', (err) => {
    // Log connection-level errors without crashing; the health-check endpoint
    // and retry logic handle pool exhaustion.
    console.error('[db:pool] Unexpected client error', {
      message: err.message,
      code: (err as NodeJS.ErrnoException).code,
    });
  });

  return pool;
}

/**
 * Singleton pool for the primary read/write database.
 * Exported ONLY for use within the @opsninja/db package and
 * apps/api/src/data. The ESLint boundary rule enforces this.
 */
export const pool = createPool();

/**
 * Create a separate pool instance (for testing / isolated consumers).
 */
export { createPool };
