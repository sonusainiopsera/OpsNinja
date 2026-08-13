/**
 * orphan-attachment-reaper.ts — scheduled cleanup worker that physically
 * deletes pending (unfinalized) attachment rows and their S3 objects when
 * they are older than 24 hours (WO-089, AC-10).
 *
 * Orphan attachments arise from three abandonment scenarios:
 *   1. Client called presign but never uploaded the file.
 *   2. Client uploaded the file but never called confirm.
 *   3. The confirm call failed (object or row already deleted, error path).
 *
 * The worker runs hourly as a scheduled task (NestJS @Cron or Kubernetes
 * CronJob). It is idempotent and safe to run concurrently — Postgres queries
 * use a WHERE clause that limits scope to rows older than the threshold, and
 * a DELETE on an already-deleted row is a safe no-op.
 *
 * Metrics emitted as structured log lines (consumed by the OTel log-to-metric
 * pipeline):
 *   portal_orphan_reaper_deleted_total     — rows deleted this run
 *   portal_orphan_reaper_last_success      — Unix epoch of last successful run
 *
 * Alert thresholds (monitored externally):
 *   last_success stale > 2 h   → alert: reaper has stopped running
 *   deleted_total spike > 100  → warn: possible client bug or attack
 */

import { Injectable, Logger, Inject } from '@nestjs/common';

import { pool } from '@opsninja/db';
import {
  OBJECT_STORE_PORT,
  type ObjectStorePort,
} from '../../modules/tickets/attachments/storage/object-store.port';

// Orphan threshold: attachments unfinalized for longer than this are reaped.
const ORPHAN_THRESHOLD_HOURS = 24;
// Process at most this many rows per run to avoid long-running DB transactions.
const BATCH_LIMIT = 100;

export interface ReaperRunResult {
  deletedRows:    number;
  deletedObjects: number;
  failedDeletes:  number;
  ranAt:          string;
}

@Injectable()
export class OrphanAttachmentReaper {
  private readonly logger = new Logger(OrphanAttachmentReaper.name);

  constructor(
    @Inject(OBJECT_STORE_PORT) private readonly objectStore: ObjectStorePort,
  ) {}

  /**
   * Run the orphan reaper.
   *
   * Selects all ticket_attachments rows where:
   *   - is_finalized = false  (presigned but not yet confirmed)
   *   - created_at   < now() - ORPHAN_THRESHOLD_HOURS
   *
   * For each found row:
   *   1. Attempt to delete the S3 object (errors are logged, not rethrown).
   *   2. Delete the database row.
   *
   * Returns a summary of the run with metrics.
   */
  async run(): Promise<ReaperRunResult> {
    const ranAt         = new Date().toISOString();
    let deletedRows     = 0;
    let deletedObjects  = 0;
    let failedDeletes   = 0;

    const thresholdDate = new Date(
      Date.now() - ORPHAN_THRESHOLD_HOURS * 60 * 60 * 1000,
    );

    const client = await pool.connect();

    try {
      // Reaper reads across all tenants — bypass per-tenant RLS
      await client.query(
        "SELECT set_config('app.reaper_bootstrap', 'true', true)",
      );

      // Fetch orphaned rows: unfinalized + older than threshold
      const result = await client.query<{
        id: string;
        tenant_id: string;
        s3_key: string;
      }>(
        `SELECT id, tenant_id, s3_key
         FROM ticket_attachments
         WHERE is_finalized = false
           AND created_at < $1
         LIMIT $2`,
        [thresholdDate, BATCH_LIMIT],
      );

      for (const row of result.rows) {
        // Step 1: attempt S3 object deletion (best-effort; object may not exist
        // if presign was never followed by an upload).
        try {
          await this.objectStore.deleteObject(row.s3_key);
          deletedObjects++;
        } catch (err) {
          failedDeletes++;
          this.logger.warn('[orphan-reaper] Failed to delete S3 object', {
            attachmentId: row.id,
            tenantId:     row.tenant_id,
            error:        (err as Error).message,
          });
        }

        // Step 2: delete the database row regardless of S3 outcome.
        // Use a guard to avoid re-deleting a finalized row that was concurrently
        // confirmed between the SELECT and this DELETE.
        await client.query(
          `DELETE FROM ticket_attachments
           WHERE id = $1
             AND is_finalized = false`,
          [row.id],
        );
        deletedRows++;
      }

      // Emit structured metrics
      this.emitMetric('portal_orphan_reaper_deleted_total', deletedRows);
      this.emitMetric(
        'portal_orphan_reaper_last_success',
        Math.floor(Date.now() / 1000),
      );

      this.logger.log('[orphan-reaper] Run complete', {
        deletedRows,
        deletedObjects,
        failedDeletes,
        thresholdDate: thresholdDate.toISOString(),
        ranAt,
      });

      return { deletedRows, deletedObjects, failedDeletes, ranAt };
    } finally {
      client.release();
    }
  }

  private emitMetric(name: string, value: number): void {
    this.logger.log(`[metric] ${name}`, { metric: name, value });
  }
}
