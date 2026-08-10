/**
 * Typed database client factory.
 *
 * Creates a drizzle-orm client backed by the postgres.js driver.
 * Used by application services and test helpers.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export type DbClient = ReturnType<typeof createDbClient>;

export function createDbClient(connectionString: string) {
  const sql = postgres(connectionString, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  return drizzle(sql, { schema, logger: process.env['NODE_ENV'] === 'development' });
}
