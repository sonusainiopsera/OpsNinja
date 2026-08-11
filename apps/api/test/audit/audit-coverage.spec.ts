/**
 * CI guard: verifies that every known mutation method in the repository
 * layer has an @Auditable declaration registered in AuditCoverageRegistry.
 *
 * Add new entries here when adding new write methods to repositories.
 * Add to KNOWN_EXEMPTIONS only for explicitly justified cases.
 */

// Force module loading so decorators register their entries
import '../../src/modules/tickets/repositories/ticket.repository';
import '../../src/modules/tickets/repositories/comment.repository';

import { AuditCoverageRegistry } from '../../src/common/audit/audit-coverage.registry';

/**
 * Methods explicitly exempted from @Auditable coverage.
 * Each exemption requires a justification comment.
 */
const KNOWN_EXEMPTIONS: Array<{ className: string; methodName: string; reason: string }> = [
  // No exemptions currently. Add entries here with a `reason` when justified.
];

/**
 * The canonical set of mutation methods that MUST have @Auditable coverage.
 * When adding a new write method to a repository, add it here.
 */
const REQUIRED_COVERAGE: Array<{ className: string; methodName: string }> = [
  { className: 'TicketRepository', methodName: 'createTicket' },
  { className: 'TicketRepository', methodName: 'updateTicket' },
  { className: 'TicketRepository', methodName: 'assignTicket' },
  { className: 'TicketRepository', methodName: 'transitionStatus' },
  { className: 'CommentRepository', methodName: 'createPublicComment' },
  { className: 'CommentRepository', methodName: 'createInternalComment' },
];

describe('Audit Coverage Registry (CI Guard)', () => {
  it('registry is not empty — modules loaded and decorators registered', () => {
    expect(AuditCoverageRegistry.all().length).toBeGreaterThan(0);
  });

  it.each(REQUIRED_COVERAGE)(
    '$className.$methodName is decorated with @Auditable',
    ({ className, methodName }) => {
      const isExempt = KNOWN_EXEMPTIONS.some(
        (e) => e.className === className && e.methodName === methodName,
      );
      if (isExempt) return;

      const entry = AuditCoverageRegistry.get(className, methodName);
      expect(entry).toBeDefined();
    },
  );

  it('all registry entries have required fields', () => {
    for (const entry of AuditCoverageRegistry.all()) {
      expect(entry.className).toBeTruthy();
      expect(entry.methodName).toBeTruthy();
      expect(entry.options.action).toBeTruthy();
      expect(entry.options.resourceType).toBeTruthy();
    }
  });

  it('no duplicate registrations', () => {
    const seen = new Set<string>();
    for (const entry of AuditCoverageRegistry.all()) {
      const key = `${entry.className}.${entry.methodName}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
