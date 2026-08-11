/**
 * DataSubjectErasureService — GDPR Article 17 "right to erasure" orchestrator.
 *
 * When a data subject (customer contact or portal user) requests erasure, this
 * service:
 *   1. Resolves the set of ticket IDs owned by that subject.
 *   2. Enumerates all derived-data rows (AI summaries, affected areas) linked
 *      to those tickets.
 *   3. Physically deletes the derived rows.
 *   4. Returns an erasure receipt for the audit log.
 *
 * This service intentionally does NOT delete the parent ticket or audit rows —
 * those are handled by the retention purge job after the configured horizon.
 * Erasure only removes the data subject's directly attributable content.
 *
 * Dependencies are injected so the service is unit-testable without a live DB.
 */

import {
  deleteAiDataForTickets,
  enumerateSummaryIdsForTickets,
  enumerateAffectedAreaIdsForTickets,
  type AiSynthesisDb,
} from '@opsninja/db/repositories/ai-synthesis.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErasureSubject {
  tenantId: string;
  ticketIds: readonly string[];
}

export interface ErasureReceipt {
  tenantId: string;
  ticketIds: readonly string[];
  aiSummaryIdsErased: readonly string[];
  aiAffectedAreaIdsErased: readonly string[];
  erasedAt: Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DataSubjectErasureService {
  constructor(private readonly db: AiSynthesisDb) {}

  /**
   * Enumerates derived-data rows for the given subject without deleting them.
   * Useful for dry-run / audit preview.
   */
  async enumerate(subject: ErasureSubject): Promise<{
    summaryIds: readonly string[];
    affectedAreaIds: readonly string[];
  }> {
    const [summaryIds, affectedAreaIds] = await Promise.all([
      enumerateSummaryIdsForTickets(this.db, subject.tenantId, subject.ticketIds),
      enumerateAffectedAreaIdsForTickets(this.db, subject.tenantId, subject.ticketIds),
    ]);
    return { summaryIds, affectedAreaIds };
  }

  /**
   * Physically deletes all AI-synthesis derived data for the subject's tickets.
   * Returns a receipt for the audit log.
   */
  async erase(subject: ErasureSubject): Promise<ErasureReceipt> {
    // Enumerate before delete so the receipt is accurate even if some rows
    // were already absent (idempotent erasure).
    const { summaryIds, affectedAreaIds } = await this.enumerate(subject);

    await deleteAiDataForTickets(this.db, subject.tenantId, subject.ticketIds);

    return {
      tenantId: subject.tenantId,
      ticketIds: subject.ticketIds,
      aiSummaryIdsErased: summaryIds,
      aiAffectedAreaIdsErased: affectedAreaIds,
      erasedAt: new Date(),
    };
  }
}
