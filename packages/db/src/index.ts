/**
 * Main entry point for @opsninja/db.
 *
 * Re-exports the schema and provides a typed database client factory.
 */
export * from './schema/index.js';
export { createDbClient } from './client.js';
