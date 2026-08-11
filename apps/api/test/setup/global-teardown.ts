/**
 * Global test teardown — removes harness fixture data after the isolation suite.
 */

import { Pool } from 'pg';

export default async function globalTeardown(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) return;

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const { teardownHarnessData } = await import('../fixtures/tenant-factory');
    await teardownHarnessData(client);
    console.log('[global-teardown] Harness fixtures removed');
  } finally {
    client.release();
    await pool.end();
  }
}
