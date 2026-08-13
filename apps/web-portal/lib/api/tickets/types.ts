/**
 * Portal ticket API types — WO-090.
 *
 * Matches the server-side PortalTicketListItemDto / PortalTicketDetailDto shapes.
 * Only customer-safe fields are present; internal fields (assigneeId, visibility,
 * SLA policy internals) are structurally absent from this module.
 *
 * API contract:
 *   GET  /api/v1/portal/tickets
 *   GET  /api/v1/portal/tickets/:id
 *   POST /api/v1/portal/tickets/:id/comments
 *   GET  /api/v1/portal/attachments/:id/download
 */

// ---------------------------------------------------------------------------
// SLA projection — coarse state only, no policy internals
// ---------------------------------------------------------------------------

export type PortalSlaState = 'running' | 'paused' | 'met' | 'breached';

export interface PortalSlaProjection {
  firstResponseTargetAt: string | null;
  resolutionTargetAt: string | null;
  /** Coarse state — no thresholds, pausedMs or policy row exposed. */
  state: PortalSlaState;
}

// ---------------------------------------------------------------------------
// Ticket list
// ---------------------------------------------------------------------------

export interface PortalTicketListItem {
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

export interface PortalTicketListResponse {
  data: PortalTicketListItem[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Ticket detail
// ---------------------------------------------------------------------------

export interface PortalAttachmentMeta {
  id: string;
  displayName: string;
  sizeBytes: number | null;
}

export interface PortalComment {
  id: string;
  /** Safe display name only — never raw email or internal userId. */
  authorDisplayName: string;
  authorType: 'customer' | 'agent';
  body: string;
  createdAt: string;
  attachments: PortalAttachmentMeta[];
}

export interface PortalStatusHistory {
  from: string | null;
  to: string;
  at: string;
}

export interface PortalTicketDetail {
  id: string;
  reference: string | null;
  subject: string;
  status: string;
  priority: string;
  categoryPath: string | null;
  createdAt: string;
  updatedAt: string;
  sla: PortalSlaProjection | null;
  /** Present only when tenant enables portal AI summary. */
  aiSummary?: string;
  comments: PortalComment[];
  statusHistory: PortalStatusHistory[];
}

// ---------------------------------------------------------------------------
// Reply (comment)
// ---------------------------------------------------------------------------

/** visibility must NOT be sent — server forces 'public'. */
export interface PortalAddCommentRequest {
  body: string;
  attachmentIds?: string[];
}

export type PortalAddCommentResponse = PortalComment;

// ---------------------------------------------------------------------------
// Attachment download
// ---------------------------------------------------------------------------

export interface AttachmentDownloadResponse {
  url: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Filter / query parameters
// ---------------------------------------------------------------------------

export interface PortalTicketListFilters {
  /** Comma-separated status values: open, in_progress, resolved, closed */
  status?: string;
  /** Free-text subject search — parameterised server-side, never interpolated. */
  q?: string;
  cursor?: string;
  limit?: number;
}
