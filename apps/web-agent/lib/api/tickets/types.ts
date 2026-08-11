/**
 * Ticket and queue API types for the agent workspace — WO-041.
 *
 * Mirrors server DTOs so client and server shapes cannot silently drift.
 */

import type { FilterAst } from '@opsninja/filter-compiler';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'pending_customer'
  | 'pending_engineering'
  | 'resolved'
  | 'closed';

export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';

export type SlaState = 'ok' | 'warning' | 'breached' | 'paused';

// ---------------------------------------------------------------------------
// SLA information attached to each ticket row
// ---------------------------------------------------------------------------

export interface TicketSla {
  targetAt: string | null;     // ISO-8601; null when no SLA applied
  pausedMs: number;            // total milliseconds paused
  state: SlaState;
  /** Server's current clock (ISO-8601) for skew correction. */
  serverNow: string;
}

// ---------------------------------------------------------------------------
// Ticket list row (queue view — no heavy fields like description/comments)
// ---------------------------------------------------------------------------

export interface TicketRow {
  id: string;
  ticketNumber: number;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  categoryId: string | null;
  categoryPath: string | null;    // e.g. "Infrastructure / Networking"
  organizationId: string;
  organizationName: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  tags: Array<{ id: string; name: string }>;
  hasJiraLink: boolean;
  jiraIssueKey: string | null;
  sla: TicketSla | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// List / pagination
// ---------------------------------------------------------------------------

export interface TicketListResponse {
  data: TicketRow[];
  nextCursor: string | null;
  /** Changes when the underlying result set mutates (used to show stale indicator). */
  resultSetVersion: string | null;
  /** Server timestamp for clock-skew correction. */
  serverNow: string;
  total: number;
}

export interface TicketListFilters {
  viewId?: string;
  filter?: FilterAst;
  sort?: string;
  sortDir?: 'asc' | 'desc';
  cursor?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

export type BulkActionType = 'assign' | 'set_priority' | 'add_tag' | 'close';

export interface BulkActionPayload {
  ticketIds: string[];
  action: BulkActionType;
  assigneeUserId?: string | null;
  priority?: TicketPriority;
  tagId?: string;
}

export interface BulkActionRowResult {
  ticketId: string;
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface BulkActionResponse {
  results: BulkActionRowResult[];
  succeeded: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Ticket detail — WO-042
// ---------------------------------------------------------------------------

export type AiStatus = 'pending' | 'ready' | 'failed';

export interface SlaSummary {
  state: SlaState;
  targetAt: string | null;
  serverNow: string;
  /** Total paused milliseconds in the SLA clock. */
  pausedMs: number;
  /** ISO timestamp when current pause started (null if not paused). */
  pausedSince: string | null;
  /** 0.0–1.0 elapsed fraction at the 50% reminder threshold. */
  reminder50At: string | null;
  /** 0.0–1.0 elapsed fraction at the 75% reminder threshold. */
  reminder75At: string | null;
  /** ISO timestamp this ticket's SLA was last breached (null if not breached). */
  breachedAt: string | null;
}

export interface JiraLinkDetail {
  issueKey: string;
  issueUrl: string;
  summary: string;
  status: string;
  statusCategory: 'todo' | 'in-progress' | 'done';
}

export interface TicketDetail {
  id: string;
  ticketNumber: number;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  categoryId: string | null;
  categoryPath: string | null;
  organizationId: string;
  organizationName: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  tags: Array<{ id: string; name: string }>;
  customFields: Record<string, unknown>;
  sla: SlaSummary | null;
  jiraLink: JiraLinkDetail | null;
  /** True when the tenant has Jira integration configured. */
  jiraIntegrationEnabled: boolean;
  aiStatus: AiStatus;
  aiCrux: string | null;
  aiAffectedAreaTags: Array<{ id: string; name: string }>;
  /** Server-derived list of legal next statuses for this ticket. */
  allowedTransitions: TicketStatus[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TicketDetailResponse {
  data: TicketDetail;
  traceId: string;
}

// ---------------------------------------------------------------------------
// Comments / thread — WO-042
// ---------------------------------------------------------------------------

export type CommentVisibility = 'public' | 'internal';

export interface CommentAuthor {
  id: string;
  name: string;
  avatarUrl: string | null;
  kind: 'staff' | 'portal' | 'system';
}

export interface CommentAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  downloadUrl: string;
}

export interface Comment {
  id: string;
  ticketId: string;
  visibility: CommentVisibility;
  body: string;
  author: CommentAuthor;
  attachments: CommentAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface CommentListResponse {
  data: Comment[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateCommentPayload {
  body: string;
  visibility: CommentVisibility;
  attachmentIds?: string[];
}

// ---------------------------------------------------------------------------
// Attachments (presign/finalize) — WO-042
// ---------------------------------------------------------------------------

export interface PresignResponse {
  uploadId: string;
  uploadUrl: string;
  /** Fields to include in the multipart POST to storage (e.g. S3 presigned fields). */
  fields: Record<string, string>;
  /** Max allowed file size in bytes. */
  maxBytes: number;
  /** Allowed MIME types. */
  allowedContentTypes: string[];
}

export interface FinalizeAttachmentPayload {
  uploadId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface FinalizeAttachmentResponse {
  attachmentId: string;
  downloadUrl: string;
}

// ---------------------------------------------------------------------------
// Ticket property update — WO-042
// ---------------------------------------------------------------------------

export interface UpdateTicketPayload {
  version: number;
  priority?: TicketPriority;
  assigneeUserId?: string | null;
  categoryId?: string | null;
  tags?: string[];
  customFields?: Record<string, unknown>;
}

export interface ResolveTicketPayload {
  version: number;
  resolutionNote: string;
  affectedAreaTagIds?: string[];
}

export interface ResolveTicketResponse {
  data: TicketDetail;
  traceId: string;
}
