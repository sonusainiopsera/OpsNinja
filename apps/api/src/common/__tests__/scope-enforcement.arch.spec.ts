/**
 * Architecture test: org-scope enforcement on scoped tables.
 *
 * Every repository file that directly queries a tenant-scoped table must
 * pass the query through one of the approved scope-filter helpers.  This
 * test fails if a new repository is added that queries a scoped table
 * without the helper, so the control cannot silently erode.
 *
 * Approved helpers (any one is sufficient):
 *   - agentOrgScopeFilter   (from common/db/scoped-query.helper)
 *   - buildOrgScopePredicate (from data/scope-predicate)
 *   - portalTicketFilter    (from common/db/scoped-query.helper)
 *   - portalCommentFilter   (from common/db/scoped-query.helper)
 *   - portalCommentForTicketFilter (from common/db/scoped-query.helper)
 *
 * The test reads source files from disk — it does NOT import or execute
 * any repository code, so it runs offline without a database.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// ── Configuration ──────────────────────────────────────────────────────────────

/** Root of the api application source. */
const API_SRC_ROOT = join(__dirname, '..', '..');

/** Drizzle table identifiers that require an org-scope predicate. */
const SCOPED_TABLE_IMPORTS = [
  'tickets',    // ticket queries must be org-scoped for agents
  'comments',   // comment queries inherit ticket scope
] as const;

/** At least one of these must appear in a file that imports a scoped table. */
const APPROVED_SCOPE_HELPERS = [
  'agentOrgScopeFilter',
  'buildOrgScopePredicate',
  'portalTicketFilter',
  'portalCommentFilter',
  'portalCommentForTicketFilter',
  'withOrgScope',
] as const;

/**
 * Repository files that are deliberately exempted with a justification.
 * Each entry is a path relative to API_SRC_ROOT.
 */
const EXEMPTED_REPOSITORIES: Record<string, string> = {
  // The ticket attachment repository queries attachments table, not tickets.
  // Attachment queries are always gated through a ticket lookup that is itself
  // org-scope-filtered before the attachment can be accessed.
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function walkFiles(dir: string, suffix: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      result.push(...walkFiles(full, suffix));
    } else if (full.endsWith(suffix)) {
      result.push(full);
    }
  }
  return result;
}

function fileContent(path: string): string {
  return readFileSync(path, 'utf-8');
}

function importsAnyOf(content: string, identifiers: readonly string[]): boolean {
  return identifiers.some((id) => {
    // Import-style: import { ..., id, ... } or import id
    const importPattern = new RegExp(`\\b${id}\\b`);
    return importPattern.test(content);
  });
}

// ── Suite ──────────────────────────────────────────────────────────────────────

describe('Architecture: org-scope enforcement on scoped tables', () => {
  const repoFiles = walkFiles(API_SRC_ROOT, '.repository.ts');

  it('at least one repository file is discovered', () => {
    expect(repoFiles.length).toBeGreaterThan(0);
  });

  describe.each(repoFiles)('%s', (repoFile) => {
    const relPath = relative(API_SRC_ROOT, repoFile);
    const isExempted = Object.prototype.hasOwnProperty.call(EXEMPTED_REPOSITORIES, relPath);

    it('that imports a scoped table also uses an approved scope-filter helper', () => {
      if (isExempted) {
        // Skip with documentation of the exemption.
        expect(EXEMPTED_REPOSITORIES[relPath]).toBeTruthy();
        return;
      }

      const content = fileContent(repoFile);
      const queriesScopedTable = importsAnyOf(content, SCOPED_TABLE_IMPORTS);

      if (!queriesScopedTable) {
        // File doesn't touch any scoped table — passes trivially.
        return;
      }

      const usesApprovedHelper = importsAnyOf(content, APPROVED_SCOPE_HELPERS);

      if (!usesApprovedHelper) {
        throw new Error(
          `Repository ${relPath} queries a scoped table (${SCOPED_TABLE_IMPORTS.join(' or ')}) ` +
          `but does not use any approved scope-filter helper.\n` +
          `Approved helpers: ${APPROVED_SCOPE_HELPERS.join(', ')}\n` +
          `Either add the scope filter or add the file to EXEMPTED_REPOSITORIES with a justification.`,
        );
      }
    });
  });

  it('every EXEMPTED_REPOSITORIES entry has a non-empty justification', () => {
    for (const [, justification] of Object.entries(EXEMPTED_REPOSITORIES)) {
      expect(typeof justification).toBe('string');
      expect(justification.length).toBeGreaterThan(10);
    }
  });
});
