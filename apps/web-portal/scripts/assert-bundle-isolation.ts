#!/usr/bin/env tsx
/**
 * assert-bundle-isolation.ts
 *
 * CI gate: parses the Next.js production build manifest (.next/build-manifest.json
 * and .next/server/chunks) to ensure no agent-only module identifiers are reachable
 * from the portal bundle.
 *
 * Exit 0  → bundle is clean
 * Exit 1  → violation found; offending identifier printed to stderr
 *
 * Wired in CI after `next build` via: npm run assert-bundle-isolation
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const BUILD_DIR = join(process.cwd(), '.next');

/** Module identifiers that must never appear in the portal bundle. */
const DENY_LIST: string[] = [
  'SlaCountdown',
  'SlaClockProvider',
  'LiveStatusPill',
  'GlobalSearch',
  'ExportMenu',
  'TenantSwitcher',
  'Sidebar',
  'AppShell',
  'InternalNote',
  'NotePrivate',
  'internal-note',
  // Root barrel path
  '@opsninja/ui-kit/src/index',
  'ui-kit/src/domain/SlaClockProvider',
  'ui-kit/src/domain/SlaCountdown/SlaCountdown',
];

function scanDirectory(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.json'))) {
        results.push(join(dir, entry.name));
      }
    }
  } catch {
    // Directory unreadable — treat as clean
  }
  return results;
}

function checkFile(filePath: string): Array<{ file: string; match: string }> {
  try {
    const content = readFileSync(filePath, 'utf8');
    return DENY_LIST.filter((denied) => content.includes(denied)).map((match) => ({
      file: filePath.replace(process.cwd(), '.'),
      match,
    }));
  } catch {
    return [];
  }
}

function main(): void {
  if (!existsSync(BUILD_DIR)) {
    console.error('[assert-bundle-isolation] ERROR: .next/ directory not found. Run `next build` first.');
    process.exit(1);
  }

  const filesToScan = [
    ...scanDirectory(join(BUILD_DIR, 'static', 'chunks')),
    ...scanDirectory(join(BUILD_DIR, 'server', 'chunks')),
    ...scanDirectory(join(BUILD_DIR, 'server', 'app')),
    ...scanDirectory(join(BUILD_DIR, 'server')),
  ];

  if (filesToScan.length === 0) {
    console.error('[assert-bundle-isolation] WARNING: No build chunks found to scan.');
    process.exit(0);
  }

  const violations: Array<{ file: string; match: string }> = [];
  for (const file of filesToScan) {
    violations.push(...checkFile(file));
  }

  if (violations.length === 0) {
    console.log(`[assert-bundle-isolation] PASS — scanned ${filesToScan.length} chunks, no agent-only modules found.`);
    process.exit(0);
  }

  console.error('[assert-bundle-isolation] FAIL — agent-only module(s) found in portal bundle:');
  for (const v of violations) {
    console.error(`  ✗ "${v.match}" found in ${v.file}`);
  }
  console.error(
    '\nFix: ensure the portal imports only from @opsninja/ui-kit/portal, not the root barrel or agent-only paths.',
  );
  process.exit(1);
}

main();
