/**
 * Portal-specific DTO types and mapper functions.
 *
 * RULES enforced by architecture tests:
 *  1. Mapper functions must NOT spread entity objects (no `{ ...ticket }` patterns).
 *  2. Every field must be explicitly listed — this makes accidental internal-field
 *     exposure a compile-time omission rather than a runtime leak.
 *  3. No field from this module may reference agent-internal types (assignee notes,
 *     SLA internals, raw AI prompts, etc.).
 *
 * The PORTAL_DTO_MARKER symbol is exported so architecture tests can confirm portal
 * controller return types are annotated with it.
 */

import type { Ticket } from '@opsninja/db';
import type { Comment } from '@opsninja/db';
import type { Attachment } from '@opsninja/db';

// Brand symbol — used by architecture tests to verify portal-only serialisation
export const PORTAL_DTO_MARKER = Symbol('portal-dto');

// ── Narrow DTO types ──────────────────────────────────────────────────────────

export interface PortalTicketListItemDto {
  readonly __portalDto: typeof PORTAL_DTO_MARKER;
  id: string;
  subject: string;
  status: string;
  priority: string;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  aiSummary?: string;
}

export interface PortalCommentDto {
  readonly __portalDto: typeof PORTAL_DTO_MARKER;
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  // visibility intentionally absent — all portal comments are public
  // internal body text, agent notes, metadata: intentionally absent
}

export interface PortalAttachmentDto {
  readonly __portalDto: typeof PORTAL_DTO_MARKER;
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PortalTicketDetailDto {
  readonly __portalDto: typeof PORTAL_DTO_MARKER;
  id: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  comments: PortalCommentDto[];
  attachmentsByComment: Record<string, PortalAttachmentDto[]>;
  aiSummary?: string;
}

export interface PortalAttachmentDownloadDto {
  url: string;
  expiresAt: string;
}

// ── Request body type ─────────────────────────────────────────────────────────

export interface CreatePortalCommentBody {
  content: string;
  /** Must be absent or explicitly 'public'; any other value → 400. */
  visibility?: string;
}

// ── Mapper functions (no entity spread) ──────────────────────────────────────

const marker = PORTAL_DTO_MARKER;

export function toPortalTicketListItem(
  ticket: Ticket,
  commentCount: number,
  showAiSummary: boolean,
): PortalTicketListItemDto {
  const dto: PortalTicketListItemDto = {
    __portalDto: marker,
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    organizationId: ticket.organizationId,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    commentCount,
    // assigneeId: intentionally absent
    // createdById: intentionally absent
    // isPublic: intentionally absent
    // aiSummary: gated below
  };
  if (showAiSummary && ticket.aiSummary) {
    dto.aiSummary = ticket.aiSummary;
  }
  return dto;
}

export function toPortalComment(comment: Comment): PortalCommentDto {
  return {
    __portalDto: marker,
    id: comment.id,
    authorId: comment.authorId,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    // visibility: intentionally absent
    // ticketId: intentionally absent (already scoped by route)
    // tenantId: intentionally absent
  };
}

export function toPortalAttachment(attachment: Attachment): PortalAttachmentDto {
  return {
    __portalDto: marker,
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    createdAt: attachment.createdAt.toISOString(),
    // s3Key: intentionally absent — clients receive a pre-signed URL separately
    // commentId: intentionally absent
    // tenantId: intentionally absent
  };
}

export function toPortalTicketDetail(
  ticket: Ticket,
  publicComments: Comment[],
  attachmentsByCommentId: Record<string, Attachment[]>,
  showAiSummary: boolean,
): PortalTicketDetailDto {
  const dto: PortalTicketDetailDto = {
    __portalDto: marker,
    id: ticket.id,
    subject: ticket.subject,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    organizationId: ticket.organizationId,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    resolvedAt: ticket.resolvedAt ? ticket.resolvedAt.toISOString() : null,
    comments: publicComments.map(toPortalComment),
    attachmentsByComment: Object.fromEntries(
      Object.entries(attachmentsByCommentId).map(([cid, atts]) => [
        cid,
        atts.map(toPortalAttachment),
      ]),
    ),
    // assigneeId: intentionally absent
    // createdById: intentionally absent
    // isPublic: intentionally absent
    // aiSummary: gated below
  };
  if (showAiSummary && ticket.aiSummary) {
    dto.aiSummary = ticket.aiSummary;
  }
  return dto;
}
