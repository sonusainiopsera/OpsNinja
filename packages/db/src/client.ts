/**
 * Drizzle ORM client bound to the shared connection pool.
 *
 * This module is restricted to apps/api/src/data via the ESLint boundary rule.
 * All application code that needs database access must go through the unit-of-work.
 */

import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { PoolClient } from 'pg';
import { pool } from './pool';
import * as schema from './schema';

export type DbSchema = typeof schema;

/**
 * The base Drizzle DB type with the full schema attached.
 */
export type DrizzleDB = NodePgDatabase<DbSchema>;

/**
 * A Drizzle DB instance scoped to a single PoolClient (i.e., a transaction handle).
 * Used by withTenantTransaction to give handlers a type-safe query builder that
 * automatically routes through the already-open transaction connection.
 */
export type TxHandle = NodePgDatabase<DbSchema>;

/**
 * Singleton Drizzle client for the pool. Used internally by the unit-of-work
 * to introspect the schema; actual transactional access goes through
 * createTransactionHandle().
 */
export const db = drizzle(pool, { schema });

/**
 * Create a Drizzle instance bound to an already-acquired PoolClient.
 * This allows the unit-of-work to open a transaction on the raw client
 * (so it can issue SET LOCAL before any ORM calls) and then hand the
 * application code a typed query builder over that same connection.
 */
export function createTransactionHandle(client: PoolClient): TxHandle {
  // drizzle() accepts a Client (which PoolClient extends), so this is safe.
  return drizzle(client as unknown as Parameters<typeof drizzle>[0], { schema });
}
