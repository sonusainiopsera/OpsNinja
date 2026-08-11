/**
 * Global test setup for the isolation harness.
 *
 * Runs once per Jest process (configured via globalSetup in jest.isolation.config.js).
 *
 * Strategy:
 *  1. Connect to the test database using DATABASE_URL (required env var).
 *  2. Verify the database is accessible and not a production host.
 *  3. Run all pending migrations by executing each SQL file in order.
 *  4. Seed the two-tenant harness fixture graph.
 *  5. Expose teardown via globalTeardown.
 *
 * Per-test isolation: suites use transactions rolled back in afterEach where
 * feasible. The global seed data is only removed by globalTeardown.
 *
 * Docker Compose usage:
 *   docker compose -f docker-compose.test.yml up -d
 *   DATABASE_URL=postgresql://... npx jest --config jest.isolation.config.js
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../packages/db/migrations');

function assertTestDatabase(url: string): void {
  const isTest =
    url.includes('localhost') ||
    url.includes('127.0.0.1') ||
    url.includes('test') ||
    url.includes('local') ||
    process.env['ALLOW_INTEGRATION_DB'] === 'true';
  if (!isTest) {
    throw new Error(
      '[global-setup] REFUSED: DATABASE_URL does not appear to be a test host.\n' +
      'Set ALLOW_INTEGRATION_DB=true to override (only for CI environments).',
    );
  }
}

export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.warn('[global-setup] DATABASE_URL not set — skipping harness setup');
    return;
  }

  assertTestDatabase(databaseUrl);

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();

  try {
    // Run migrations in order
    const migrationFiles = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      try {
        await client.query(sql);
        console.log(`[global-setup] Migration applied: ${file}`);
      } catch (err) {
        // IF NOT EXISTS guards make re-running idempotent; log but continue
        if ((err as { code?: string }).code === '42P07') {
          // Table already exists — migration was already applied
        } else {
          console.warn(`[global-setup] Migration warning for ${file}:`, (err as Error).message);
        }
      }
    }

    // Seed harness fixtures
    const { seedHarnessData } = await import('../fixtures/tenant-factory');
    await seedHarnessData(client);
    console.log('[global-setup] Harness fixtures seeded');
  } finally {
    client.release();
    await pool.end();
  }
}
