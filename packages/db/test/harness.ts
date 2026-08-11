/**
 * Test harness for @opsninja/db.
 *
 * Spins up a PostgreSQL 16 container via testcontainers-node, applies all
 * migrations from the migrations/ directory, and returns a typed Drizzle
 * client. Each test suite should call `createTestDb()` in `beforeAll` and
 * `teardownTestDb()` in `afterAll` to ensure container cleanup.
 *
 * Usage:
 *   const { db, teardown } = await createTestDb();
 *   afterAll(teardown);
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from 'testcontainers';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../src/schema/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../migrations');

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export interface TestDbContext {
  db: TestDb;
  connectionString: string;
  teardown: () => Promise<void>;
}

/**
 * Creates a fresh PostgreSQL 16 container, applies all migrations, and
 * returns a typed Drizzle client. The container is stopped when `teardown`
 * is called.
 *
 * @param label - Optional label for logging (defaults to 'test')
 */
export async function createTestDb(label = 'test'): Promise<TestDbContext> {
  console.log(`[harness:${label}] Starting PostgreSQL 16 container…`);

  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('opsninja_test')
    .withUsername('opsninja')
    .withPassword('opsninja_test')
    .start();

  const connectionString = container.getConnectionUri();
  console.log(`[harness:${label}] Container started: ${connectionString}`);

  await applyMigrations(connectionString);
  console.log(`[harness:${label}] Migrations applied.`);

  const sql = postgres(connectionString, { max: 5 });
  const db = drizzle(sql, { schema });

  const teardown = async () => {
    await sql.end();
    await container.stop();
    console.log(`[harness:${label}] Container stopped.`);
  };

  return { db, connectionString, teardown };
}

/**
 * Applies all *.sql migration files from the migrations/ directory in
 * lexicographic order. Runs each file in a single client connection so that
 * BEGIN/COMMIT blocks work as expected.
 */
async function applyMigrations(connectionString: string): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR);
  const sqlFiles = entries
    .filter((f) => f.endsWith('.sql'))
    .sort(); // lexicographic = numeric order for 0001_, 0002_, …

  // Use a raw postgres connection for DDL to avoid Drizzle wrapping issues.
  const sql = postgres(connectionString, { max: 1, onnotice: () => undefined });

  try {
    for (const file of sqlFiles) {
      const filePath = resolve(MIGRATIONS_DIR, file);
      const content = await readFile(filePath, 'utf-8');
      console.log(`[harness] Applying migration: ${file}`);
      // Execute the whole file as one statement batch.
      await sql.unsafe(content);
    }
  } finally {
    await sql.end();
  }
}

/**
 * Helper to truncate all tenant-scoped tables between tests without dropping
 * the schema. Preserves the partitioned table structure.
 */
export async function truncateAll(connectionString: string): Promise<void> {
  const sql = postgres(connectionString, { max: 1 });
  try {
    await sql.unsafe(`
      TRUNCATE TABLE
        ticket_affected_areas,
        ticket_ai_summaries,
        outbox_events,
        audit_logs,
        ticket_comments,
        tickets,
        categories,
        agent_org_scopes,
        user_roles,
        role_assignments,
        refresh_sessions,
        email_verification_tokens,
        pending_user_approvals,
        customer_contacts,
        users,
        custom_field_defs,
        organization_verified_domains,
        organizations,
        retention_policies
      RESTART IDENTITY CASCADE;
    `);
  } finally {
    await sql.end();
  }
}
