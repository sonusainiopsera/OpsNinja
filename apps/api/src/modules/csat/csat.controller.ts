/**
 * CsatController – unauthenticated CSAT survey response endpoints.
 *
 * All routes are @NoTenantContext (no JWT session required) and use the
 * CsatTokenGuard as the credential mechanism instead.
 *
 * GET  /api/v1/csat/:token         — return survey metadata (no session)
 * POST /api/v1/csat/:token         — submit score + optional comment
 * GET  /api/v1/reporting/csat/summary — aggregated KPI (requires auth role)
 */

import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ZodError } from 'zod';
import type { Request } from 'express';
import { CsatService } from './csat.service';
import { CsatAggregationService } from './csat-aggregation.service';
import { CsatTokenGuard, CSAT_SURVEY_KEY } from './csat-token.guard';
import { SubmitCsatSchema } from './dto/submit-csat.dto';
import type { CsatSurvey } from '@opsninja/db';
import { RequestContextStore } from '../../observability/request-context';
import { NoTenantContext } from '../../common/tenant/no-tenant-context.decorator';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { Permission } from '../../common/auth/permissions';
import { ErrorCode } from '../../common/errors/app-errors';

function parseBody<T>(schema: { parse(v: unknown): T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new UnprocessableEntityException({
        code: 'SCHEMA_VIOLATION',
        message: 'Request body did not match the expected schema.',
        details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      });
    }
    throw err;
  }
}

@Controller()
export class CsatController {
  constructor(
    private readonly csatService: CsatService,
    private readonly aggregationService: CsatAggregationService,
  ) {}

  /**
   * GET /api/v1/csat/:token
   *
   * Returns allow-listed survey metadata for a valid, unexpired token.
   * A ?score=N query param pre-selects a score in the response without recording it.
   * Returns 404 for unknown tokens, 410 for expired/consumed tokens.
   */
  @NoTenantContext()
  @UseGuards(CsatTokenGuard)
  @Get('api/v1/csat/:token')
  async getSurvey(
    @Req() req: Request & { [CSAT_SURVEY_KEY]?: CsatSurvey },
    @Param('token') _token: string,
    @Query('score') scoreParam?: string,
  ) {
    const survey = req[CSAT_SURVEY_KEY]!;

    const preselectedScore =
      scoreParam !== undefined ? parseInt(scoreParam, 10) : undefined;

    const validPreselected =
      preselectedScore !== undefined && preselectedScore >= 1 && preselectedScore <= 5
        ? preselectedScore
        : undefined;

    const view = await this.csatService.getSurveyView(survey, validPreselected);
    return { data: view };
  }

  /**
   * POST /api/v1/csat/:token
   *
   * Submits a CSAT score (1–5) and optional comment.  Single-use enforced by
   * a conditional UPDATE ... WHERE responded_at IS NULL.
   * Returns 409 if already responded, 410 if expired.
   */
  @NoTenantContext()
  @UseGuards(CsatTokenGuard)
  @Post('api/v1/csat/:token')
  @HttpCode(HttpStatus.OK)
  async submitSurvey(
    @Req() req: Request & { [CSAT_SURVEY_KEY]?: CsatSurvey },
    @Param('token') _token: string,
    @Body() rawBody: unknown,
  ) {
    const survey = req[CSAT_SURVEY_KEY]!;

    if (survey.respondedAt !== null) {
      throw new ConflictException({
        code: ErrorCode.CSAT_ALREADY_RESPONDED,
        message: 'This survey has already been completed.',
      });
    }

    const dto = parseBody(SubmitCsatSchema, rawBody);
    await this.csatService.submit(survey, dto, 'form');
    return { data: { recorded: true } };
  }

  /**
   * GET /api/v1/reporting/csat/summary
   *
   * Returns aggregated CSAT KPI for a tenant+date range.
   * Requires Lead or Manager role (TICKETS_READ permission sufficient).
   */
  @RequirePermission(Permission.TICKETS_READ)
  @Get('api/v1/reporting/csat/summary')
  async getCsatSummary(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('organizationId') organizationId?: string,
  ) {
    const { tenantId } = RequestContextStore.getPrincipal();

    const fromDate = new Date(from);
    const toDate = new Date(to);

    const result = await this.aggregationService.getSummary(
      tenantId,
      fromDate,
      toDate,
      organizationId,
    );
    return { data: result };
  }
}
