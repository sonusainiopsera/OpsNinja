/**
 * CsatService
 *
 * Handles survey response submission with single-use enforcement.
 *
 * Single-use invariant:
 *   Conditional UPDATE ... WHERE responded_at IS NULL RETURNING id.
 *   Zero rows returned → already responded → 409 Conflict.
 *   This is atomic: no read-then-write race for concurrent submissions.
 *
 * Comment sanitisation:
 *   Performed by SubmitCsatSchema.transform before this service is called.
 *   Stored as plain text, always rendered escaped.
 */

import { Injectable, ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TxHandle } from '@opsninja/db';

import type { SubmitCsatDto } from './dto/submit-csat.dto';
import type { CsatResponseSource } from '@opsninja/db';

export interface CsatSubmitResult {
  recorded: boolean;
}

@Injectable()
export class CsatService {
  /**
   * Record a CSAT response atomically via a conditional UPDATE.
   *
   * @param tx             - Active tenant-scoped Drizzle transaction handle.
   * @param tenantId       - Tenant owning the survey.
   * @param tokenHash      - SHA-256 hash of the raw token.
   * @param dto            - Validated + sanitised score and optional comment.
   * @param responseSource - 'one_click' | 'form'.
   * @throws ConflictException if the survey was already responded to.
   */
  async submit(
    tx: TxHandle,
    tenantId: string,
    tokenHash: string,
    dto: SubmitCsatDto,
    responseSource: CsatResponseSource = 'form',
  ): Promise<CsatSubmitResult> {
    const result = await tx.execute(sql`
      UPDATE csat_surveys
      SET
        score           = ${dto.score}::smallint,
        comment         = ${dto.comment ?? null},
        responded_at    = now(),
        response_source = ${responseSource}
      WHERE tenant_id    = ${tenantId}::uuid
        AND token_hash   = ${tokenHash}
        AND responded_at IS NULL
      RETURNING id
    `);

    const rows: unknown[] = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];

    if (rows.length === 0) {
      throw new ConflictException({
        error: {
          code: 'CSAT_ALREADY_RESPONDED',
          message: 'Survey has already been completed',
        },
      });
    }

    return { recorded: true };
  }
}
