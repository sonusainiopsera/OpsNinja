/**
 * @Auditable decorator – declares that a repository or service method produces
 * a state-change that must be captured in audit_logs.
 *
 * Usage:
 *   @Auditable({ resourceType: 'ticket', action: 'ticket.created' })
 *   async createTicket(dto: CreateTicketDto): Promise<Ticket> { ... }
 *
 * The decorator registers the decorated method in AuditCoverageRegistry at
 * module-load time.  The CI guard test reads the registry and fails when a
 * known write method is missing the decorator.
 */

import 'reflect-metadata';

export interface AuditableOptions {
  /** The resource domain (e.g. 'ticket', 'comment', 'organization'). */
  resourceType: string;
  /** Kebab-style action verb (e.g. 'ticket.created', 'ticket.assigned'). */
  action: string;
  /**
   * Optional selector describing which fields to capture in before_state /
   * after_state.  If omitted the full entity snapshot is captured.
   *
   * @example ['status', 'assigneeId', 'priority']
   */
  stateFields?: string[];
}

export const AUDITABLE_META_KEY = 'opsninja:auditable';

/**
 * Method decorator that declares a mutation as auditable and registers it
 * in the AuditCoverageRegistry.
 */
export function Auditable(options: AuditableOptions): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    Reflect.defineMetadata(AUDITABLE_META_KEY, options, target, propertyKey);

    // Register in the shared registry so the CI guard can discover it.
    // Import is deferred to avoid circular-import issues at module load time.
    const { AuditCoverageRegistry } = require('./audit-coverage.registry') as typeof import('./audit-coverage.registry');
    AuditCoverageRegistry.register({
      className: (target.constructor as { name: string }).name,
      methodName: String(propertyKey),
      options,
    });

    return descriptor;
  };
}

/** Reads the @Auditable metadata from an already-decorated method, if present. */
export function getAuditableMeta(
  target: object,
  methodName: string | symbol,
): AuditableOptions | undefined {
  return Reflect.getMetadata(AUDITABLE_META_KEY, target, methodName);
}
