/**
 * @opsninja/db – Database client and schema exports.
 *
 * IMPORTANT: The raw `pool` and `createPool` exports are intentionally
 * restricted to `apps/api/src/data/**` by the ESLint boundary rule in
 * .eslintrc.cjs.  All other application code must access the database
 * exclusively through UnitOfWork.withTenantTransaction() or by extending
 * TenantRepository.
 */

import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, PoolConfig } from 'pg';
import * as schema from './schema';

export * from './schema';
export { Pool, PoolConfig };

// ─── Schema type ──────────────────────────────────────────────────────────────
export type Schema = typeof schema;

// ─── Drizzle DB type (full db with schema) ────────────────────────────────────
export type DB = NodePgDatabase<Schema>;

/**
 * A handle usable for queries – can be either the full pool-backed DB or a
 * transaction handle (both share the same Drizzle query API).
 */
export type DrizzleHandle = NodePgDatabase<Schema>;

// ─── Pool factory ─────────────────────────────────────────────────────────────
// NOTE: This export is restricted to apps/api/src/data/** by ESLint.
export function createPool(config: PoolConfig): Pool {
  return new Pool({
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...config,
  });
}

// ─── Drizzle factory ──────────────────────────────────────────────────────────
// NOTE: This export is restricted to apps/api/src/data/** by ESLint.
export function createDrizzle(poolOrClient: Pool | ConstructorParameters<typeof Pool>[0]): DB {
  const p = poolOrClient instanceof Pool ? poolOrClient : new Pool(poolOrClient);
  return drizzle(p, { schema });
}

// Re-export drizzle sql tag for parameterised queries
export { sql, eq, and, or, inArray, isNull, isNotNull } from 'drizzle-orm';
