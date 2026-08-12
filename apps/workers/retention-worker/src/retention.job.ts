/**
 * RetentionJob — WO-085.
 *
 * Nightly purge job invoked by a Kubernetes CronJob. Responsibilities:
 *   1. Acquire a Redis distributed lock (prevents concurrent pod overlap).
 *   2. Create a retention_job_runs row with outcome='running'.
 *   3. For every drop_partition entry: run partition maintenance.
 *   4. For every batch_delete entry: run bounded batch delete.
 *   5. Update the job run row with the final outcome and per-table summary.
 *   6. Release the Redis lock.
 *
 * Memory / latency discipline:
 *   - Never buffers full table contents.
 *   - Each partition drop is isolated in its own DB transaction.
 *   - Each DELETE batch releases locks promptly and yields between iterations.
 *
 * Audit / erasure tables (retention_job_runs, erasure_receipts, audit_logs)
 * are explicitly excluded from the purge to respect their longer retention.
 *
 * Metrics emitted (structured log lines — scraped by the collector):
 *   opsninja_retention_rows_purged_total      { table }
 *   opsninja_retention_partitions_dropped_total { table }
 *   opsninja_retention_job_duration_seconds
 *   opsninja_retention_job_last_success_timestamp
 */

import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';

import {
  getByStrategy,
  runPartitionMaintenance,
  runBatchDelete,
} from '@opsninja/retention';
import {
  retentionJobRuns,
  type NewRetentionJobRun,
  type RetentionJobOutcome,
} from '@opsninja/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JOB_NAME               = 'nightly_retention';
const LOCK_KEY               = 'opsninja:retention:lock';
const LOCK_TTL_MS            = 4 * 60 * 60 * 1000; // 4 hours
const LOCK_TTL_S             = Math.floor(LOCK_TTL_MS / 1000);

// Tables that must never be purged by this job.
const EXCLUDED_TABLES = new Set([
  'retention_job_runs',
  'erasure_receipts',
  'audit_logs',
]);

/** Per-table summary entry stored in retention_job_runs.summary JSON. */
interface TableSummary {
  table:              string;
  strategy:           string;
  rowsPurged:         number;
  partitionsDropped:  number;
  partitionsSkipped:  number;
  partitionsCreated:  number;
  durationMs:         number;
  error?:             string;
}

