/**
 * Architecture test — filter SQL construction boundary.
 *
 * Asserts:
 *   1. @opsninja/filter-compiler is the sole package that constructs filter SQL predicates.
 *   2. The views and reporting modules import compileToPredicate from @opsninja/filter-compiler.
 *   3. No ticket/views/reporting module contains hand-rolled SQL filter strings
 *      (e.g., raw WHERE clauses mentioning ticket columns).
 *   4. The filter-compiler package itself has no framework/NestJS/Drizzle imports
 *      (preserving the functional-core, unit-testable guarantee).
 *
 * This test fails the pipeline if a developer bypasses the compiler by
 * hand-building filter SQL in a service or controller.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readSource(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function findTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTsFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.includes('.spec.') && !entry.name.includes('.e2e-spec.')) {
      results.push(full);
    }
  }
  return results;
}

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FILTER_COMPILER_SRC = path.join(REPO_ROOT, 'packages/filter-compiler/src');
const VIEWS_MODULE = path.join(REPO_ROOT, 'apps/api/src/modules/views');
const REPORTING_MODULE = path.join(REPO_ROOT, 'apps/api/src/modules/reporting');
const TICKETS_MODULE = path.join(REPO_ROOT, 'apps/api/src/modules/tickets');

// Raw SQL patterns that should never appear in ticket filter code outside the compiler
const BANNED_FILTER_PATTERNS = [
  /["']status["']\s*=\s*["']/,         // raw SQL equality on status
  /["']priority["']\s*=\s*["']/,       // raw SQL equality on priority
  /WHERE\s+.*status\s+IN\s*\(/i,       // raw WHERE status IN
  /WHERE\s+.*priority\s+IN\s*\(/i,     // raw WHERE priority IN
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Filter boundary architecture', () => {
  describe('Views module imports from @opsninja/filter-compiler', () => {
    it('views.service.ts imports compileToPredicate from @opsninja/filter-compiler', () => {
      const viewsService = path.join(VIEWS_MODULE, 'views.service.ts');
      expect(fs.existsSync(viewsService)).toBe(true);
      const src = readSource(viewsService);
      expect(src).toContain('@opsninja/filter-compiler');
      expect(src).toContain('compileToPredicate');
    });

    it('views.service.ts imports parseFilterAst from @opsninja/filter-compiler', () => {
      const src = readSource(path.join(VIEWS_MODULE, 'views.service.ts'));
      expect(src).toContain('parseFilterAst');
    });
  });

  describe('Reporting module imports from @opsninja/filter-compiler', () => {
    it('reporting.service.ts imports compileToPredicate from @opsninja/filter-compiler', () => {
      const reportingService = path.join(REPORTING_MODULE, 'reporting.service.ts');
      expect(fs.existsSync(reportingService)).toBe(true);
      const src = readSource(reportingService);
      expect(src).toContain('@opsninja/filter-compiler');
      expect(src).toContain('compileToPredicate');
    });

    it('reporting.service.ts imports parseFilterAst', () => {
      const src = readSource(path.join(REPORTING_MODULE, 'reporting.service.ts'));
      expect(src).toContain('parseFilterAst');
    });
  });

  describe('No hand-rolled filter SQL in ticket/views/reporting modules', () => {
    const modulesToCheck = [VIEWS_MODULE, REPORTING_MODULE, TICKETS_MODULE];

    for (const moduleDir of modulesToCheck) {
      const files = findTsFiles(moduleDir);
      for (const file of files) {
        for (const pattern of BANNED_FILTER_PATTERNS) {
          it(`${path.relative(REPO_ROOT, file)} does not contain raw filter SQL pattern: ${pattern}`, () => {
            const src = readSource(file);
            expect(src).not.toMatch(pattern);
          });
        }
      }
    }
  });

  describe('filter-compiler package has no framework dependencies', () => {
    it('filter-compiler source files do not import @nestjs/*', () => {
      const files = findTsFiles(FILTER_COMPILER_SRC);
      for (const file of files) {
        const src = readSource(file);
        expect(src, `${path.basename(file)} imports @nestjs`).not.toContain('@nestjs/');
      }
    });

    it('filter-compiler source files do not import drizzle-orm', () => {
      const files = findTsFiles(FILTER_COMPILER_SRC);
      for (const file of files) {
        const src = readSource(file);
        expect(src, `${path.basename(file)} imports drizzle-orm`).not.toContain('drizzle-orm');
      }
    });

    it('filter-compiler source files do not import @opsninja/db', () => {
      const files = findTsFiles(FILTER_COMPILER_SRC);
      for (const file of files) {
        const src = readSource(file);
        expect(src, `${path.basename(file)} imports @opsninja/db`).not.toContain('@opsninja/db');
      }
    });
  });

  describe('filter-compiler package exports required functions', () => {
    it('index.ts exports parseFilterAst, validateFilterAst, compileToPredicate, computeSignature', () => {
      const indexPath = path.join(FILTER_COMPILER_SRC, 'index.ts');
      expect(fs.existsSync(indexPath)).toBe(true);
      const src = readSource(indexPath);
      expect(src).toContain('parseFilterAst');
      expect(src).toContain('validateFilterAst');
      expect(src).toContain('compileToPredicate');
      expect(src).toContain('computeSignature');
    });
  });
});
