/**
 * AiSummaryService — read, edit and regenerate AI summaries (WO-065).
 *
 * Delegates ticket existence / org-scope checks to TicketRepository so module
 * boundaries hold (AI module never owns ticket business logic).
 *
 * Invariants:
 *   - 404 for unknown or out-of-scope ticket ids (never 403 — existence non-disclosure).
 *   - Portal principals always receive 404 for AI endpoints (Confidential tier data).
 *   - PATCH carries a version counter; stale version → 409.
 *   - Regenerate is rate-limited to one per ticket per 60 s via Redis.
 *   - Every human edit writes an audit record inside the same transaction.
 *   - Regenerate publishes an outbox event so the worker path, idempotency
 *     guard and attempt cap are all reused.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import type Redis from 'ioredis';
import { Inject } from '@nestjs/common';

import {
  ticketAiSummaries,
  ticketAffectedAreas,
  outboxEvents,
  type TicketAiSummary,
  type TicketAffectedArea,
} from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';
import { AuditWriter } from '../audit/audit-writer';
import { getPrincipalContext } from '../../observability/request-context';
import { isPortalPrincipal } from '../identity/portal/portal-principal';
import { TicketRepository } from '../tickets/repositories/ticket.repository';
import { REDIS_CLIENT } from '../../common/redis/redis.provider';
import type { UpdateAiSummaryDto } from './dto/update-ai-summary.dto';

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface AffectedAreaDto {
  id:         string;
  areaLabel:  string;
  confidence: string | null;
  source:     string;
}

export interface AiSummaryDto {
  id:              string;
  ticketId:        string;
  aiStatus:        string;
  crux:            string | null;
  resolution:      string | null;
  affectedAreas:   AffectedAreaDto[];
  modelId:         string | null;
  promptVersion:   string | null;
  generatedAt:     string | null;
  editedBy:        string | null;
  editedAt:        string | null;
  skipReason:      string | null;
  version:         number;
}

/** Redis key for per-ticket regenerate rate limit. */
const regenerateRateLimitKey = (tenantId: string, ticketId: string) =>
  `ai:regen:${tenantId}:${ticketId}`;

