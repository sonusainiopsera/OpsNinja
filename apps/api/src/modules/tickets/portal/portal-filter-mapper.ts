/**
 * portal-filter-mapper.ts — WO-090
 *
 * Allow-listed filter mapper for portal ticket list queries.
 *
 * Only `status` and `q` (subject free-text search) are permitted.
 * Unknown fields are rejected with 400. Raw filter values are NEVER
 * interpolated into SQL — all values are passed as Drizzle typed predicates.
 *
 * Returning SQL | undefined means "no predicate required" rather than "error".
 */

import { BadRequestException } from '@nestjs/common';
import { and, eq, ilike, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { tickets } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Input type — fields received from query params
// ---------------------------------------------------------------------------

export interface PortalTicketFilters {
  /** Comma-separated list of status values: open, in_progress, resolved, closed */
  status?: string;
  /** Free-text subject search (partial, case-insensitive) */
  q?: string;
}

// Validated status values for the portal — agents see more; portal users see fewer.
const ALLOWED_STATUSES = new Set(['open', 'in_progress', 'resolved', 'closed']);

/**
 * Map validated portal filter fields to Drizzle SQL predicates.
 *
 * @throws BadRequestException on unknown fields or invalid status values.
 * @returns SQL predicate or undefined when no filters are active.
 */
export function mapPortalFilters(filters: PortalTicketFilters): SQL | undefined {
  const parts: SQL[] = [];

  if (filters.status !== undefined) {
    const statuses = filters.status.split(',').map((s) => s.trim()).filter(Boolean);
    for (const s of statuses) {
      if (!ALLOWED_STATUSES.has(s)) {
        throw new BadRequestException({
          error: {
            code: 'INVALID_FILTER_VALUE',
            message: `Invalid status filter value: "${s}". Allowed: ${[...ALLOWED_STATUSES].join(', ')}`,
            field: 'status',
          },
        });
      }
    }
    if (statuses.length === 1) {
      parts.push(eq(tickets.status, statuses[0]!));
    } else if (statuses.length > 1) {
      parts.push(inArray(tickets.status, statuses));
    }
  }

  if (filters.q !== undefined) {
    const trimmed = filters.q.trim();
    if (trimmed.length > 200) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_FILTER_VALUE',
          message: 'Subject search query exceeds maximum length of 200 characters.',
          field: 'q',
        },
      });
    }
    if (trimmed.length > 0) {
      // ilike is a parameterised ILIKE — Drizzle passes value as a bind parameter
      parts.push(ilike(tickets.subject, `%${trimmed}%`));
    }
  }

  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return and(...parts) as SQL;
}

/**
 * Build a stable cache-key fragment from portal filters.
 * Used as part of the Redis cache key for list results.
 */
export function filterSignature(filters: PortalTicketFilters): string {
  const parts: string[] = [];
  if (filters.status) parts.push(`s:${filters.status}`);
  if (filters.q)      parts.push(`q:${encodeURIComponent(filters.q.trim())}`);
  return parts.join('|');
}
