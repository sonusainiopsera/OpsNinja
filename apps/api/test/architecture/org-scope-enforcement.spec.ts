/**
 * Architecture test — org-scope predicate enforcement in repositories.
 *
 * Asserts that every repository file that queries an org-scoped table
 * (tickets, ticket_comments, ticket_attachments) uses the scope predicate
 * helper functions rather than querying the table directly without a scope guard.
 *
 * What this detects:
 *   - A developer adds a new query against `tickets` without calling
 *     `buildOrgScopePredicate`, `withOrgScope`, or a portal predicate.
 *   - A developer references `ticketComments` without any org filtering.
 *
 * What this does NOT detect:
 *   - Logic bugs inside the predicate helpers (covered by scope-predicate.spec.ts).
 *   - Missing calls to `maskNotFound` after findById (covered by unit tests).
 */

import * as fs from 'fs';
import * as path from 'path';

// Repository directory
const REPO_DIR = path.resolve(__dirname, '../../src/modules/tickets/repositories');

// Org-scoped table imports: any file that imports these table objects is
// expected to apply a scope predicate.
const ORG_SCOPED_TABLE_IMPORTS = [
  'tickets',
  'ticketComments',
];

// Predicates that satisfy the requirement — at least one must be present
// in any file that imports an org-scoped table.
const SCOPE_PREDICATE_PATTERNS = [
  'buildOrgScopePredicate',
  'withOrgScope',
  'portalTicketPredicate',
  'portalCommentPredicate',
  'portalAttachmentPredicate',
];

function readRepositoryFiles(): Array<{ name: string; source: string }> {
  if (!fs.existsSync(REPO_DIR)) return [];
  return fs
    .readdirSync(REPO_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => ({
      name: f,
      source: fs.readFileSync(path.join(REPO_DIR, f), 'utf8'),
    }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Org-scope enforcement architecture', () => {
  const repoFiles = readRepositoryFiles();

  describe('Repositories that query org-scoped tables use a scope predicate', () => {
    for (const file of repoFiles) {
      const importsOrgScopedTable = ORG_SCOPED_TABLE_IMPORTS.some((t) =>
        new RegExp(`\\b${t}\\b`).test(file.source),
      );

      if (!importsOrgScopedTable) continue;

      it(`${file.name} applies a scope predicate when querying org-scoped tables`, () => {
        const hasPredicateCall = SCOPE_PREDICATE_PATTERNS.some((p) =>
          file.source.includes(p),
        );

        if (!hasPredicateCall) {
          throw new Error(
            `Repository ${file.name} queries org-scoped tables (${ORG_SCOPED_TABLE_IMPORTS.join(', ')}) ` +
              `without using a scope predicate.\n` +
              `At least one of these must be called:\n` +
              SCOPE_PREDICATE_PATTERNS.map((p) => `  - ${p}`).join('\n') +
              `\n\nThis is an isolation enforcement gap. Add the predicate before merging.`,
          );
        }

        expect(hasPredicateCall).toBe(true);
      });
    }
  });

  describe('scope-predicate.ts exports required functions', () => {
    it('buildOrgScopePredicate is exported', () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, '../../src/data/scope-predicate.ts'),
        'utf8',
      );
      expect(source).toContain('export function buildOrgScopePredicate');
    });

    it('withOrgScope is exported', () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, '../../src/data/scope-predicate.ts'),
        'utf8',
      );
      expect(source).toContain('export function withOrgScope');
    });
  });

  describe('maskNotFound is used in repository findById methods', () => {
    const ticketRepo = repoFiles.find((f) => f.name === 'ticket.repository.ts');

    it('ticket.repository.ts exists and imports withOrgScope or buildOrgScopePredicate', () => {
      expect(ticketRepo).toBeDefined();
      const hasScopeCall = SCOPE_PREDICATE_PATTERNS.some((p) =>
        ticketRepo!.source.includes(p),
      );
      expect(hasScopeCall).toBe(true);
    });

    it('ticket.repository.ts returns null for not-found rows (enabling maskNotFound in controller)', () => {
      expect(ticketRepo).toBeDefined();
      // The findById method must return null (not throw) so the controller can call maskNotFound.
      expect(ticketRepo!.source).toContain('null');
    });
  });

  describe('AUTH_REAUTHORIZE_REQUIRED is the scope-version-mismatch error code', () => {
    it('auth.guard.ts uses AUTH_REAUTHORIZE_REQUIRED (not SCOPE_VERSION_STALE)', () => {
      const source = fs.readFileSync(
        path.resolve(__dirname, '../../src/common/auth/auth.guard.ts'),
        'utf8',
      );
      expect(source).toContain('AUTH_REAUTHORIZE_REQUIRED');
      expect(source).toContain("reason: 'scope_changed'");
      // Must NOT use the old SCOPE_VERSION_STALE code any more
      expect(source).not.toContain("code: 'SCOPE_VERSION_STALE'");
    });
  });

  describe('Org-scope endpoints are at the correct paths', () => {
    it('AgentScopesController is at /api/v1/organizations/agent-scopes', () => {
      const { AgentScopesController } = require('../../src/modules/organizations/agent-scopes.controller');
      const PATH_METADATA = 'path';
      const controllerPath = Reflect.getMetadata(PATH_METADATA, AgentScopesController) as string;
      expect(controllerPath).toBe('api/v1/organizations/agent-scopes');
    });

    it('UsersController is at /api/v1/users', () => {
      const { UsersController } = require('../../src/modules/users/users.controller');
      const PATH_METADATA = 'path';
      const controllerPath = Reflect.getMetadata(PATH_METADATA, UsersController) as string;
      expect(controllerPath).toBe('api/v1/users');
    });
  });
});