const REGEN_TTL_SECONDS = 60;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AiSummaryService extends TenantRepository {
  private readonly logger = new Logger(AiSummaryService.name);

  constructor(
    private readonly ticketRepo: TicketRepository,
    private readonly auditWriter: AuditWriter,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/tickets/:id/ai-summary
  // --------------------------------------------------------------------------

  async getForTicket(ticketId: string): Promise<AiSummaryDto> {
    const principal = getPrincipalContext();

    // Portal principals must never see AI summary data (Confidential tier).
    if (isPortalPrincipal(principal)) {
      throw new NotFoundException({
        error: {
          code:    'AI_SUMMARY_NOT_FOUND',
          message: 'AI summary not found.',
          traceId: principal.traceId,
        },
      });
    }

    // Existence + scope check via TicketRepository (returns null on miss/out-of-scope).
    const ticket = await this.ticketRepo.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException({
        error: {
          code:    'AI_SUMMARY_NOT_FOUND',
          message: 'AI summary not found.',
          traceId: principal.traceId,
        },
      });
    }

    const summaryRows = await this.tx
      .select()
      .from(ticketAiSummaries)
      .where(
        and(
          eq(ticketAiSummaries.ticketId, ticketId),
          eq(ticketAiSummaries.tenantId, principal.tenantId),
        ),
      )
      .limit(1);

    if (!summaryRows[0]) {
      // Return a synthetic pending record when no row exists yet.
      return {
        id:            '',
        ticketId,
        aiStatus:      'pending',
        crux:          null,
        resolution:    null,
        affectedAreas: [],
        modelId:       null,
        promptVersion: null,
        generatedAt:   null,
        editedBy:      null,
        editedAt:      null,
        skipReason:    null,
        version:       0,
      };
    }

    const summary = summaryRows[0];
    const areas = await this.loadAffectedAreas(summary.id);
    return this.toDto(summary, areas);
  }

  // --------------------------------------------------------------------------
  // PATCH /api/v1/tickets/:id/ai-summary
  // --------------------------------------------------------------------------

  async updateForTicket(ticketId: string, dto: UpdateAiSummaryDto): Promise<AiSummaryDto> {
    const principal = getPrincipalContext();

    if (isPortalPrincipal(principal)) {
      throw new NotFoundException({
        error: { code: 'AI_SUMMARY_NOT_FOUND', message: 'AI summary not found.', traceId: principal.traceId },
      });
    }

    const ticket = await this.ticketRepo.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException({
        error: { code: 'AI_SUMMARY_NOT_FOUND', message: 'AI summary not found.', traceId: principal.traceId },
      });
    }

    const existing = await this.tx
      .select()
      .from(ticketAiSummaries)
      .where(
        and(
          eq(ticketAiSummaries.ticketId, ticketId),
          eq(ticketAiSummaries.tenantId, principal.tenantId),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      throw new NotFoundException({
        error: { code: 'AI_SUMMARY_NOT_FOUND', message: 'AI summary not found.', traceId: principal.traceId },
      });
    }

    const current = existing[0];

    // Optimistic-concurrency check.
    if (current.version !== dto.version) {
      throw new ConflictException({
        error: {
          code:    'VERSION_CONFLICT',
          message: 'The AI summary has been modified by another request. Reload and retry.',
          details: [{ currentVersion: current.version, requestedVersion: dto.version }],
          traceId: principal.traceId,
        },
      });
    }

    const beforeState = this.toDto(current, await this.loadAffectedAreas(current.id));

    // Apply updates.
    const now = new Date();
    const [updated] = await this.tx
      .update(ticketAiSummaries)
      .set({
        ...(dto.crux       !== undefined ? { cruxSummary:        dto.crux       } : {}),
        ...(dto.resolution !== undefined ? { resolutionSummary:  dto.resolution } : {}),
        editedBy:  principal.userId,
        editedAt:  now,
        version:   current.version + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(ticketAiSummaries.id,       current.id),
          eq(ticketAiSummaries.tenantId, principal.tenantId),
          eq(ticketAiSummaries.version,  dto.version), // CAS guard at DB level
        ),
      )
      .returning();

    if (!updated) {
      // Another writer won the race after our read.
      throw new ConflictException({
        error: {
          code:    'VERSION_CONFLICT',
          message: 'The AI summary was modified concurrently. Reload and retry.',
          traceId: principal.traceId,
        },
      });
    }

    // Replace affected areas if provided.
    let areas: TicketAffectedArea[];
    if (dto.affectedAreas !== undefined) {
      await this.tx
        .delete(ticketAffectedAreas)
        .where(eq(ticketAffectedAreas.summaryId, current.id));

      if (dto.affectedAreas.length > 0) {
        await this.tx.insert(ticketAffectedAreas).values(
          dto.affectedAreas.map((a) => ({
            tenantId:  principal.tenantId,
            ticketId,
            summaryId: current.id,
            areaLabel: a.areaLabel,
            confidence: a.confidence,
            source:    'human' as const,
          })),
        );
      }
      areas = await this.loadAffectedAreas(current.id);
    } else {
      areas = await this.loadAffectedAreas(current.id);
    }

    const afterState = this.toDto(updated, areas);

    // Audit record (inside same transaction — fail-closed).
    await this.auditWriter.append({
      resourceType: 'ticket_ai_summary',
      resourceId:   current.id,
      action:       'update',
      beforeState:  beforeState as unknown as Record<string, unknown>,
      afterState:   afterState  as unknown as Record<string, unknown>,
    });

    this.logger.log('AI summary updated by agent', { ticketId, actorId: principal.userId });

    return afterState;
  }

  // --------------------------------------------------------------------------
  // POST /api/v1/tickets/:id/ai-summary/regenerate
  // --------------------------------------------------------------------------

  async requestRegenerate(ticketId: string): Promise<{ aiStatus: string }> {
    const principal = getPrincipalContext();

    if (isPortalPrincipal(principal)) {
      throw new NotFoundException({
        error: { code: 'AI_SUMMARY_NOT_FOUND', message: 'AI summary not found.', traceId: principal.traceId },
      });
    }

    const ticket = await this.ticketRepo.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException({
        error: { code: 'AI_SUMMARY_NOT_FOUND', message: 'AI summary not found.', traceId: principal.traceId },
      });
    }

    // Redis rate limit: at most once per 60 s per (tenant, ticket).
    const rateLimitKey = regenerateRateLimitKey(principal.tenantId, ticketId);
    let retryAfter: number | null = null;
    try {
      const ttl = await this.redis.ttl(rateLimitKey);
      if (ttl > 0) {
        retryAfter = ttl;
      }
    } catch {
      // Redis error — degrade gracefully; allow the request through.
      this.logger.warn('Redis TTL check failed for regenerate rate limit', { ticketId });
    }

    if (retryAfter !== null) {
      throw new HttpException(
        {
          error: {
            code:       'REGENERATE_RATE_LIMITED',
            message:    `Regenerate may be called at most once per ${REGEN_TTL_SECONDS}s. Retry after ${retryAfter}s.`,
            retryAfter,
            traceId:    principal.traceId,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Reset summary to pending and bump version.
    const now = new Date();
    await this.tx
      .update(ticketAiSummaries)
      .set({
        aiStatus:     'pending',
        attemptCount: 0,
        updatedAt:    now,
        version:      (await this.tx
          .select({ v: ticketAiSummaries.version })
          .from(ticketAiSummaries)
          .where(
            and(
              eq(ticketAiSummaries.ticketId, ticketId),
              eq(ticketAiSummaries.tenantId, principal.tenantId),
            ),
          )
          .limit(1)
          .then((r) => (r[0]?.v ?? 0) + 1)),
      })
      .where(
        and(
          eq(ticketAiSummaries.ticketId, ticketId),
          eq(ticketAiSummaries.tenantId, principal.tenantId),
        ),
      );

    // Publish outbox event so the worker reprocesses through the same path.
    await this.tx.insert(outboxEvents).values({
      tenantId:      principal.tenantId,
      aggregateType: 'ticket',
      aggregateId:   ticketId,
      eventType:     'ai.synthesis.requested',
      payload:       {
        ticketId,
        triggeredBy: principal.userId,
        manual:      true,
      },
      traceId: principal.traceId,
    });

    // Audit record for the regenerate action.
    await this.auditWriter.append({
      resourceType: 'ticket_ai_summary',
      resourceId:   ticketId,
      action:       'regenerate',
      afterState:   { ticketId, triggeredBy: principal.userId, aiStatus: 'pending' },
    });

    // Set Redis rate-limit key (best effort — don't fail if Redis is down).
    try {
      await this.redis.setex(rateLimitKey, REGEN_TTL_SECONDS, '1');
    } catch {
      this.logger.warn('Redis SETEX failed for regenerate rate limit', { ticketId });
    }

    this.logger.log('AI summary regenerate requested', { ticketId, actorId: principal.userId });

    return { aiStatus: 'pending' };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async loadAffectedAreas(summaryId: string): Promise<TicketAffectedArea[]> {
    return this.tx
      .select()
      .from(ticketAffectedAreas)
      .where(eq(ticketAffectedAreas.summaryId, summaryId));
  }

  private toDto(summary: TicketAiSummary, areas: TicketAffectedArea[]): AiSummaryDto {
    return {
      id:            summary.id,
      ticketId:      summary.ticketId,
      aiStatus:      summary.aiStatus,
      crux:          summary.cruxSummary ?? null,
      resolution:    summary.resolutionSummary ?? null,
      affectedAreas: areas.map((a) => ({
        id:         a.id,
        areaLabel:  a.areaLabel,
        confidence: a.confidence ?? null,
        source:     a.source,
      })),
      modelId:       summary.modelId ?? null,
      promptVersion: summary.promptVersion ?? null,
      generatedAt:   summary.generatedAt?.toISOString() ?? null,
      editedBy:      summary.editedBy ?? null,
      editedAt:      summary.editedAt?.toISOString() ?? null,
      skipReason:    summary.skipReason ?? null,
      version:       summary.version,
    };
  }
}
