/**
 * @opsninja/db — shared database package.
 *
 * Exports the pool, Drizzle client, transaction handle factory, and schema.
 * Access to this package from application code is restricted by an ESLint
 * boundary rule to apps/api/src/data only.
 */

export { pool, createPool } from './pool';
export { db, createTransactionHandle } from './client';
export type { DrizzleDB, TxHandle, DbSchema } from './client';
export * as schema from './schema';
export * from './schema';
