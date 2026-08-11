/**
 * filter-boundary.spec.ts
 *
 * Architecture test: asserts that no module in apps/api builds ticket filter SQL
 * outside @opsninja/filter-compiler. This is a source-scan test — it reads
 * TypeScript source files and looks for patterns that indicate inline SQL construction
 * for ticket filtering.
 *
 * A violation means a module is constructing filter SQL manually, which bypasses
 * the allow-listed field registry and creates an injection surface.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, it, expect } from '@jest/globals';

const API_SRC = path.resolve(__dirname, '../../src');
const MODULES_DIR = path.join(API_SRC, 'modules');

/** Patterns that indicate inline ticket filter SQL (outside the compiler package) */
const FORBIDDEN_PATTERNS = [
  // Raw SQL string construction for filtering
  /sql`[^`]*WHERE[^`]*tickets\.[^`]*`/i,
  // Direct drizzle where() calls with dynamic user-supplied column names
  /\.where\s*\(\s*(?:eq|ne|gt|lt|gte|lte|like|ilike)\s*\(\s*(?:tickets|sql)\.\w+\s*,\s*(?:body|params|query|filter|raw)\./i,
  // String template literal SQL injection
  /`.*\$\{.*filter.*\}.*WHERE.*`/i,
  /`.*WHERE.*\$\{.*\}.*`/i,
];

/** Files allowed to contain these patterns (the filter compiler source itself, tests) */
const ALLOWED_PATHS = [
  path.join(API_SRC, 'common', 'db', 'scoped-query.helper.ts'), // portal scoped predicates (hardcoded, not user-supplied)
  path.join(API_SRC, 'modules', 'tickets', 'repositories'),
];

function isAllowed(filePath: string): boolean {
  return ALLOWED_PATHS.some(allowed => filePath.startsWith(allowed));
}

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('Filter boundary — no inline ticket SQL outside filter-compiler', () => {
  const sourceFiles = collectTsFiles(MODULES_DIR).filter(f => !isAllowed(f));

  it('source files list is non-empty (sanity check)', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it('no views or reporting module has inline SQL string templates for ticket filtering', () => {
    const violations: string[] = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${path.relative(API_SRC, file)}: matches ${pattern}`);
          break;
        }
      }
    }
    if (violations.length > 0) {
      throw new Error(
        'Filter boundary violation — the following files construct ticket filter SQL outside @opsninja/filter-compiler:\n' +
          violations.map(v => `  ${v}`).join('\n'),
      );
    }
  });

  it('both views and reporting modules import from @opsninja/filter-compiler', () => {
    const viewsFile = path.join(API_SRC, 'modules', 'views', 'saved-view.service.ts');
    const reportingFile = path.join(API_SRC, 'modules', 'reporting', 'report-filter.service.ts');

    for (const file of [viewsFile, reportingFile]) {
      expect(fs.existsSync(file), `${file} should exist`).toBe(true);
      const content = fs.readFileSync(file, 'utf-8');
      expect(content, `${file} should import from @opsninja/filter-compiler`).toContain(
        "@opsninja/filter-compiler",
      );
    }
  });

  it('filter-compiler is not duplicated — only one package does AST compilation', () => {
    // Check that no module OUTSIDE views/reporting implements its own AST walk
    const forbiddenInOtherModules = /type\s*=\s*['"](group|condition)['"]\s*&&/;
    const otherModuleFiles = sourceFiles.filter(
      f =>
        !f.includes('/views/') &&
        !f.includes('/reporting/'),
    );
    const violations: string[] = [];
    for (const file of otherModuleFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (forbiddenInOtherModules.test(content)) {
        violations.push(path.relative(API_SRC, file));
      }
    }
    expect(violations).toEqual([]);
  });
});
