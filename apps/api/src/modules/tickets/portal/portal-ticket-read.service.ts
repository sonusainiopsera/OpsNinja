/**
 * PortalTicketReadService — WO-090
 *
 * Read service for the portal ticket surface. Enforces:
 *   1. Organization scope: every query includes organizationId = boundOrganizationId
 *   2. Public visibility: comment queries always include visibility = 'public'
 *   3. Keyset pagination on (created_at DESC, id DESC) — stable, O(log n) at depth
 *   4. Allow-listed filters only (status + subject search via portal-filter-mapper)
 *   5. Customer-safe SLA projection — no policy internals, thresholds or pausedMs
 *   6. Status history from append-only audit trail
 *   7. Redis result cache with 30s TTL, invalidated on ticket mutation events
 *
 * Security invariants:
 *   - All SQL predicates are Drizzle parameterised — no string interpolation.
 *   - RLS applies via SET LOCAL app.current_tenant (in TenantRepository base).
 *   - organisationId predicate is non-bypassable (enforced inside helpers, not by callers).
 *   - portal_access_denied_total incremented on out-of-scope access.
 */

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import {
  tickets,
  ticketComments,
  ticketAttachments,
  ticketStatusHistory,
  type Ticket,
  type TicketComment,
  type TicketAttachment,
  type TicketStatusHistory,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { RedisCacheService } from '../../../infra/cache/redis-cache';
import { SlaQueryService } from '../../sla/sla-query.service';
import { getPrincipalContext } from '../../../observability/request-context';
import { assertPortalPrincipal } from '../../identity/portal/portal-principal';
import { TenantSettingsRepository } from '../repositories/tenant-settings.repository';
import { OBJECT_STORE_PORT, type ObjectStorePort } from '../attachments/storage/object-store.port';
import {
  mapTicketToPortalListItem,
  mapTicketToPortalDetail,
  mapCommentToPortalDto,
  mapStatusHistoryToPortalDto,
  mapAttachmentToPortalMeta,
  type PortalTicketListPageDto,
  type PortalTicketDetailDto,
  type PortalCommentDto,
  type PortalStatusHistoryDto,
  type AttachmentDownloadDto,
} from './portal-ticket.dto';
import {
  mapPortalFilters,
  filterSignature,
  type PortalTicketFilters,
} from './portal-filter-mapper';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_TTL_SECONDS    = 30;
const MAX_LIMIT            = 100;
const DEFAULT_LIMIT        = 20;
const DOWNLOAD_EXPIRY_SECS = 5 * 60; // 5 minutes (AC8)

@Injectable()
export class PortalTicketReadService extends TenantRepository {
  private readonly logger = new Logger(PortalTicketReadService.name);

  constructor(
    private readonly slaQueryService: SlaQueryService,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly cache: RedisCacheService,
    @Inject(OBJECT_STORE_PORT) private readonly objectStore: ObjectStorePort,
  ) {
    super();
  }

  // ---------------------------------------------------------------------------
  // List tickets (AC1, AC2, AC10)
  // ---------------------------------------------------------------------------

  async listTickets(
    filters: PortalTicketFilters,
    cursor: string | undefined,
    limit: number = DEFAULT_LIMIT,
  ): Promise<PortalTicketListPageDto> {
    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);

    const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
    const sig = filterSignature(filters);
    const cacheKey = `portal:tickets:${principal.userId}:${sig}:${cursor ?? 'start'}:${effectiveLimit}`;

    // Try cache first — fall through on miss or Redis error
    const cached = await this.cache.get<PortalTicketListPageDto>(cacheKey);
    if (cached) return cached;

    // --- Build predicate ---
    // 1. Hard-coded org isolation — non-bypassable (AC4)
    let where: SQL = eq(tickets.organizationId, principal.boundOrganizationId);

    // 2. Allow-listed user filters
    const filterPredicate = mapPortalFilters(filters);
    if (filterPredicate) {
      where = and(where, filterPredicate) as SQL;
    }

    // 3. Keyset cursor: (created_at, id) DESC — stable across concurrent inserts
    if (cursor) {
      const pos = decodeCursor(cursor);
      where = and(
        where,
        or(
          lt(tickets.createdAt, new Date(pos.createdAt)),
          and(
            eq(tickets.createdAt, new Date(pos.createdAt)),
            lt(tickets.id, pos.id),
          ),
        ),
      ) as SQL;
    }

    const rows = await this.tx
      .select()
      .from(tickets)
      .where(where)
      .orderBy(desc(tickets.createdAt), desc(tickets.id))
      .limit(effectiveLimit + 1); // fetch one extra to determine nextCursor

    const hasMore = rows.length > effectiveLimit;
    const pageRows = hasMore ? rows.slice(0, effectiveLimit) : rows;

    // Fetch SLA for each ticket (without policy internals)
    const items = await Promise.all(
      pageRows.map(async (ticket) => {
        const sla = await this.slaQueryService.getTicketSla(ticket.tenantId, ticket.id).catch(() => null);
        return mapTicketToPortalListItem(ticket, sla);
      }),
    );

    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor(last.createdAt.toISOString(), last.id)
      : null;

    const result: PortalTicketListPageDto = { data: items, nextCursor };
    await this.cache.set(cacheKey, result, CACHE_TTL_SECONDS);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Get ticket detail (AC3, AC4, AC7)
  // ---------------------------------------------------------------------------

  async getTicketDetail(ticketId: string): Promise<PortalTicketDetailDto> {
    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);

    // Org-scoped ticket lookup — returns null for out-of-scope or other-tenant IDs (AC4)
    const ticket = await this.tx
      .select()
      .from(tickets)
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(tickets.organizationId, principal.boundOrganizationId),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null);

    if (!ticket) {
      this.emitAccessDenied(principal.tenantId, principal.userId, ticketId, 'ticket_not_in_org');
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Ticket not found.' } });
    }

    // Public-only comments — visibility predicate is non-bypassable (AC3, AC7)
    const commentRows = await this.tx
      .select()
      .from(ticketComments)
      .where(
        and(
          eq(ticketComments.ticketId, ticketId),
          eq(ticketComments.visibility, 'public'),
          eq(ticketComments.organizationId, principal.boundOrganizationId),
        ),
      )
      .orderBy(ticketComments.createdAt);

    // Confirmed attachments for each comment
    const comments: PortalCommentDto[] = await Promise.all(
      commentRows.map(async (c) => {
        const atts = await this.tx
          .select()
          .from(ticketAttachments)
          .where(
            and(
              eq(ticketAttachments.commentId, c.id),
              eq(ticketAttachments.isFinalized, true),
            ),
          );
        return mapCommentToPortalDto(c, atts, resolveDisplayName(c), resolveAuthorType(c));
      }),
    );

    // Status history (append-only audit trail)
    const historyRows = await this.tx
      .select()
      .from(ticketStatusHistory)
      .where(eq(ticketStatusHistory.ticketId, ticketId))
      .orderBy(ticketStatusHistory.createdAt);

    const statusHistory: PortalStatusHistoryDto[] = historyRows.map(mapStatusHistoryToPortalDto);

    // Customer-safe SLA projection (AC3)
    const sla = await this.slaQueryService.getTicketSla(ticket.tenantId, ticketId).catch(() => null);

    // AI summary gate
    const settings = await this.tenantSettingsRepository.findByTenantId(ticket.tenantId);
    const aiSummaryEnabled = settings?.portalAiSummaryEnabled ?? false;

    return mapTicketToPortalDetail(ticket, comments, statusHistory, sla, aiSummaryEnabled);
  }

  // ---------------------------------------------------------------------------
  // Attachment download pre-signed URL (AC8)
  // ---------------------------------------------------------------------------

  async getAttachmentDownloadUrl(attachmentId: string): Promise<AttachmentDownloadDto> {
    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);

    // 1. Attachment must exist and be finalized
    const attachment = await this.tx
      .select()
      .from(ticketAttachments)
      .where(
        and(
          eq(ticketAttachments.id, attachmentId),
          eq(ticketAttachments.isFinalized, true),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!attachment) {
      this.emitAccessDenied(principal.tenantId, principal.userId, attachmentId, 'attachment_not_found');
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Attachment not found.' } });
    }

    // 2. Ticket ownership check — attachment's ticket must belong to this org
    if (attachment.ticketId) {
      const ownerTicket = await this.tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(
          and(
            eq(tickets.id, attachment.ticketId),
            eq(tickets.organizationId, principal.boundOrganizationId),
          ),
        )
        .limit(1)
        .then((r) => r[0] ?? null);

      if (!ownerTicket) {
        this.emitAccessDenied(principal.tenantId, principal.userId, attachmentId, 'attachment_wrong_org');
        throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Attachment not found.' } });
      }
    } else {
      // Unlinked attachment — ownership check via uploadedByUserId
      const att = attachment as unknown as { uploadedByUserId?: string | null };
      if (att.uploadedByUserId !== principal.userId) {
        this.emitAccessDenied(principal.tenantId, principal.userId, attachmentId, 'attachment_not_owner');
        throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Attachment not found.' } });
      }
    }

    // 3. Check if object still exists in storage (handle reaped objects gracefully)
    const s3Key = (attachment as unknown as { s3Key?: string }).s3Key;
    if (!s3Key) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Attachment not found.' } });
    }

    try {
      const url = await this.objectStore.presignGet(s3Key, DOWNLOAD_EXPIRY_SECS);
      const expiresAt = new Date(Date.now() + DOWNLOAD_EXPIRY_SECS * 1000).toISOString();
      return { url, expiresAt };
    } catch {
      // Object reaped or unavailable — return 404 rather than broken link
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Attachment unavailable.' } });
    }
  }

  // ---------------------------------------------------------------------------
  // Cache invalidation helpers (called by event handlers)
  // ---------------------------------------------------------------------------

  /** Invalidate all cached list pages for a user when their ticket is mutated. */
  async invalidateUserCache(userId: string): Promise<void> {
    await this.cache.delPattern(`portal:tickets:${userId}:*`);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private emitAccessDenied(
    tenantId: string,
    userId: string,
    resourceId: string,
    reason: string,
  ): void {
    this.logger.warn('Portal access denied', {
      metric: 'portal_access_denied_total',
      tenantId,
      userId,
      resourceId,
      reason,
    });
  }
}

