/**
 * AiSynthesisAdminController — WO-064 AC-9.
 *
 * Admin endpoint exposing tenant-scoped, cursor-paginated failed syntheses.
 *
 * Routes (all under /api/v1/admin/ai-synthesis):
 *   GET /failures  — list failed ai summaries for the calling tenant
 *
 * RBAC: admin:manage_tenant (Administrator role only).
 * Cursor: opaque base64-encoded updated_at + id for stable keyset pagination.
 * Limit: capped at 100.
 *
 * Error codes surfaced to admins never include prompts, thread content or
 * stack traces — only the stable last_error_code string (WO-064 constraint).
 */

import {
  Controller,
  Get,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { eq, and, lt, or, sql } from 'drizzle-orm';

import { ticketAiSummaries } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { getPrincipalContext } from '../../observability/request-context';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

interface FailureRecord {
  ticketId:      string;
  aiStatus:      string;
  attemptCount:  number;
  lastErrorCode: string | null;
  updatedAt:     string;
}

interface FailuresResponse {
  data:       FailureRecord[];
  nextCursor: string | null;
}

@Controller('admin/ai-synthesis')
@RequirePermission('admin:manage_tenant')
export class AiSynthesisAdminController extends TenantRepository {
  // --------------------------------------------------------------------------
  // GET /api/v1/admin/ai-synthesis/failures
  // --------------------------------------------------------------------------

  @Get('failures')
  async getFailures(
    @Query('cursor') cursor: string | undefined,
    @Query('limit')  limitStr: string | undefined,
    @Req() req: Request,
  ): Promise<{ data: FailuresResponse; traceId: string }> {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const { tenantId } = getPrincipalContext();

    const limit = this.parseLimit(limitStr);

    // Decode cursor: base64(JSON { updatedAt: ISO, id: uuid })
    let cursorUpdatedAt: Date | null = null;
    let cursorId: string | null = null;
    if (cursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(cursor, 'base64').toString('utf8'),
        ) as { updatedAt: string; id: string };
        cursorUpdatedAt = new Date(decoded.updatedAt);
        cursorId = decoded.id;
      } catch {
        throw new BadRequestException({
          error: { code: 'INVALID_CURSOR', message: 'cursor is malformed', details: [], traceId },
        });
      }
    }

    // Build WHERE clause: tenant + failed status + keyset cursor
    const baseCondition = and(
      eq(ticketAiSummaries.tenantId, tenantId),
      eq(ticketAiSummaries.aiStatus, 'failed'),
    );

    const rows = await (cursorUpdatedAt && cursorId
      ? this.tx
          .select({
            ticketId:      ticketAiSummaries.ticketId,
            aiStatus:      ticketAiSummaries.aiStatus,
            attemptCount:  ticketAiSummaries.attemptCount,
            lastErrorCode: ticketAiSummaries.lastErrorCode,
            updatedAt:     ticketAiSummaries.updatedAt,
            id:            ticketAiSummaries.id,
          })
          .from(ticketAiSummaries)
          .where(
            and(
              baseCondition,
              or(
                lt(ticketAiSummaries.updatedAt, cursorUpdatedAt),
                and(
                  sql`${ticketAiSummaries.updatedAt} = ${cursorUpdatedAt}`,
                  lt(ticketAiSummaries.id, cursorId),
                ),
              ),
            ),
          )
          .orderBy(
            sql`${ticketAiSummaries.updatedAt} DESC, ${ticketAiSummaries.id} DESC`,
          )
          .limit(limit + 1)
      : this.tx
          .select({
            ticketId:      ticketAiSummaries.ticketId,
            aiStatus:      ticketAiSummaries.aiStatus,
            attemptCount:  ticketAiSummaries.attemptCount,
            lastErrorCode: ticketAiSummaries.lastErrorCode,
            updatedAt:     ticketAiSummaries.updatedAt,
            id:            ticketAiSummaries.id,
          })
          .from(ticketAiSummaries)
          .where(baseCondition)
          .orderBy(
            sql`${ticketAiSummaries.updatedAt} DESC, ${ticketAiSummaries.id} DESC`,
          )
          .limit(limit + 1));

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const nextCursor = hasMore
      ? Buffer.from(
          JSON.stringify({
            updatedAt: page[page.length - 1]!.updatedAt.toISOString(),
            id:        page[page.length - 1]!.id,
          }),
        ).toString('base64')
      : null;

    const data: FailureRecord[] = page.map((r) => ({
      ticketId:      r.ticketId,
      aiStatus:      r.aiStatus,
      attemptCount:  r.attemptCount,
      lastErrorCode: r.lastErrorCode,
      updatedAt:     r.updatedAt.toISOString(),
    }));

    return { data: { data, nextCursor }, traceId };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private parseLimit(raw: string | undefined): number {
    if (raw === undefined) return DEFAULT_LIMIT;
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 1) return DEFAULT_LIMIT;
    return Math.min(n, MAX_LIMIT);
  }
}
