/**
 * @Auditable — method decorator for repository and service mutating methods.
 *
 * Carries metadata consumed by AuditCoverageRegistry at bootstrap and by
 * AuditWriter at runtime to determine what to capture.
 *
 * Usage:
 *   @Auditable({ resourceType: 'ticket_comment', action: 'create' })
 *   async insert(data: NewTicketComment): Promise<TicketComment> { ... }
 *
 *   With a before-state selector:
 *   @Auditable({ resourceType: 'ticket', action: 'update', beforeStateArg: 0 })
 *   async update(id: string, patch: Partial<Ticket>): Promise<Ticket> { ... }
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Metadata key constants
// ---------------------------------------------------------------------------

export const AUDITABLE_METADATA_KEY = 'opsninja:auditable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditableOptions {
  /** The kind of resource being mutated (e.g. 'ticket', 'ticket_comment'). */
  resourceType: string;
  /**
   * The action being performed.
   * Convention: create | update | delete | deactivate | assign | transition
   */
  action: string;
  /**
   * Zero-based index of the method argument that carries the resource ID.
   * When set, AuditWriter reads args[resourceIdArg] as the resource_id.
   */
  resourceIdArg?: number;
  /**
   * Zero-based index of the argument whose value should be captured as
   * before_state. When set, the argument is JSON-serialized before mutation.
   * Callers that need a DB lookup should resolve before_state manually and
   * pass a pre-fetched snapshot.
   */
  beforeStateArg?: number;
}

export interface AuditableMetadata extends AuditableOptions {
  /** Class prototype the decorated method belongs to. */
  target: object;
  /** Method name. */
  methodName: string;
}

// ---------------------------------------------------------------------------
// Decorator
// ---------------------------------------------------------------------------

/**
 * Marks a repository or service method as auditable.
 * The decorator attaches metadata; actual audit emission is performed by
 * the service layer calling AuditWriter.append() inside the mutation.
 */
export function Auditable(options: AuditableOptions): MethodDecorator {
  return (
    target: object,
    propertyKey: string | symbol,
    _descriptor: PropertyDescriptor,
  ): void => {
    const metadata: AuditableMetadata = {
      ...options,
      target,
      methodName: String(propertyKey),
    };
    Reflect.defineMetadata(AUDITABLE_METADATA_KEY, metadata, target, propertyKey);
  };
}