@Injectable()
export class RetentionJob {
  private readonly logger = new Logger(RetentionJob.name);
  private readonly db;

  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
  ) {
    this.db = drizzle(pool);
  }

  // --------------------------------------------------------------------------
  // Public entry point
  // --------------------------------------------------------------------------

  async run(): Promise<void> {
    // ── 1. Acquire distributed lock ──────────────────────────────────────────
    const lockValue = `${process.env['HOSTNAME'] ?? 'worker'}-${Date.now()}`;
    const acquired  = await this.redis.set(
      LOCK_KEY,
      lockValue,
      'EX', LOCK_TTL_S,
      'NX',
    );

    if (!acquired) {
      this.logger.warn('[retention] lock already held — another pod is running, exiting');
      return;
    }

    this.logger.log('[retention] lock acquired, starting job');

    // ── 2. Record job start ───────────────────────────────────────────────────
    const [runRow] = await this.db
      .insert(retentionJobRuns)
      .values({
        jobName:  JOB_NAME,
        outcome:  'running',
        summary:  [],
      } as NewRetentionJobRun)
      .returning();

    const runId    = runRow!.id;
    const startedAt = Date.now();
    const tableSummaries: TableSummary[] = [];
    let outcome: RetentionJobOutcome = 'success';

    try {
      // ── 3. Partition drop strategy ─────────────────────────────────────────
      const partitionEntries = getByStrategy('drop_partition').filter(
        (e) => !EXCLUDED_TABLES.has(e.table),
      );

      for (const entry of partitionEntries) {
        const t0 = Date.now();
        try {
          const result = await runPartitionMaintenance(
            this.pool,
            entry.table,
            entry.horizonDays!,
          );

          tableSummaries.push({
            table:             entry.table,
            strategy:          'drop_partition',
            rowsPurged:        0,
            partitionsDropped: result.partitionsDropped,
            partitionsSkipped: result.partitionsSkipped,
            partitionsCreated: result.partitionsCreated,
            durationMs:        Date.now() - t0,
          });

          // Emit structured metrics.
          this.logger.log(`[metric] opsninja_retention_partitions_dropped_total`, {
            table: entry.table,
            count: result.partitionsDropped,
            metric: 'opsninja_retention_partitions_dropped_total',
          });
        } catch (err) {
          const msg = (err as Error).message;
          this.logger.error(`[retention] partition maintenance failed for ${entry.table}`, { error: msg });
          tableSummaries.push({
            table:             entry.table,
            strategy:          'drop_partition',
            rowsPurged:        0,
            partitionsDropped: 0,
            partitionsSkipped: 0,
            partitionsCreated: 0,
            durationMs:        Date.now() - t0,
            error:             msg,
          });
          outcome = 'partial';
        }
      }

      // ── 4. Batch delete strategy ───────────────────────────────────────────
      const batchEntries = getByStrategy('batch_delete').filter(
        (e) => !EXCLUDED_TABLES.has(e.table),
      );

      for (const entry of batchEntries) {
        const t0 = Date.now();
        try {
          const result = await runBatchDelete(this.pool, {
            tableName:        entry.table,
            timestampColumn:  'created_at',
            horizonDays:      entry.horizonDays!,
          });

          tableSummaries.push({
            table:             entry.table,
            strategy:          'batch_delete',
            rowsPurged:        result.rowsDeleted,
            partitionsDropped: 0,
            partitionsSkipped: 0,
            partitionsCreated: 0,
            durationMs:        Date.now() - t0,
          });

          this.logger.log(`[metric] opsninja_retention_rows_purged_total`, {
            table:  entry.table,
            count:  result.rowsDeleted,
            metric: 'opsninja_retention_rows_purged_total',
          });
        } catch (err) {
          const msg = (err as Error).message;
          this.logger.error(`[retention] batch delete failed for ${entry.table}`, { error: msg });
          tableSummaries.push({
            table:             entry.table,
            strategy:          'batch_delete',
            rowsPurged:        0,
            partitionsDropped: 0,
            partitionsSkipped: 0,
            partitionsCreated: 0,
            durationMs:        Date.now() - t0,
            error:             msg,
          });
          outcome = 'partial';
        }
      }
    } catch (fatalErr) {
      outcome = 'failure';
      this.logger.error('[retention] fatal job error', {
        error: (fatalErr as Error).message,
        metric: 'opsninja_retention_job_failures_total',
      });
    } finally {
      // ── 5. Update job run record ─────────────────────────────────────────
      const durationMs = Date.now() - startedAt;
      await this.db
        .update(retentionJobRuns)
        .set({
          finishedAt: new Date(),
          outcome,
          summary:    tableSummaries,
        })
        .where(eq(retentionJobRuns.id, runId));

      // Emit duration and last-success metrics.
      this.logger.log('[metric] opsninja_retention_job_duration_seconds', {
        durationMs,
        metric: 'opsninja_retention_job_duration_seconds',
      });

      if (outcome === 'success') {
        this.logger.log('[metric] opsninja_retention_job_last_success_timestamp', {
          timestamp: Math.floor(Date.now() / 1000),
          metric:    'opsninja_retention_job_last_success_timestamp',
        });
      }

      // ── 6. Release lock ──────────────────────────────────────────────────
      // Only release if we still own the lock (value check prevents accidental release).
      const current = await this.redis.get(LOCK_KEY);
      if (current === lockValue) {
        await this.redis.del(LOCK_KEY);
      }

      this.logger.log(
        `[retention] job finished: outcome=${outcome} tables=${tableSummaries.length} durationMs=${durationMs}`,
      );
    }
  }
}
