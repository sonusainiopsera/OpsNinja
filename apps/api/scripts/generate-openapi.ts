#!/usr/bin/env ts-node
/**
 * OpenAPI document generation script (WO-099, AC1, AC8).
 *
 * Emits two documents:
 *   1. docs/api/openapi.public.json  — public tenant-facing surface (committed snapshot)
 *   2. docs/api/openapi.internal.json — full surface for tooling
 *
 * Also validates the public document against basic OpenAPI 3.1 structural
 * requirements (completeness guard) and optionally diffs it against the
 * committed snapshot to detect undeclared breaking changes (AC8).
 *
 * Usage:
 *   ts-node apps/api/scripts/generate-openapi.ts               # generate + validate
 *   ts-node apps/api/scripts/generate-openapi.ts --diff        # generate + validate + diff
 *   ts-node apps/api/scripts/generate-openapi.ts --no-snapshot # skip snapshot update
 *
 * CI pipeline should run with --diff to fail on undeclared changes.
 *
 * The script requires NO live database or third-party connectivity — it
 * only imports pure TypeScript/JavaScript modules (AC: Error Handling).
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildDocument, getPublicOperationIds, getInternalOperationIds } from '../src/openapi/openapi.builder';

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../../..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs/api');
const PUBLIC_SNAPSHOT = path.join(DOCS_DIR, 'openapi.public.json');
const INTERNAL_SNAPSHOT = path.join(DOCS_DIR, 'openapi.internal.json');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const DIFF_MODE = args.includes('--diff');
const NO_SNAPSHOT = args.includes('--no-snapshot');

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function generate(): void {
  console.log('▶  Generating OpenAPI documents...');

  // Build both documents — completeness guard runs inside buildDocument()
  const publicDoc = buildDocument({ visibility: 'public' });
  const internalDoc = buildDocument({ visibility: 'internal' });

  const publicJson = JSON.stringify(publicDoc, null, 2);
  const internalJson = JSON.stringify(internalDoc, null, 2);

  // Ensure output directory exists
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  // Validate structural correctness before writing
  validateStructure(publicDoc, 'public');
  validateStructure(internalDoc, 'internal');

  if (!NO_SNAPSHOT) {
    fs.writeFileSync(PUBLIC_SNAPSHOT, publicJson + '\n', 'utf8');
    fs.writeFileSync(INTERNAL_SNAPSHOT, internalJson + '\n', 'utf8');
    console.log(`✅  Written: ${PUBLIC_SNAPSHOT}`);
    console.log(`✅  Written: ${INTERNAL_SNAPSHOT}`);
  }

  // Summary
  const publicOps = getPublicOperationIds();
  const internalOps = getInternalOperationIds();
  console.log(`\n📋  Operations: ${publicOps.length} public, ${internalOps.length} internal`);
  console.log(`    Public:   ${publicOps.join(', ')}`);
  console.log(`    Internal: ${internalOps.join(', ')}`);

  // Diff mode — compare against existing snapshot (AC8)
  if (DIFF_MODE) {
    runSnapshotDiff(publicJson);
  }

  console.log('\n✅  OpenAPI generation complete.');
}

// ---------------------------------------------------------------------------
// Structural validator — lightweight before writing
// ---------------------------------------------------------------------------

function validateStructure(
  doc: ReturnType<typeof buildDocument>,
  label: string,
): void {
  const errors: string[] = [];

  if (doc.openapi !== '3.1.0') {
    errors.push(`openapi version must be 3.1.0, got ${doc.openapi}`);
  }
  if (!doc.info?.title) errors.push('info.title is required');
  if (!doc.info?.version) errors.push('info.version is required');
  if (!doc.paths || Object.keys(doc.paths).length === 0) {
    errors.push('paths must not be empty');
  }
  if (!doc.components?.securitySchemes) {
    errors.push('components.securitySchemes must be defined');
  }
  if (!doc.components?.schemas?.ErrorEnvelope) {
    errors.push('components.schemas.ErrorEnvelope must be defined');
  }

  // Every path must use /api/v1 prefix
  for (const p of Object.keys(doc.paths)) {
    if (!p.startsWith('/api/v1')) {
      errors.push(`Path ${p} does not start with /api/v1`);
    }
  }

  if (errors.length > 0) {
    console.error(`\n❌  Structural validation failed for ${label} document:`);
    for (const e of errors) console.error(`    - ${e}`);
    process.exit(1);
  }

  console.log(`✅  ${label} document structure valid (${Object.keys(doc.paths).length} paths)`);
}

// ---------------------------------------------------------------------------
// Snapshot diff (AC8)
// ---------------------------------------------------------------------------

type ChangeClass = 'additive' | 'breaking' | 'unknown';

interface DiffResult {
  changed: boolean;
  classification: ChangeClass;
  details: string[];
}

function runSnapshotDiff(newJson: string): void {
  console.log('\n🔍  Running snapshot diff...');

  if (!fs.existsSync(PUBLIC_SNAPSHOT)) {
    console.log('    No existing snapshot found — treating as initial commit (additive).');
    return;
  }

  const existing = fs.readFileSync(PUBLIC_SNAPSHOT, 'utf8');

  if (existing.trimEnd() === newJson.trimEnd()) {
    console.log('✅  No diff — document unchanged.');
    return;
  }

  const result = classifyDiff(JSON.parse(existing), JSON.parse(newJson));

  if (!result.changed) {
    console.log('✅  No semantic diff.');
    return;
  }

  console.log(`\n⚠️   Document changed. Classification: ${result.classification.toUpperCase()}`);
  for (const d of result.details) {
    console.log(`    ${d}`);
  }

  if (result.classification === 'breaking') {
    console.error(
      '\n❌  BREAKING CHANGE detected in the public OpenAPI document.\n' +
        '    Remediation:\n' +
        '      1. Confirm this change is intentional.\n' +
        "      2. Bump info.version and add a deprecation notice on the old operation.\n" +
        '      3. Obtain the "api:breaking-change-approved" label on the PR.\n' +
        '      4. Regenerate the snapshot: ts-node apps/api/scripts/generate-openapi.ts\n',
    );
    process.exit(1);
  }

  console.log('\n✅  Additive change — safe to merge without explicit approval.');
}

// ---------------------------------------------------------------------------
// Diff classifier
// ---------------------------------------------------------------------------

function classifyDiff(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): DiffResult {
  const details: string[] = [];
  let classification: ChangeClass = 'additive';

  const existingPaths = Object.keys((existing['paths'] as Record<string, unknown>) ?? {});
  const nextPaths = Object.keys((next['paths'] as Record<string, unknown>) ?? {});

  // Removed paths = breaking
  for (const p of existingPaths) {
    if (!nextPaths.includes(p)) {
      details.push(`BREAKING: path removed: ${p}`);
      classification = 'breaking';
    }
  }

  // New paths = additive
  for (const p of nextPaths) {
    if (!existingPaths.includes(p)) {
      details.push(`ADDITIVE: new path: ${p}`);
    }
  }

  // Existing schema properties — removed required field = breaking
  const existingSchemas = (existing['components'] as Record<string, unknown>)?.['schemas'] as
    | Record<string, unknown>
    | undefined;
  const nextSchemas = (next['components'] as Record<string, unknown>)?.['schemas'] as
    | Record<string, unknown>
    | undefined;

  if (existingSchemas && nextSchemas) {
    for (const [name, schema] of Object.entries(existingSchemas)) {
      const nextSchema = nextSchemas[name] as Record<string, unknown> | undefined;
      if (!nextSchema) {
        details.push(`BREAKING: schema removed: ${name}`);
        classification = 'breaking';
        continue;
      }
      const existingRequired = ((schema as Record<string, unknown>)['required'] as string[]) ?? [];
      const nextRequired = ((nextSchema as Record<string, unknown>)['required'] as string[]) ?? [];
      for (const field of existingRequired) {
        if (!nextRequired.includes(field)) {
          details.push(`BREAKING: required field removed from ${name}: ${field}`);
          classification = 'breaking';
        }
      }
    }
  }

  if (details.length === 0) {
    details.push('No semantic differences detected.');
  }

  return { changed: details.some((d) => !d.startsWith('No ')), classification, details };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

generate();
