/**
 * TicketResponseDto — canonical ticket representation returned by
 * POST /api/v1/tickets and GET /api/v1/tickets/:id.
 *
 * Intentionally omits:
 *   - tenant_id (tenant disclosure)
 *   - assigneeId raw UUID (included as nested assignee object)
 *   - Internal-only fields returned by PortalTicketsController via its own mapper
 *
 * This mapper is the reference implementation for all agent-facing ticket
 * serialisation (queue endpoint, ticket detail, exports).
 */

import type { Ticket } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Nested shape types
// ---------------------------------------------------------------------------

export interface OrganizationSummaryDto {
  id: string;
  name: string;
  slaTier: string | null;
}

export interface RequesterSummaryDto {
  id: string;
  email: string;
  fullName: string;
}

export interface AssigneeSummaryDto {
  id: string;
  name: string;
  email: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  /** Breadcrumb path, e.g. ['Infrastructure', 'Networking'] */
  path: string[];
}

export interface TagDto {
  id: string;
  name: string;
  color: string | null;
}

export interface SlaSummaryDto {
  /**
   * ISO-8601 timestamp when the SLA timer expires (response or resolution).
   * Null when no SLA policy is matched yet.
   */
  targetAt: string | null;
  /**
   * SLA state: 'ok' | 'at_risk' | 'breached' | null (not yet computed).
   */
  state: 'ok' | 'at_risk' | 'breached' | null;
}

// ---------------------------------------------------------------------------
// Canonical TicketDto
// ---------------------------------------------------------------------------

export interface TicketDto {
  id: string;
  ticketNumber: number | null;

  status: string;
  priority: string;
  subject: string;

  /** Description is present in agent-facing responses. */
  description: string | null;

  organization: OrganizationSummaryDto;
  requester: RequesterSummaryDto | null;
  assignee: AssigneeSummaryDto | null;
  category: CategoryDto | null;
  tags: TagDto[];

  sla: SlaSummaryDto;

  /**
   * AI synthesis state: null | 'pending' | 'processing' | 'complete' | 'failed'.
   */
  aiStatus: string | null;

  customFields: Record<string, unknown>;

  version: number;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Context bags for optional enrichment
// ---------------------------------------------------------------------------

export interface TicketEnrichment {
  organization: OrganizationSummaryDto;
  requester: RequesterSummaryDto | null;
  assignee: AssigneeSummaryDto | null;
  tags: TagDto[];
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Map a raw Ticket row + optional enrichment into the canonical TicketDto.
 *
 * When enrichment is not yet loaded (lazy path), defaults to safe empty values.
 * The caller is responsible for fetching enrichment data before calling this.
 */
export function mapToTicketDto(
  ticket: Ticket,
  enrichment: TicketEnrichment,
): TicketDto {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber ?? null,

    status: ticket.status,
    priority: ticket.priority,
    subject: ticket.subject,
    description: ticket.description ?? null,

    organization: enrichment.organization,
    requester: enrichment.requester,
    assignee: enrichment.assignee,
    category: null, // populated by CategoriesModule (future WO)
    tags: enrichment.tags,

    sla: {
      targetAt: null,  // populated by SlaModule timer (future WO)
      state: null,
    },

    aiStatus: ticket.aiStatus ?? null,
    customFields: (ticket.customFields as Record<string, unknown>) ?? {},

    version: ticket.version,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}
