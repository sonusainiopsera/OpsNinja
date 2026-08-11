/**
 * CI Guard: Audit Coverage
 *
 * Fails when any repository or service method matching the mutation naming
 * convention (create*, update*, delete*, deactivate*, assign*, transition*,
 * insert*, upsert*, softDelete*) lacks an @Auditable declaration.
 *
 * METHODOLOGY:
 *  1. Import all known repository/service classes.
 *  2. Scan their prototype methods for mutation-naming patterns.
 *  3. Cross-reference against AuditCoverageRegistry and the exemptions list.
 *  4. Fail with actionable output listing the offending methods.
 *
 * To exempt a method, add an entry to apps/api/test/audit/audit-exemptions.ts
 * with a written justification.
 */

import 'reflect-metadata';
import { AuditCoverageRegistry } from '../../src/modules/audit/audit-coverage.registry';
import { AUDIT_METADATA_KEY } from './audit-test-helpers';
import { EXEMPT_KEYS } from './audit-exemptions';

// ---------------------------------------------------------------------------
// Import all repositories so their @Auditable metadata is available
// ---------------------------------------------------------------------------

import { CommentRepository } from '../../src/modules/tickets/repositories/comment.repository';
import { SlaPoliciesRepository } from '../../src/modules/sla/sla-policies.repository';
import { SlaCalendarsRepository } from '../../src/modules/sla/sla-calendars.repository';
import { JiraConnectionsRepository } from '../../src/modules/jira/connections/jira-connections.repository';

// ---------------------------------------------------------------------------
// Mutation method naming convention
// ---------------------------------------------------------------------------

const MUTATION_PREFIXES = [
  'create',
  'update',
  'delete',
  'deactivate',
  'assign',
  'transition',
  'insert',
  'upsert',
  'softDelete',
  'rotate',
  'revoke',
  'enable',
  'disable',
];

function isMutationMethod(name: string): boolean {
  return MUTATION_PREFIXES.some(
    (prefix) => name === prefix || name.startsWith(prefix) && name[prefix.length] === name[prefix.length]?.toUpperCase(),
  );
}

function collectMutationMethods(
  proto: object,
  className: string,
): string[] {
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof (proto as Record<string, unknown>)[name] === 'function')
    .filter((name) => isMutationMethod(name))
    .map((name) => `${className}.${name}`);
}

// ---------------------------------------------------------------------------
// Registry of classes to scan (add new repositories here when created)
// ---------------------------------------------------------------------------

const CLASSES_TO_SCAN: Array<{ prototype: object; name: string }> = [
  { prototype: CommentRepository.prototype, name: 'CommentRepository' },
  // WO-044: SLA repositories
  { prototype: SlaPoliciesRepository.prototype, name: 'SlaPoliciesRepository' },
  { prototype: SlaCalendarsRepository.prototype, name: 'SlaCalendarsRepository' },
  // WO-051: Jira connection repository
  { prototype: JiraConnectionsRepository.prototype, name: 'JiraConnectionsRepository' },
  // Future classes: add here as modules are implemented
  // { prototype: OrganizationRepository.prototype, name: 'OrganizationRepository' },
  // { prototype: JiraConnectionRepository.prototype, name: 'JiraConnectionRepository' },
];

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe('Audit Coverage Guard', () => {
  it('every mutation method has @Auditable decoration or an approved exemption', () => {
    const registryKeys = new Set(AuditCoverageRegistry.getKeys());
    const violations: string[] = [];

    for (const { prototype, name } of CLASSES_TO_SCAN) {
      // Register the class so the registry is populated even in test context
      AuditCoverageRegistry.registerClass(prototype);

      const mutationMethods = collectMutationMethods(prototype, name);

      for (const key of mutationMethods) {
        if (registryKeys.has(key) || EXEMPT_KEYS.has(key)) continue;

        // Check reflect-metadata directly as a fallback
        const methodName = key.split('.')[1]!;
        const hasMeta = Reflect.hasMetadata(AUDIT_METADATA_KEY, prototype, methodName);
        if (hasMeta) {
          registryKeys.add(key);
          continue;
        }

        violations.push(key);
      }
    }

    if (violations.length > 0) {
      const msg = [
        `\n[AUDIT COVERAGE] ${violations.length} mutation method(s) missing @Auditable:`,
        ...violations.map((v) => `  - ${v}`),
        '\nAdd @Auditable to each method OR add it to apps/api/test/audit/audit-exemptions.ts',
        'with a written justification.',
      ].join('\n');
      throw new Error(msg);
    }
  });

  it('AuditCoverageRegistry has at least one registered method', () => {
    // Bootstrap all classes
    for (const { prototype } of CLASSES_TO_SCAN) {
      AuditCoverageRegistry.registerClass(prototype);
    }
    expect(AuditCoverageRegistry.size).toBeGreaterThan(0);
  });
});
