/**
 * assert-bundle-isolation.ts
 *
 * Parses the Next.js production build manifest and all emitted JS chunks,
 * searching for deny-listed module identifiers that must never appear in the
 * portal bundle. Exits non-zero with the offending module so CI failures are
 * actionable.
 *
 * Run after `next build`:
 *   node --loader ts-node/esm scripts/assert-bundle-isolation.ts
 */

import fs from 'node:fs';
import path from 'node:path';

// Identifiers that must never appear in portal bundle chunks
const DENY_LIST: readonly string[] = [
  'SlaCountdown',
  'SlaClockProvider',
  'useSlaClockContext',
  'InternalNote',
  'internal-note',
  'TenantSwitcher',
  'GlobalSearch',
  'LiveStatusPill',
  'ExportMenu',
  // The ui-kit root barrel should not be present — only the /portal subset
  '@opsninja/ui-kit/src/index',
];

const BUILD_DIR = path.resolve(process.cwd(), '.next');

function collectChunkFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectChunkFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkFile(filePath: string): Array<{ module: string; file: string }> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const violations: Array<{ module: string; file: string }> = [];
  for (const id of DENY_LIST) {
    if (content.includes(id)) {
      violations.push({ module: id, file: path.relative(BUILD_DIR, filePath) });
    }
  }
  return violations;
}

function main() {
  if (!fs.existsSync(BUILD_DIR)) {
    console.error(
      '[assert-bundle-isolation] ERROR: .next/ directory not found. Run `next build` first.',
    );
    process.exit(1);
  }

  const chunksDir = path.join(BUILD_DIR, 'static', 'chunks');
  const serverDir = path.join(BUILD_DIR, 'server');
  const chunkFiles = [...collectChunkFiles(chunksDir), ...collectChunkFiles(serverDir)];

  if (chunkFiles.length === 0) {
    console.error(
      '[assert-bundle-isolation] ERROR: No JS chunk files found under .next/. Ensure build completed successfully.',
    );
    process.exit(1);
  }

  const allViolations: Array<{ module: string; file: string }> = [];
  for (const file of chunkFiles) {
    allViolations.push(...checkFile(file));
  }

  if (allViolations.length === 0) {
    console.log(
      `[assert-bundle-isolation] PASS — ${chunkFiles.length} chunk(s) checked, no deny-listed modules found.`,
    );
    process.exit(0);
  }

  console.error('[assert-bundle-isolation] FAIL — deny-listed module(s) found in portal bundle:');
  for (const v of allViolations) {
    console.error(`  Module: "${v.module}" found in chunk: ${v.file}`);
  }
  console.error(
    '\nFix: ensure no portal component imports from "@opsninja/ui-kit" root barrel or any agent-only path.',
  );
  process.exit(1);
}

main();
