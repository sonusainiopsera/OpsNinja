/**
 * CsatEraser — WO-085 SubjectDataEraser contributor.
 *
 * Enumerates and tombstones PII in the csat_surveys table for a given
 * data-erasure subject (identified by contact_id).
 *
 * Tombstone strategy:
 *   - comment    → '[erased]' (free-text PII; null becomes '[erased]' as well
 *                   so the receipt is complete even for null-comment rows)
 *   - contact_id → NULL (severs the linkage to the contact record)
 *
 * Fields preserved (aggregate-safe):
 *   - score, responded_at, created_at, response_source, status indicators
 *   - Preserving score keeps CSAT average, response rate and distribution
 *     metrics accurate after erasure, satisfying AC6.
 *
 * Security invariants:
 *   - Free-text comment bodies must never appear in logs or traces.
 *   - Tombstone writes use parameterised SQL (no string interpolation of values).
 *   - rows_affected returned for the erasure receipt; row content is never returned.
 */

import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { TxHandle } from '@opsninja/db';
import type { ErasureReceiptEntry } from '@opsninja/db';

export const CSAT_TOMBSTONE_COMMENT = '[erased]';

export interface CsatErasureSubject {
  tenantId:  string;
  contactId: string;
}

@Injectable()
export class CsatEraser {
  private readonly logger = new Logger(CsatEraser.name);

  /**
   * Enumerate CSAT rows for the subject — returns count only.
   */
  async enumerate(
    tx: TxHandle,
    subject: CsatErasureSubject,
  ): Promise<{ csatSurveys: number }> {
    const { tenantId, contactId } = subject;

    const result = await tx.execute<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM csat_surveys
      WHERE tenant_id  = ${tenantId}::uuid
        AND contact_id = ${contactId}::uuid
    `);

    const rows = Array.isArray(result) ? result : (result as { rows?: { count: string }[] }).rows ?? [];
    return { csatSurveys: parseInt(rows[0]?.count ?? '0', 10) };
  }

  /**
   * Tombstone PII fields for the subject.
   *
   * Note: rows where comment IS NULL are also updated so that contact_id is
   * severed and the receipt entry is complete.  A null comment becomes '[erased]'
   * to signal the erasure was applied (CSAT comment is a PII field even when null).
   */
  async erase(
    tx: TxHandle,
    subject: CsatErasureSubject,
  ): Promise<ErasureReceiptEntry> {
    const { tenantId, contactId } = subject;

    const result = await tx.execute<{ id: string }>(sql`
      UPDATE csat_surveys
      SET
        comment    = ${CSAT_TOMBSTONE_COMMENT},
        contact_id = NULL
      WHERE tenant_id  = ${tenantId}::uuid
        AND contact_id = ${contactId}::uuid
      RETURNING id
    `);

    const rows = Array.isArray(result) ? result : (result as { rows?: { id: string }[] }).rows ?? [];
    const rowsAffected = rows.length;

    // Never log comment text — log count only.
    this.logger.log('[privacy] csat.eraser: tombstoned', {
      tenantId,
      rowsAffected,
    });

    return {
      table:        'csat_surveys',
      rowsAffected,
      strategy:     'tombstone',
    };
  }
}
