/**
 * Route-visibility decorators for OpenAPI generation (WO-099).
 *
 * Every route handler (or controller class) MUST carry exactly one of:
 *   @PublicApi(...)   — included in the published tenant-facing document
 *   @InternalApi(...) — stripped from the published document; tooling/internal use only
 *
 * The generation script reads this metadata via reflect-metadata to split the
 * full internal document from the public surface, satisfying AC6.
 *
 * Usage:
 * ```ts
 * @PublicApi({
 *   operationId: 'listPortalTickets',
 *   summary:     'List portal tickets with cursor pagination',
 *   tags:        ['portal-tickets'],
 * })
 * @Get()
 * async listTickets() { ... }
 * ```
 */

import { SetMetadata } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Metadata keys — exported so tests can import them without the decorator
// ---------------------------------------------------------------------------

/** Key under which API visibility is stored on a method or class. */
export const API_VISIBILITY_KEY = 'openapi:visibility';

/** Key under which operation metadata is stored on a method. */
export const API_OPERATION_KEY = 'openapi:operation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApiVisibility = 'public' | 'internal';

/** Metadata stored with @PublicApi / @InternalApi. */
export interface OperationMeta {
  /** Unique, semantic identifier used in generated types and SDK methods. */
  operationId: string;
  /** One-sentence description shown in developer docs. */
  summary: string;
  /** Tag group(s) for logical grouping. Must match the TagTaxonomy list. */
  tags: TagName[];
  /**
   * Short justification for @InternalApi routes explaining why the operation
   * is excluded from the public surface.
   */
  internalReason?: string;
  /** Mark as deprecated with a sunset date (ISO-8601 date string). */
  deprecated?: { sunsetDate: string; alternativeOperationId?: string };
}

/** Controlled tag taxonomy — every public operation must use one of these. */
export type TagName =
  | 'portal-tickets'
  | 'portal-attachments'
  | 'agent-tickets'
  | 'agent-comments'
  | 'agent-attachments'
  | 'organizations'
  | 'contacts'
  | 'users'
  | 'sla-policies'
  | 'sla-calendars'
  | 'views'
  | 'reporting'
  | 'audit'
  | 'jira'
  | 'notifications'
  | 'webhooks'
  | 'privacy'
  | 'ai'
  | 'auth'
  | 'health'
  | 'admin';

// ---------------------------------------------------------------------------
// Decorators
// ---------------------------------------------------------------------------

/**
 * Marks a route as part of the published, publicly supported tenant-facing API.
 * The operation will appear in the public OpenAPI document.
 *
 * @param meta — operation metadata (operationId, summary, tags)
 */
export function PublicApi(meta: Omit<OperationMeta, 'internalReason'>): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    SetMetadata(API_VISIBILITY_KEY, 'public' satisfies ApiVisibility)(
      target,
      propertyKey,
      descriptor,
    );
    SetMetadata(API_OPERATION_KEY, { ...meta, internalReason: undefined } satisfies OperationMeta)(
      target,
      propertyKey,
      descriptor,
    );
    return descriptor;
  };
}

/**
 * Marks a route as internal-only.  The operation is excluded from the public
 * document but remains in the full internal document used by tooling.
 *
 * Every @InternalApi MUST supply an `internalReason` explaining the exclusion.
 *
 * @param meta — operation metadata including mandatory internalReason
 */
export function InternalApi(meta: OperationMeta & { internalReason: string }): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    SetMetadata(API_VISIBILITY_KEY, 'internal' satisfies ApiVisibility)(
      target,
      propertyKey,
      descriptor,
    );
    SetMetadata(API_OPERATION_KEY, meta)(target, propertyKey, descriptor);
    return descriptor;
  };
}

// ---------------------------------------------------------------------------
// Reader helpers — used by the generation script and completeness guard
// ---------------------------------------------------------------------------

/**
 * Reads the visibility annotation from a method descriptor.
 * Returns undefined when the method carries no annotation.
 */
export function readVisibility(
  target: object,
  propertyKey: string | symbol,
): ApiVisibility | undefined {
  return Reflect.getMetadata(API_VISIBILITY_KEY, target, propertyKey) as
    | ApiVisibility
    | undefined;
}

/**
 * Reads the operation metadata from a method descriptor.
 * Returns undefined when no metadata has been stored.
 */
export function readOperationMeta(
  target: object,
  propertyKey: string | symbol,
): OperationMeta | undefined {
  return Reflect.getMetadata(API_OPERATION_KEY, target, propertyKey) as OperationMeta | undefined;
}
