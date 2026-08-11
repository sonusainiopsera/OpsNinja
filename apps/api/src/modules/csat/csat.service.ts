/**
 * CsatService – handles CSAT survey response submission.
 *
 * Submit logic uses a single conditional UPDATE ... WHERE responded_at IS NULL
 * RETURNING id to guarantee single-use atomically.  Zero returned rows means
 * the survey was already responded to; mapped to 409.
 *
 * This service does NOT use TenantRepository or RequestContextStore because
 * CSAT endpoints are unauthenticated (@NoTenantContext) — it opens its own
 * tenant-bound transaction using the survey row's tenant_id.
 */

import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { csatSurveys, type CsatSurvey, type DB } from '@opsninja/db';
import type { SubmitCsatDto } from './dto/submit-csat.dto';
import { ErrorCode } from '../../common/errors/app-errors';
import { DB_TOKEN } from '../../data/db.module';
import { CsatTokenService } from './csat-token.service';

export interface CsatSurveyView {
  ticketId: string;
  organizationName: string;
  scale: { min: number; max: number };
  alreadyResponded: boolean;
  preselectedScore?: number;
}

@Injectable()
export class CsatService {
  private readonly logger = new Logger(CsatService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: DB,
    private readonly tokenService: CsatTokenService,
  ) {}

  /**
   * Returns the allow-listed survey view projection for GET /api/v1/csat/{token}.
   * Never discloses raw ticket data beyond the allow-listed fields.
   */
  async getSurveyView(survey: CsatSurvey, preselectedScore?: number): Promise<CsatSurveyView> {
    return {
      ticketId: survey.ticketId,
      organizationName: '',
      scale: { min: 1, max: 5 },
      alreadyResponded: survey.respondedAt !== null,
      ...(preselectedScore !== undefined ? { preselectedScore } : {}),
    };
  }

  /**
   * Submits a CSAT response atomically.
   *
   * Uses a conditional UPDATE ... WHERE responded_at IS NULL RETURNING id so
   * that concurrent double-submits result in exactly one success and one 409.
   */
  async submit(survey: CsatSurvey, dto: SubmitCsatDto, source: 'one_click' | 'form'): Promise<void> {
    if (survey.respondedAt !== null) {
      throw new ConflictException({
        code: ErrorCode.CSAT_ALREADY_RESPONDED,
        message: 'This survey has already been completed.',
      });
    }

    if (this.tokenService.isExpired(survey.expiresAt)) {
      throw new GoneException({
        code: ErrorCode.CSAT_TOKEN_EXPIRED,
        message: 'This survey link has expired.',
      });
    }

    const { tenantId, id } = survey;

    const updated = await this.db.transaction(async (tx) => {
      // Bind tenant context for the transaction (PgBouncer-safe: local=true)
      await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);

      return tx
        .update(csatSurveys)
        .set({
          score: dto.score as unknown as number,
          comment: dto.comment ?? null,
          responseSource: source,
          respondedAt: new Date(),
        })
        .where(
          and(
            eq(csatSurveys.tenantId, tenantId),
            eq(csatSurveys.id, id),
            isNull(csatSurveys.respondedAt),
          ),
        )
        .returning({ id: csatSurveys.id });
    });

    if (updated.length === 0) {
      // Race condition: another request responded simultaneously
      throw new ConflictException({
        code: ErrorCode.CSAT_ALREADY_RESPONDED,
        message: 'This survey has already been completed.',
      });
    }

    this.logger.log('CSAT response recorded', {
      tenantId,
      surveyId: id,
      score: dto.score,
      source,
    });
  }
}
