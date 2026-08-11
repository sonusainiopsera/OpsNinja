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
