/**
 * @opsninja/api-types — TypeScript types generated from the OpsNinja OpenAPI 3.1
 * public document (WO-099, AC9).
 *
 * These types mirror the schemas in docs/api/openapi.public.json exactly.
 * They are consumed by test suites (contract tests, isolation tests) to prove
 * the published API contract is machine-usable.
 *
 * Generation process:
 *   1. Run `ts-node apps/api/scripts/generate-openapi.ts` to update the snapshot.
 *   2. Update this file to reflect any schema changes (automated in a real project
 *      via openapi-typescript or similar tooling).
 *
 * @see docs/api/openapi.public.json
 */

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

/** Ticket lifecycle status. */
export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';

/** SLA priority (P1 = critical, P4 = low). */
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4';

/** Comment visibility. */
export type CommentVisibility = 'public' | 'internal';

/** SLA clock state. */
export type SlaTimerState = 'running' | 'paused' | 'met' | 'breached';

/** Portal author type. */
export type PortalAuthorType = 'customer' | 'agent';

// ---------------------------------------------------------------------------
// Error envelope (AC4)
// ---------------------------------------------------------------------------

/** Field-level or context detail item. */
export interface ErrorDetail {
  [key: string]: unknown;
}

/** Inner error object returned on all error responses. */
export interface ErrorBody {
  /** Machine-readable error code. */
  code: string;
  /** Human-readable error description. */
  message: string;
  /** Field-level detail items. */
  details?: ErrorDetail[];
  /** Correlation ID echoed from X-Trace-ID request header. */
  traceId?: string;
}

/**
 * Uniform error envelope returned on all 4xx/5xx responses.
 * AC4: defined once, referenced from every error response.
 */
export interface ErrorEnvelope {
  error: ErrorBody;
}

// ---------------------------------------------------------------------------
// Pagination (AC5)
// ---------------------------------------------------------------------------

/**
 * Cursor-paginated page result.
 * AC5: cursor and limit query params, nextCursor in responses.
 */
