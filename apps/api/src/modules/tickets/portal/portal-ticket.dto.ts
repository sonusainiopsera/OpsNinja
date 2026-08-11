/**
 * Portal-surface DTO types and explicit mapper functions.
 *
 * Rules enforced here:
 *   1. No entity spread — each field is mapped individually so internal fields
 *      cannot leak through an accidental `...ticket` spread.
 *   2. No internal fields — assigneeId, affectedAreaTags, aiSummary (unless
 *      per-tenant setting enables it), and SLA internals are omitted.
 *   3. comment.visibility is never included in the response; portal users always
 *      receive only public comments so the field is meaningless and revealing.
 *   4. Architecture tests verify these types are the only ones returned from
 *      portal route handlers.
 */

import type { Ticket, TicketComment, TicketAttachment } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Portal DTO types
// ---------------------------------------------------------------------------

/** Narrow ticket representation for portal list responses. */
export interface PortalTicketListItemDto {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
}

/** Narrow ticket representation for portal detail responses. */
export interface PortalTicketDetailDto {
  id: string;
  subject: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  /** Included only when per-tenant portalAiSummaryEnabled is true. */
  aiSummary?: string;
  comments: PortalCommentDto[];
}

/** Narrow comment representation. visibility field is never exposed. */
export interface PortalCommentDto {
  id: string;
  authorId: string | null;
  body: string;
  createdAt: string;
  attachments: PortalAttachmentMetaDto[];
}

/** Attachment metadata. s3Key is never exposed. */
export interface PortalAttachmentMetaDto {
  id: string;
  filename: string;
  mimeType: string;
}

/** Response for attachment download requests. */
export interface AttachmentDownloadDto {
  url: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Explicit mapper functions — no entity spread, no accidental internal field leak
// ---------------------------------------------------------------------------

export function mapTicketToPortalListItem(ticket: Ticket): PortalTicketListItemDto {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

export function mapAttachmentToPortalMeta(attachment: TicketAttachment): PortalAttachmentMetaDto {
  return {
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
  };
}

export function mapCommentToPortalDto(
  comment: TicketComment,
  attachments: TicketAttachment[],
): PortalCommentDto {
  return {
    id: comment.id,
    authorId: comment.authorId,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    attachments: attachments.map(mapAttachmentToPortalMeta),
  };
}

export function mapTicketToPortalDetail(
  ticket: Ticket,
  comments: PortalCommentDto[],
  aiSummaryEnabled: boolean,
): PortalTicketDetailDto {
  const dto: PortalTicketDetailDto = {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    comments,
  };
  if (aiSummaryEnabled && ticket.aiSummary) {
    dto.aiSummary = ticket.aiSummary;
  }
  return dto;
}
