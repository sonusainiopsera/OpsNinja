/**
 * Generated types from the OpsNinja OpenAPI 3.1 contract.
 *
 * Refresh with: npm run generate:types -w @opsninja/api-client
 *
 * These types are checked-in and a CI script validates that they match
 * the current contract. Do not edit manually.
 */

// ── Error Envelope ─────────────────────────────────────────────────────────────

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: Array<{ field?: string; message?: string; [key: string]: unknown }>;
    traceId?: string;
    currentVersion?: string;
  };
}

// ── Pagination ─────────────────────────────────────────────────────────────────

export interface PaginationMeta {
  nextCursor: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

// ── Auth ───────────────────────────────────────────────────────────────────────

export interface Principal {
  id: string;
  name: string;
  email: string;
  role: string;
  roles: string[];
  tenantId: string;
  orgScopeVersion: number;
}

export interface OrgScope {
  organizations: Array<{ id: string; name: string }>;
  currentOrgId: string | null;
  orgScopeVersion: number;
}

export interface RefreshResponse {
  accessToken: string;
}

// ── Tickets ────────────────────────────────────────────────────────────────────

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface Ticket {
  id: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  tenantId: string;
  organizationId: string;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateTicketBody {
  title: string;
  description: string;
  priority: TicketPriority;
  organizationId: string;
}

export interface UpdateTicketBody {
  title?: string;
  description?: string;
  status?: TicketStatus;
  priority?: TicketPriority;
  version: number;
}

// ── Agents ─────────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  email: string;
  role: string;
  tenantId: string;
  organizationIds: string[];
  orgScopeVersion: number;
  createdAt: string;
  updatedAt: string;
}

// ── Organizations ──────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  tenantId: string;
  createdAt: string;
  updatedAt: string;
}
