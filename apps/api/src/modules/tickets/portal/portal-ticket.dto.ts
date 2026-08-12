/**
 * Portal-surface DTO types and explicit mapper functions — WO-089/WO-090.
 *
 * Rules enforced here:
 *   1. No entity spread — each field is mapped individually so internal fields
 *      cannot leak through an accidental `...ticket` spread.
 *   2. No internal fields — assigneeId, affectedAreaTags, aiSummary (unless
 *      per-tenant setting enables it), and SLA internals are omitted.
 *   3. comment.visibility is never included in the response; portal users always
 *      receive only public comments so the field is meaningless and revealing.
 *   4. SLA projection contains only firstResponseTargetAt, resolutionTargetAt and
 *      a coarse state — raw thresholds, pausedMs and policy internals are excluded.
 *   5. Architecture tests verify these types are the only ones returned from
 *      portal route handlers.
 */

import type { Ticket, TicketComment, TicketAttachment, TicketStatusHistory } from '@opsninja/db';
import type { TicketSlaResult } from '../../sla/sla-query.service';

// ---------------------------------------------------------------------------
// Customer-safe SLA projection (AC3)
// ---------------------------------------------------------------------------

/** Coarse SLA state exposed to portal users — policy internals excluded. */
export type PortalSlaState = 'running' | 'paused' | 'met' | 'breached';

export interface PortalSlaProjection {
  firstResponseTargetAt: string | null;
  resolutionTargetAt: string | null;
  state: PortalSlaState;
}

// ---------------------------------------------------------------------------
// Portal DTO types
// ---------------------------------------------------------------------------

/** Narrow ticket representation for portal list responses (AC1). */
export interface PortalTicketListItemDto {
  id: string;
  reference: string | null;
  subject: string;
  status: string;
  priority: string;
  categoryPath: string | null;
  createdAt: string;
  updatedAt: string;
  sla: PortalSlaProjection | null;
}

/** Paginated portal list response. */
export interface PortalTicketListPageDto {
  data: PortalTicketListItemDto[];
  nextCursor: string | null;
}

/** Narrow ticket representation for portal detail responses (AC3). */
export interface PortalTicketDetailDto {
  id: string;
  reference: string | null;
  subject: string;
  status: string;
  priority: string;
  categoryPath: string | null;
  createdAt: string;
  updatedAt: string;
  sla: PortalSlaProjection | null;
  /** Included only when per-tenant portalAiSummaryEnabled is true. Never exposes internals. */
  aiSummary?: string;
  comments: PortalCommentDto[];
  statusHistory: PortalStatusHistoryDto[];
}

/** Customer-safe author type. */
export type PortalAuthorType = 'customer' | 'agent';

/** Narrow comment representation. visibility field is NEVER exposed (AC7). */
export interface PortalCommentDto {
  id: string;
  /** Display name only — never email or internal user ID (AC7). */
  authorDisplayName: string;
  authorType: PortalAuthorType;
  body: string;
  createdAt: string;
  attachments: PortalAttachmentMetaDto[];
}

/** Attachment metadata. s3Key is NEVER exposed (AC7). */
export interface PortalAttachmentMetaDto {
  id: string;
  displayName: string;
  sizeBytes: number | null;
}

/** Status history entry — actor identity is obscured to display role only (AC7). */
export interface PortalStatusHistoryDto {
  from: string | null;
  to: string;
  at: string;
}

/** Response for attachment download requests (AC8). */
export interface AttachmentDownloadDto {
  url: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// SLA projection mapper — maps SlaTimerResult to customer-safe shape (AC3)
// ---------------------------------------------------------------------------

export function mapSlaToPortalProjection(sla: TicketSlaResult | null): PortalSlaProjection | null {
  if (!sla || sla.clocks.length === 0) return null;

  const responseClock = sla.clocks.find((c) => c.clockType === 'response');
  const resolutionClock = sla.clocks.find((c) => c.clockType === 'resolution');

  // Derive coarse state: worst-case across both clocks
  function coarseState(clocks: typeof sla.clocks): PortalSlaState {
    if (clocks.some((c) => c.state === 'breached')) return 'breached';
    if (clocks.some((c) => c.state === 'running'))  return 'running';
    if (clocks.some((c) => c.state === 'paused'))   return 'paused';
    return 'met';
  }

  return {
    firstResponseTargetAt: responseClock?.targetAt ?? null,
    resolutionTargetAt:    resolutionClock?.targetAt ?? null,
    state:                 coarseState(sla.clocks),
  };
}

// ---------------------------------------------------------------------------
// Explicit mapper functions — no entity spread, no accidental leak
// ---------------------------------------------------------------------------

export function mapTicketToPortalListItem(
  ticket: Ticket,
  sla: TicketSlaResult | null,
): PortalTicketListItemDto {
  return {
    id:           ticket.id,
    reference:    (ticket as unknown as { reference?: string | null }).reference ?? null,
    subject:      ticket.subject,
    status:       ticket.status,
    priority:     ticket.priority,
    categoryPath: (ticket as unknown as { categoryPath?: string | null }).categoryPath ?? null,
    createdAt:    ticket.createdAt.toISOString(),
    updatedAt:    ticket.updatedAt.toISOString(),
    sla:          mapSlaToPortalProjection(sla),
  };
}

export function mapAttachmentToPortalMeta(attachment: TicketAttachment): PortalAttachmentMetaDto {
  return {
    id:          attachment.id,
    displayName: attachment.filename,
    sizeBytes:   (attachment as unknown as { sizeBytes?: number | null }).sizeBytes ?? null,
  };
}

export function mapCommentToPortalDto(
  comment: TicketComment,
  attachments: TicketAttachment[],
  authorDisplayName: string,
  authorType: PortalAuthorType,
): PortalCommentDto {
  return {
    id:                comment.id,
    authorDisplayName,
    authorType,
    body:              comment.body,
    createdAt:         comment.createdAt.toISOString(),
    attachments:       attachments.map(mapAttachmentToPortalMeta),
  };
}

export function mapStatusHistoryToPortalDto(entry: TicketStatusHistory): PortalStatusHistoryDto {
  return {
    from: entry.fromStatus ?? null,
    to:   entry.toStatus,
    at:   entry.createdAt.toISOString(),
  };
}

export function mapTicketToPortalDetail(
  ticket: Ticket,
  comments: PortalCommentDto[],
  statusHistory: PortalStatusHistoryDto[],
  sla: TicketSlaResult | null,
  aiSummaryEnabled: boolean,
): PortalTicketDetailDto {
  const dto: PortalTicketDetailDto = {
    id:            ticket.id,
    reference:     (ticket as unknown as { reference?: string | null }).reference ?? null,
    subject:       ticket.subject,
    status:        ticket.status,
    priority:      ticket.priority,
    categoryPath:  (ticket as unknown as { categoryPath?: string | null }).categoryPath ?? null,
    createdAt:     ticket.createdAt.toISOString(),
    updatedAt:     ticket.updatedAt.toISOString(),
    sla:           mapSlaToPortalProjection(sla),
    comments,
    statusHistory,
  };
  if (aiSummaryEnabled && ticket.aiSummary) {
    dto.aiSummary = ticket.aiSummary;
  }
  return dto;
}
