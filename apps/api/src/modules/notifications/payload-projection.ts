/**
 * Payload Projection — WO-081.
 *
 * Allow-list mapper that converts a raw outbox event payload into a safe,
 * customer-facing projection before it is handed to the template engine or
 * placed in a webhook delivery.
 *
 * Design constraints:
 *  - Explicit ALLOW-LIST, not a deny-list: adding a new ticket field will NOT
 *    expose it to customers until it is explicitly added here and the snapshot
 *    test is updated.
 *  - Internal-only fields (agentNotes, internalBody, assigneeId, tenantId, etc.)
 *    are structurally absent from every projection variant.
 *  - The snapshot test in payload-projection.spec.ts fails the build if the
 *    shape of any ProjectedPayload variant changes without review.
 *
 * Public fields allowed in customer-facing payloads:
 *   ticketId, reference, subject, status, priority, categoryPath, updatedAt,
 *   actorDisplayName, publicCommentBody (for comment_added only).
 */

import type { PayloadProjectionName } from './event-catalogue';

// ---------------------------------------------------------------------------
// Input shape — raw outbox event payload (untrusted, may contain internal fields)
// ---------------------------------------------------------------------------

export interface RawTicketPayload {
  ticketId?: string;
  reference?: string;
  subject?: string;
  status?: string;
  priority?: string;
  categoryPath?: string;
  updatedAt?: string;
  actorDisplayName?: string;
  actorId?: string; // internal — stripped
  assigneeId?: string; // internal — stripped
  tenantId?: string; // internal — stripped
  // Comment fields
  commentBody?: string;
  visibility?: string;
  internalNoteBody?: string; // internal — stripped
  // SLA fields
  slaType?: string;
  threshold?: number;
  nextFireAt?: string;
  breachedAt?: string;
  // Anything else — dropped
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Output shapes — projected payloads safe to pass to templates or webhooks
// ---------------------------------------------------------------------------

export interface TicketPublicProjection {
  ticketId: string | null;
  reference: string | null;
  subject: string | null;
  status: string | null;
  priority: string | null;
  categoryPath: string | null;
  updatedAt: string | null;
  actorDisplayName: string | null;
}

export interface TicketSlaProjection {
  ticketId: string | null;
  reference: string | null;
  subject: string | null;
  priority: string | null;
  slaType: string | null;
  threshold: number | null;
  nextFireAt: string | null;
  breachedAt: string | null;
}

export interface CommentPublicProjection {
  ticketId: string | null;
  reference: string | null;
  subject: string | null;
  status: string | null;
  priority: string | null;
  publicCommentBody: string | null;
  actorDisplayName: string | null;
  updatedAt: string | null;
}

export type ProjectedPayload =
  | TicketPublicProjection
  | TicketSlaProjection
  | CommentPublicProjection;

// ---------------------------------------------------------------------------
// Projection functions
// ---------------------------------------------------------------------------

/**
 * Project a raw payload for customer-facing ticket events (all except comment_added).
 * Never includes agent-only fields.
 */
export function projectTicketPublic(raw: RawTicketPayload): TicketPublicProjection {
  return {
    ticketId: stringOrNull(raw.ticketId),
    reference: stringOrNull(raw.reference),
    subject: stringOrNull(raw.subject),
    status: stringOrNull(raw.status),
    priority: stringOrNull(raw.priority),
    categoryPath: stringOrNull(raw.categoryPath),
    updatedAt: stringOrNull(raw.updatedAt),
    actorDisplayName: stringOrNull(raw.actorDisplayName),
    // Explicitly absent: actorId, assigneeId, tenantId, internalNoteBody, commentBody
  };
}

/**
 * Project a raw payload for SLA events (on-call routing only).
 * Does not include free-text comment bodies.
 */
export function projectTicketSla(raw: RawTicketPayload): TicketSlaProjection {
  return {
    ticketId: stringOrNull(raw.ticketId),
    reference: stringOrNull(raw.reference),
    subject: stringOrNull(raw.subject),
    priority: stringOrNull(raw.priority),
    slaType: stringOrNull(raw.slaType),
    threshold: typeof raw.threshold === 'number' ? raw.threshold : null,
    nextFireAt: stringOrNull(raw.nextFireAt),
    breachedAt: stringOrNull(raw.breachedAt),
  };
}

/**
 * Project a raw comment payload.
 * Includes publicCommentBody ONLY — never internalNoteBody.
 * Callers must verify visibility === 'public' before calling this function.
 */
export function projectCommentPublic(raw: RawTicketPayload): CommentPublicProjection {
  return {
    ticketId: stringOrNull(raw.ticketId),
    reference: stringOrNull(raw.reference),
    subject: stringOrNull(raw.subject),
    status: stringOrNull(raw.status),
    priority: stringOrNull(raw.priority),
    // commentBody is only passed through when visibility is 'public'
    publicCommentBody: raw.visibility === 'public' ? stringOrNull(raw.commentBody) : null,
    actorDisplayName: stringOrNull(raw.actorDisplayName),
    updatedAt: stringOrNull(raw.updatedAt),
  };
}

/**
 * Route a raw payload to the appropriate projection function based on the
 * projection name declared in the event catalogue.
 */
export function applyProjection(
  projectionName: PayloadProjectionName,
  raw: Record<string, unknown>,
): ProjectedPayload {
  const typedRaw = raw as RawTicketPayload;
  switch (projectionName) {
    case 'ticket_public':
      return projectTicketPublic(typedRaw);
    case 'ticket_sla':
      return projectTicketSla(typedRaw);
    case 'comment_public':
      return projectCommentPublic(typedRaw);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}
