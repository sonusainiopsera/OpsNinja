/**
 * Global test setup for the isolation harness.
 *
 * When ISOLATION_TEST_DB_URL is set, this module:
 *   1. Validates the connection is to a test database (host contains
 *      localhost, test, or ci to prevent accidental production runs).
 *   2. Runs all migrations against the database.
 *   3. Seeds two deterministic tenants using the factory dataset.
 *
 * When the environment variable is absent, setup is a no-op and all
 * database-backed isolation tests skip themselves.
 *
 * Usage in jest.config:
 *   globalSetup: './test/setup/global-setup.ts'
 *
 * Or require it from a beforeAll in the test file for ad-hoc setup.
 */

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { Pool } from 'pg';

// ── Config ─────────────────────────────────────────────────────────────────────

const TEST_DB_HOSTS = ['localhost', '127.0.0.1', 'test', 'ci', 'postgres-test'];

function isTestDatabase(url: string): boolean {
  return TEST_DB_HOSTS.some((h) => url.includes(h));
}

// ── Migration runner ────────────────────────────────────────────────────────────

async function runMigrations(pool: Pool): Promise<void> {
  const migrationsDir = join(__dirname, '../../../../packages/db/migrations');

  let files: string[];
  try {
    files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();
  } catch {
    console.warn('[global-setup] No migrations directory found at', migrationsDir);
    return;
  }

  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf-8');
    try {
      await pool.query(sql);
      console.log(`[global-setup] Applied migration: ${file}`);
    } catch (err: unknown) {
      // Ignore "already exists" errors to make migrations idempotent
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists') || msg.includes('duplicate_object')) {
        console.log(`[global-setup] Skipped (idempotent): ${file}`);
      } else {
        throw new Error(`Migration ${file} failed: ${msg}`);
      }
    }
  }
}

// ── Seed helper ─────────────────────────────────────────────────────────────────

async function seedTwoTenants(pool: Pool): Promise<void> {
  const { DATASET } = await import('../fixtures/tenant-factory');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const org of DATASET.organizations) {
      await client.query(
        `INSERT INTO organizations (id, tenant_id, name, domain, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        [org.id, org.tenantId, org.name, org.domain, org.isActive],
      );
    }

    await client.query('COMMIT');
    console.log('[global-setup] Seeded two-tenant dataset');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Public API ──────────────────────────────────────────────────────────────────

export interface IsolationTestContext {
  pool: Pool;
  dbUrl: string;
  teardown(): Promise<void>;
}

/**
 * Returns a connected pool + teardown function, or null if no test DB is
 * configured.  Tests should skip when this returns null.
 */
export async function setupIsolationDb(): Promise<IsolationTestContext | null> {
  const dbUrl = process.env.ISOLATION_TEST_DB_URL ?? process.env.TEST_DATABASE_URL;

  if (!dbUrl) {
    return null;
  }

  if (!isTestDatabase(dbUrl)) {
    throw new Error(
      `[global-setup] ISOLATION_TEST_DB_URL "${dbUrl}" does not look like a test database. ` +
        `Refusing to run isolation tests against a non-test host.`,
    );
  }

  const pool = new Pool({ connectionString: dbUrl, max: 3 });

  try {
    await pool.query('SELECT 1');
  } catch (err) {
    throw new Error(
      `[global-setup] Cannot connect to test database at ${dbUrl}: ${err instanceof Error ? err.message : err}`,
    );
  }

  await runMigrations(pool);
  await seedTwoTenants(pool);

  return {
    pool,
    dbUrl,
    async teardown() {
      await pool.end();
    },
  };
}
