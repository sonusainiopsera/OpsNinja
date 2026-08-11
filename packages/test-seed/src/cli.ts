#!/usr/bin/env ts-node
/**
 * CLI entry point for the OpsNinja test seed generator.
 *
 * Usage:
 *   opsninja-seed seed   --profile=small --seed=42 [--dry-run]
 *   opsninja-seed reset  --profile=small
 *   opsninja-seed verify
 *
 * Environment variables:
 *   TEST_DATABASE_URL  – required; must point to a test/local host
 */

import { SeedRunner } from './persistence/seed-runner';
import type { ProfileName } from './profiles';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      args[key] = val === undefined ? true : val;
    } else if (!args['command']) {
      args['command'] = arg;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const command = String(args['command'] ?? 'seed');
  const connectionString = process.env['TEST_DATABASE_URL'] ?? '';

  if (!connectionString) {
    console.error('ERROR: TEST_DATABASE_URL environment variable is required.');
    process.exit(1);
  }

  if (command === 'seed') {
    const profile = (String(args['profile'] ?? 'small')) as ProfileName;
    const seed = parseInt(String(args['seed'] ?? '12345'), 10);
    const dryRun = Boolean(args['dry-run']);

    console.log(`Seeding profile=${profile} seed=${seed} dry-run=${dryRun}`);
    const runner = new SeedRunner({ connectionString, profile, seed, dryRun });
    const manifest = await runner.run();
    console.log('Seed complete:', JSON.stringify(manifest, null, 2));
  } else if (command === 'reset') {
    console.log('Reset: truncating all seeded tables (test database only)...');
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString });
    await pool.query(`
      TRUNCATE TABLE audit_logs, comments, tickets, organizations
      RESTART IDENTITY CASCADE
    `);
    await pool.end();
    console.log('Reset complete.');
  } else if (command === 'verify') {
    const { AnonymisationValidator } = await import('./validation/anonymisation-validator');
    console.log('Running anonymisation verification (dry-run seed)...');
    const runner = new SeedRunner({
      connectionString,
      profile: 'small',
      seed: 42,
      dryRun: true,
      skipValidation: false,
    });
    await runner.run();
    console.log('Verification passed — dataset is GDPR-safe.');
  } else {
    console.error(`Unknown command: ${command}. Valid commands: seed, reset, verify`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Seed CLI error:', err);
  process.exit(1);
});
