#!/usr/bin/env ts-node
/**
 * Seed CLI — commands: seed, reset, verify.
 *
 * Usage:
 *   ts-node src/cli.ts seed --profile small [--seed 42]
 *   ts-node src/cli.ts seed --profile large --seed 12345
 *   ts-node src/cli.ts reset
 *   ts-node src/cli.ts verify --manifest ./seed-manifest.json
 *
 * DATABASE_URL must be set. Refuses to run against non-test hosts.
 */

import { SeedRunner } from './persistence/seed-runner';
import { PROFILES, Profile } from './profiles';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Arg parser (no third-party deps)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = true;
      }
    } else if (!arg.startsWith('-') && i === 0) {
      result['command'] = arg;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = String(args['command'] ?? 'seed');
  const connectionString = process.env['DATABASE_URL'] ?? '';

  if (!connectionString) {
    console.error('[test-seed] DATABASE_URL is not set');
    process.exit(1);
  }

  const runner = new SeedRunner();

  if (command === 'seed') {
    const profileName = String(args['profile'] ?? 'small') as Profile;
    const profile = PROFILES[profileName];
    if (!profile) {
      console.error(`[test-seed] Unknown profile: ${profileName}. Valid: small, medium, large`);
      process.exit(1);
    }

    const seed = parseInt(String(args['seed'] ?? '42'), 10);
    const now = new Date();

    console.log(`[test-seed] Seeding ${profileName} profile (seed=${seed})...`);
    const manifest = await runner.run({
      connectionString,
      profile,
      seed,
      now,
      verbose: true,
    });

    const manifestPath = `./seed-manifest-${profileName}-${seed}.json`;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`[test-seed] Manifest written to ${manifestPath}`);
    console.log('[test-seed] Done.');

  } else if (command === 'reset') {
    console.log('[test-seed] Resetting seed data...');
    await runner.reset(connectionString);
    console.log('[test-seed] Reset complete.');

  } else if (command === 'verify') {
    const manifestPath = String(args['manifest'] ?? './seed-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      console.error(`[test-seed] Manifest not found: ${manifestPath}`);
      process.exit(1);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    const valid = await runner.verify(connectionString, manifest as Parameters<typeof runner.verify>[1]);
    if (valid) {
      console.log('[test-seed] Checksum verified ✓');
    } else {
      console.error('[test-seed] Checksum mismatch — dataset may have been modified');
      process.exit(1);
    }

  } else {
    console.error(`[test-seed] Unknown command: ${command}. Valid: seed, reset, verify`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[test-seed] Fatal error:', (err as Error).message);
  process.exit(1);
});
