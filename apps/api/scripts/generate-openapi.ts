/**
 * generate-openapi.ts — CLI script to generate or verify the OpenAPI snapshot.
 *
 * Usage:
 *   pnpm generate-openapi          — regenerate openapi-snapshot.json
 *   pnpm check-openapi             — fail if snapshot differs from generated doc
 *
 * In CI: `pnpm check-openapi` runs after build. If a developer changes a
 * decorator without running `pnpm generate-openapi`, the CI check fails
 * with a diff showing what changed.
 */

import { NestFactory } from '@nestjs/core';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import 'reflect-metadata';

// Set test env before importing AppModule
process.env['DATABASE_URL'] ??= 'postgresql://user:pass@localhost:5432/db';
process.env['REDIS_URL'] ??= 'redis://localhost:6379';
process.env['OIDC_ISSUER'] ??= 'https://auth.example.com';
process.env['HMAC_SECRET'] ??= 'generate-openapi-hmac-secret-at-least-32-chars';
process.env['NODE_ENV'] ??= 'development';

import { AppModule } from '../src/app.module';
import { setupOpenApi } from '../src/openapi/openapi';

const SNAPSHOT_PATH = join(__dirname, '..', 'openapi-snapshot.json');
const isCheckMode = process.argv.includes('--check');

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');

  const document = setupOpenApi(app);

  await app.close();

  const generated = JSON.stringify(document, null, 2);

  if (isCheckMode) {
    if (!existsSync(SNAPSHOT_PATH)) {
      console.error('ERROR: openapi-snapshot.json does not exist. Run `pnpm generate-openapi` first.');
      process.exit(1);
    }

    const committed = readFileSync(SNAPSHOT_PATH, 'utf-8');
    if (generated !== committed) {
      console.error(
        'ERROR: OpenAPI snapshot is out of date.\n' +
        'Run `pnpm generate-openapi` and commit the updated openapi-snapshot.json.',
      );
      process.exit(1);
    }

    console.log('OK: OpenAPI snapshot is up to date.');
  } else {
    writeFileSync(SNAPSHOT_PATH, generated, 'utf-8');
    console.log(`Written: ${SNAPSHOT_PATH}`);
  }
}

main().catch((err: unknown) => {
  console.error('generate-openapi failed:', err);
  process.exit(1);
});