// ---------------------------------------------------------------------------
// Cursor encode / decode (keyset on created_at DESC, id DESC)
// ---------------------------------------------------------------------------

interface PortalCursorPayload {
  createdAt: string; // ISO-8601
  id: string;        // UUID tiebreaker
}

function encodeCursor(createdAt: string, id: string): string {
  const payload: PortalCursorPayload = { createdAt, id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(encoded: string): PortalCursorPayload {
  try {
    const json = Buffer.from(encoded, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as PortalCursorPayload;
    if (
      typeof payload.createdAt !== 'string' ||
      typeof payload.id !== 'string'
    ) {
      throw new Error('invalid structure');
    }
    // Validate ISO date
    if (isNaN(new Date(payload.createdAt).getTime())) {
      throw new Error('invalid date');
    }
    return payload;
  } catch {
    const { BadRequestException } = require('@nestjs/common') as typeof import('@nestjs/common');
    throw new BadRequestException({
      error: { code: 'CURSOR_INVALID', message: 'The pagination cursor is malformed.' },
    });
  }
}

// ---------------------------------------------------------------------------
// Comment author resolution (AC7 — no PII in display name)
// ---------------------------------------------------------------------------

function resolveDisplayName(comment: TicketComment): string {
  // authorId being set means it's a customer contact. Agent comments have a
  // different author mechanism. We return a safe generic display name.
  // Full name resolution from contact table is deferred — portal only sees
  // public comments, so "Customer" is always safe as the fallback.
  return comment.authorId ? 'Customer' : 'Support Agent';
}

function resolveAuthorType(comment: TicketComment): 'customer' | 'agent' {
  // Portal authors (contacts) always have authorId set; agent authors have
  // a different field. Since we only expose public comments, agent replies
  // to customers are naturally labelled 'agent'.
  return comment.authorId ? 'customer' : 'agent';
}
