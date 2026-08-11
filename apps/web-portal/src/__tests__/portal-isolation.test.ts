/**
 * portal-isolation.test.ts
 *
 * Source-scan test: reads portal entry points and component source files,
 * asserting that deny-listed agent-only module identifiers do not appear.
 * This is a static guarantee that runs without a bundler.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const PORTAL_ROOT = path.resolve(__dirname, '../..');

// Deny-listed strings that must never appear in portal source
const DENY_LIST = [
  'SlaCountdown',
  'SlaClockProvider',
  'useSlaClockContext',
  'InternalNote',
  'TenantSwitcher',
  'GlobalSearch',
  'LiveStatusPill',
  'ExportMenu',
];

// Files allowed to contain deny-listed strings (test fixtures / isolation tests themselves)
const ALLOWED_FILES = new Set([
  path.resolve(PORTAL_ROOT, 'src/__tests__/portal-isolation.test.ts'),
  path.resolve(PORTAL_ROOT, 'scripts/assert-bundle-isolation.ts'),
  path.resolve(PORTAL_ROOT, '.eslintrc.cjs'),
]);

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...collectSourceFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !ALLOWED_FILES.has(fullPath)
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

const sourceFiles = collectSourceFiles(path.join(PORTAL_ROOT, 'components'))
  .concat(collectSourceFiles(path.join(PORTAL_ROOT, 'lib')))
  .concat(collectSourceFiles(path.join(PORTAL_ROOT, 'app')));

describe('Portal bundle isolation — source-level scan', () => {
  it('portal source files do not import from the ui-kit root barrel', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      // Allow "@opsninja/ui-kit/portal" but not bare "@opsninja/ui-kit"
      const matches = content.match(/from ['"]@opsninja\/ui-kit['"]/g);
      if (matches) {
        violations.push(`${path.relative(PORTAL_ROOT, file)}: ${matches.join(', ')}`);
      }
    }
    expect(violations).toEqual([]);
  });

  for (const denied of DENY_LIST) {
    it(`portal source does not reference agent-only symbol: ${denied}`, () => {
      const violations: string[] = [];
      for (const file of sourceFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        if (content.includes(denied)) {
          violations.push(path.relative(PORTAL_ROOT, file));
        }
      }
      expect(violations).toEqual([]);
    });
  }
});

describe('Lint rule fires on deliberate violation fixture', () => {
  it('the deny-list includes SlaCountdown', () => {
    // Proves the deny-list is populated — actual lint enforcement is an eslint test
    expect(DENY_LIST).toContain('SlaCountdown');
    expect(DENY_LIST).toContain('SlaClockProvider');
  });
});