export interface CursorPage<T> {
  data: T[];
  /** Continuation token. Null when no further pages exist. */
  nextCursor: string | null;
  traceId?: string;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

/** Agent-facing ticket representation. */
export interface Ticket {
  id: string;
  tenantId: string;
  organizationId: string;
  reference: string | null;
  subject: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  /** Optimistic concurrency version. Include in update requests. */
  version: number;
  assigneeId: string | null;
  assignmentGroupId?: string | null;
  categoryId: string | null;
  requesterContactId: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Request body for POST /tickets. */
export interface CreateTicketRequest {
  subject: string;
  description?: string;
  priority?: TicketPriority;
  organization_id: string;
  requester_contact_id?: string;
  category_id?: string;
}

/** Request body for PATCH /tickets/:id. */
export interface UpdateTicketRequest {
  subject?: string;
  description?: string;
  priority?: TicketPriority;
  status?: TicketStatus;
  assigneeId?: string;
  version?: number;
}

/** Request body for POST /tickets/:id/resolve. */
export interface ResolveTicketRequest {
  resolution?: string;
  version?: number;
}

// ---------------------------------------------------------------------------
// Portal tickets (AC6: only public operations)
// ---------------------------------------------------------------------------

/**
 * Customer-safe SLA projection.
 * AC: internal thresholds, pausedMs and elapsedMs are NEVER exposed.
 */
export interface PortalSlaProjection {
  firstResponseTargetAt: string | null;
  resolutionTargetAt: string | null;
  state: SlaTimerState;
}

/** Narrow portal ticket list item. */
export interface PortalTicketListItem {
  id: string;
  reference: string | null;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  categoryPath: string | null;
  createdAt: string;
  updatedAt: string;
  sla: PortalSlaProjection | null;
}

/** Paginated portal ticket list response. */
export type PortalTicketListPage = CursorPage<PortalTicketListItem>;

/** Status history entry. actorUserId is NEVER exposed to portal. */
export interface PortalStatusHistoryEntry {
  from: string | null;
  to: TicketStatus;
  at: string;
}

/** Customer-safe attachment metadata. s3Key is NEVER exposed. */
export interface PortalAttachmentMeta {
  id: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Public comment on a portal ticket.
 * visibility field is NEVER exposed — portal always sees only public comments.
 */
export interface PortalComment {
  id: string;
  body: string;
  /** Display name only — never email or internal user ID. */
  authorDisplayName: string;
  authorType: PortalAuthorType;
  attachments?: PortalAttachmentMeta[];
  createdAt: string;
  updatedAt?: string;
}

/** Full portal ticket detail. */
export interface PortalTicketDetail {
  id: string;
  reference: string | null;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  categoryPath: string | null;
  createdAt: string;
  updatedAt: string;
  sla: PortalSlaProjection | null;
  /** Present only when per-tenant portalAiSummaryEnabled is true. */
  aiSummary?: string;
  comments: PortalComment[];
  statusHistory: PortalStatusHistoryEntry[];
}

/** Request body for POST /portal/tickets. */
export interface CreatePortalTicketRequest {
  subject: string;
  description: string;
  categoryId?: string;
  requestedPriority?: TicketPriority;
  attachmentIds?: string[];
}

/**
 * Request body for POST /portal/tickets/:id/comments.
 * The `visibility` field MUST NOT be present (returns 400 if supplied).
 */
export interface AddPortalCommentRequest {
  body: string;
  attachmentIds?: string[];
  // visibility is intentionally absent — portal always forces 'public'
}

// ---------------------------------------------------------------------------
// Agent comments
// ---------------------------------------------------------------------------

/** Agent-facing comment. */
export interface Comment {
  id: string;
  ticketId: string;
  authorId: string | null;
  body: string;
  visibility: CommentVisibility;
  createdAt: string;
  updatedAt?: string;
}

/** Request body for POST /tickets/:id/comments. */
export interface AddCommentRequest {
  body: string;
  visibility: CommentVisibility;
  attachmentIds?: string[];
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/** Agent attachment metadata. */
export interface AttachmentMeta {
  id: string;
  ticketId?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/** Pre-signed download URL response. */
export interface AttachmentDownload {
  url: string;
  expiresAt: string;
}

/** Request body for presign operations. */
export interface PresignAttachmentRequest {
  filename: string;
  mimeType: string;
  /** File size in bytes. Maximum 25 MB (26214400). */
  sizeBytes: number;
}

/** Pre-signed S3 POST response. The API never receives the file body. */
export interface PresignAttachmentResponse {
  attachmentId: string;
  uploadUrl: string;
  fields: Record<string, string>;
  expiresAt: string;
}

/** Request body for finalize attachment. */
export interface FinalizeAttachmentRequest {
  attachmentId: string;
}

// ---------------------------------------------------------------------------
// SLA
// ---------------------------------------------------------------------------

/** Individual SLA clock (response or resolution). */
export interface SlaClock {
  clockType: 'response' | 'resolution';
  state: SlaTimerState;
  targetAt: string;
  startedAt: string;
  elapsedMs: number;
  remainingMs: number;
  pausedMs: number;
  elapsedPct: number;
  thresholds?: { first: number; second: number };
  computedAt?: string;
}

/** SLA timer result for a ticket. */
export interface TicketSlaResult {
  ticketId: string;
  clocks: SlaClock[];
  reason?: 'no_policy' | 'timer_not_started';
}

/** SLA policy. */
export interface SlaPolicy {
  id: string;
  name: string;
  priority: TicketPriority;
  firstResponseTargetHours?: number;
  resolutionTargetHours?: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

/** Customer organisation. */
export interface Organization {
  id: string;
  tenantId: string;
  name: string;
  domains?: string[];
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

/** Request body for POST /organizations. */
export interface CreateOrganizationRequest {
  name: string;
  domains?: string[];
  customFields?: Record<string, unknown>;
}

/** Request body for PATCH /organizations/:id. */
export interface UpdateOrganizationRequest {
  name?: string;
  customFields?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** User in the tenant. */
export interface User {
  id: string;
  tenantId: string;
  email: string;
  displayName?: string;
  roles?: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** Saved ticket-queue filter view. */
export interface SavedView {
  id: string;
  name: string;
  filters?: Record<string, unknown>;
  isDefault?: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/** Immutable audit log entry. */
export interface AuditLog {
  id: string;
  tenantId: string;
  actorId: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  changes?: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Outbound webhook subscription. */
export interface Webhook {
  id: string;
  tenantId: string;
  url: string;
  events: string[];
  active?: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Convenience re-exports — pagination helpers
// ---------------------------------------------------------------------------

/** Cursor pagination query parameters (AC5: limit max 100). */
export interface CursorQueryParams {
  cursor?: string;
  limit?: number; // 1–100, default 20
}

/**
 * Known internal-only operationIds — these MUST NOT appear in the public document.
 * Used by the exclusion filter test (AC6).
 */
export const INTERNAL_OPERATION_IDS = [
  'healthCheck',
  'authLogin',
  'listJiraConnections',
  'adminCreateTenant',
] as const;

export type InternalOperationId = (typeof INTERNAL_OPERATION_IDS)[number];

/**
 * Known public operationIds — these MUST all appear in the public document.
 * Used by completeness contract tests (AC2, AC9).
 */
export const PUBLIC_OPERATION_IDS = [
  'listPortalTickets',
  'createPortalTicket',
  'getPortalTicket',
  'addPortalComment',
  'downloadPortalAttachment',
  'presignPortalAttachment',
  'confirmPortalAttachment',
  'createTicket',
  'listTickets',
  'getTicket',
  'updateTicket',
  'resolveTicket',
  'addComment',
  'listComments',
  'presignAttachment',
  'finalizeAttachment',
  'downloadAttachment',
  'getTicketSla',
  'listSlaPolicies',
  'createOrganization',
  'getOrganization',
  'updateOrganization',
  'listViews',
  'listUsers',
  'listAuditLogs',
  'listWebhooks',
] as const;

export type PublicOperationId = (typeof PUBLIC_OPERATION_IDS)[number];
