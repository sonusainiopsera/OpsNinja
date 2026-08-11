/**
 * CsatController
 *
 * Unauthenticated (by session) endpoints for CSAT survey response.
 * Token is the only credential — resolved by CsatTokenGuard.
 *
 * GET /api/v1/csat/:token
 *   Returns survey display data for the respondent.
 *   ?score=N pre-selects a score in the response (for one-click links)
 *   but does NOT record it — the respondent must still POST.
 *
 * POST /api/v1/csat/:token
 *   Records the response atomically (single-use conditional UPDATE).
 *
 * GET /api/v1/reporting/csat/summary (authenticated, Lead/Manager)
 *   Returns CSAT aggregation from the read replica.
 *
 * Disclosure invariant: only ticketReference, ticketSubject, organizationName
 * are returned for valid tokens. No internal IDs, agent names, or ticket details.
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UsePipes,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { sql } from 'drizzle-orm';

import { Public } from '../../common/auth/public.decorator';
import { NoTenantContext } from '../../common/tenant/no-tenant-context.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { withTenantTransaction } from '../../data/unit-of-work';
import { getPrincipalContext } from '../../observability/request-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';

import { CsatTokenGuard } from './csat-token.guard';
import { CsatService } from './csat.service';
import { CsatAggregationService } from './csat-aggregation.service';
import { SubmitCsatSchema, type SubmitCsatDto } from './dto/submit-csat.dto';
import type { CsatResolvedToken } from '@opsninja/db';
import type { PrincipalContext } from '../../observability/request-context';

type CsatRequest = Request & { csatResolved: CsatResolvedToken };

@Controller()
export class CsatController {
  constructor(
    private readonly csatService: CsatService,
    private readonly aggregationService: CsatAggregationService,
  ) {}

  // ── Public unauthenticated endpoints ──────────────────────────────────────

  @Get('api/v1/csat/:token')
  @Public()
  @NoTenantContext()
  @UseGuards(CsatTokenGuard)
  async getSurvey(
    @Req() req: CsatRequest,
    @Query('score') scoreParam?: string,
  ) {
    const { survey, rawTokenHash } = req.csatResolved;
    const principal = this.buildSyntheticPrincipal(survey.tenantId, req);

    const displayData = await withTenantTransaction(principal, async (tx) => {
      // Fetch display-safe fields for the ticket and organization.
      const rows = await tx.execute(sql`
        SELECT
          t.id          AS ticket_id,
          t.subject     AS ticket_subject,
          o.name        AS organization_name,
          o.id          AS organization_id
        FROM tickets t
        JOIN organizations o ON o.id = t.organization_id
        WHERE t.id = ${survey.ticketId}::uuid
        LIMIT 1
      `);

      const result = Array.isArray(rows) ? rows[0] : (rows as { rows?: unknown[] }).rows?.[0];
      return result as {
        ticket_id: string;
        ticket_subject: string;
        organization_name: string;
        organization_id: string;
      } | undefined;
    });

    const preselectedScore =
      scoreParam !== undefined ? parseInt(scoreParam, 10) : undefined;
    const validPreselected =
      preselectedScore !== undefined &&
      Number.isInteger(preselectedScore) &&
      preselectedScore >= 1 &&
      preselectedScore <= 5
        ? preselectedScore
        : undefined;

    return {
      data: {
        ticketReference: displayData?.ticket_id ?? survey.ticketId,
        ticketSubject: displayData?.ticket_subject ?? '',
        organizationName: displayData?.organization_name ?? '',
        scale: { min: 1, max: 5 },
        alreadyResponded: survey.respondedAt !== null,
        ...(validPreselected !== undefined ? { preselectedScore: validPreselected } : {}),
      },
    };
  }

  @Post('api/v1/csat/:token')
  @Public()
  @NoTenantContext()
  @UseGuards(CsatTokenGuard)
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(SubmitCsatSchema))
  async submitSurvey(
    @Req() req: CsatRequest,
    @Body() dto: SubmitCsatDto,
    @Param('token') _token: string,
  ) {
    const { survey, rawTokenHash } = req.csatResolved;
    const principal = this.buildSyntheticPrincipal(survey.tenantId, req);

    const result = await withTenantTransaction(principal, async (tx) => {
      return this.csatService.submit(tx, survey.tenantId, rawTokenHash, dto, 'form');
    });

    return { data: result };
  }

  // ── Internal authenticated aggregation endpoint ───────────────────────────

  @Get('api/v1/reporting/csat/summary')
  @RequirePermission('reports:read')
  async getCsatSummary(
    @Query('from') fromStr: string,
    @Query('to') toStr: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const from = new Date(fromStr);
    const to = new Date(toStr);

    const summary = await this.aggregationService.getSummary({
      from,
      to,
      organizationId,
    });

    return { data: summary };
  }

  private buildSyntheticPrincipal(tenantId: string, req: Request): PrincipalContext {
    return {
      tenantId,
      userId: '00000000-0000-0000-0000-000000000000',
      principalKind: 'machine',
      roles: [],
      orgScopeIds: [],
      traceId: (req.headers['x-trace-id'] as string | undefined) ?? 'csat-unknown',
    };
  }
}
