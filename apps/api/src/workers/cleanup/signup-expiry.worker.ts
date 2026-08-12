/**
 * signup-expiry.worker.ts — scheduled expiry and physical deletion of stale
 * portal signup requests (WO-091, AC9).
 *
 * Two-pass retention policy:
 *   Pass 1 (mark expired):  pending_admin_approval rows older than 30 days
 *                           → status = 'expired'
 *   Pass 2 (hard delete):   expired rows older than 7 additional days
 *                           → DELETE portal_signup_requests + cascade tokens
 *
 * Metrics emitted as structured log lines (consumed by OTel log-to-metric pipeline):
 *   portal_signup_expiry_marked_total   — rows marked expired this run
 *   portal_signup_expiry_deleted_total  — rows physically deleted this run
 *   portal_signup_expiry_last_success   — epoch timestamp of last successful run
 *   portal_signup_queue_depth           — current pending_admin_approval count
 *   portal_signup_oldest_age_seconds    — age of the oldest pending request
 *
 * Alert thresholds (monitored externally):
 *   queue_depth > 25   → warn: queue is accumulating
 *   oldest_age > 72 h  → warn: requests going stale without review
 *
 * The worker is designed to be called from a NestJS ScheduleModule cron or
 * an external cron (e.g. Kubernetes CronJob hitting a /trigger endpoint).
 * It is idempotent and safe to run concurrently — Postgres advisory locks
 * are not required because each UPDATE uses a WHERE clause limiting scope.
 */

import { Injectable, Logger } from '@nestjs/common';
import { pool } from '@opsninja/db';

const EXPIRY_AFTER_DAYS = 30;
const DELETE_AFTER_DAYS = 7; // after marking expired
const QUEUE_DEPTH_WARN_THRESHOLD = 25;
const OLDEST_AGE_WARN_THRESHOLD_SECONDS = 72 * 3600;

export interface ExpiryRunResult {
  markedExpired: number;
  hardDeleted: number;
  queueDepth: number;
  oldestAgeSeconds: number;
  ranAt: string;
}

@Injectable()
export class SignupExpiryWorker {
  private readonly logger = new Logger(SignupExpiryWorker.name);

  /**
   * Run the two-pass expiry job.
   *
   * Safe to call repeatedly — each pass is idempotent with respect to already-
   * processed rows.
   */
  async run(): Promise<ExpiryRunResult> {
    const client = await pool.connect();
    const ranAt = new Date().toISOString();

    try {
      // Bootstrap bypass: expiry worker reads across all tenants
      await client.query("SELECT set_config('app.portal_signup_bootstrap', 'true', true)");

      // -----------------------------------------------------------------
      // Pass 1: mark pending requests older than EXPIRY_AFTER_DAYS as expired
      // -----------------------------------------------------------------
      const markResult = await client.query<{ count: string }>(
        `WITH marked AS (
           UPDATE portal_signup_requests
           SET status     = 'expired',
               updated_at = now()
           WHERE status = 'pending_admin_approval'
             AND created_at < now() - interval '${EXPIRY_AFTER_DAYS} days'
           RETURNING id
         )
         SELECT count(*) AS count FROM marked`,
      );
      const markedExpired = parseInt(markResult.rows[0]?.count ?? '0', 10);

      // -----------------------------------------------------------------
      // Pass 2: physically delete expired rows + their verification tokens
      //         if they have been expired for at least DELETE_AFTER_DAYS
      // -----------------------------------------------------------------
      const deleteTokensResult = await client.query<{ count: string }>(
        `WITH deleted_signups AS (
           DELETE FROM portal_signup_requests
           WHERE status = 'expired'
             AND updated_at < now() - interval '${DELETE_AFTER_DAYS} days'
           RETURNING id
         ),
         deleted_tokens AS (
           DELETE FROM portal_verification_tokens pvt
           USING deleted_signups ds
           WHERE pvt.signup_request_id = ds.id
           RETURNING pvt.token_id
         )
         SELECT count(*) AS count FROM deleted_signups`,
      );
      const hardDeleted = parseInt(deleteTokensResult.rows[0]?.count ?? '0', 10);

      // -----------------------------------------------------------------
      // Queue-depth and oldest-age gauges
      // -----------------------------------------------------------------
      const gaugeResult = await client.query<{
        depth: string;
        oldest_age_seconds: number | null;
      }>(
        `SELECT
           count(*)::text AS depth,
           EXTRACT(EPOCH FROM (now() - min(created_at))) AS oldest_age_seconds
         FROM portal_signup_requests
         WHERE status = 'pending_admin_approval'`,
      );
      const queueDepth = parseInt(gaugeResult.rows[0]?.depth ?? '0', 10);
      const oldestAgeSeconds = gaugeResult.rows[0]?.oldest_age_seconds ?? 0;

      // -----------------------------------------------------------------
      // Emit structured metrics
      // -----------------------------------------------------------------
      this.emitMetric('portal_signup_expiry_marked_total', markedExpired);
      this.emitMetric('portal_signup_expiry_deleted_total', hardDeleted);
      this.emitMetric('portal_signup_expiry_last_success', Math.floor(Date.now() / 1000));
      this.emitMetric('portal_signup_queue_depth', queueDepth);
      this.emitMetric('portal_signup_oldest_age_seconds', Math.round(oldestAgeSeconds));

      // -----------------------------------------------------------------
      // Alert-threshold logging
      // -----------------------------------------------------------------
      if (queueDepth > QUEUE_DEPTH_WARN_THRESHOLD) {
        this.logger.warn('[signup-expiry] Queue depth exceeds threshold — operator review needed', {
          queueDepth,
          threshold: QUEUE_DEPTH_WARN_THRESHOLD,
        });
      }

      if (oldestAgeSeconds > OLDEST_AGE_WARN_THRESHOLD_SECONDS) {
        this.logger.warn('[signup-expiry] Oldest pending request exceeds age threshold', {
          oldestAgeSeconds: Math.round(oldestAgeSeconds),
          thresholdHours: OLDEST_AGE_WARN_THRESHOLD_SECONDS / 3600,
        });
      }

      this.logger.log('[signup-expiry] Run complete', {
        markedExpired,
        hardDeleted,
        queueDepth,
        oldestAgeSeconds: Math.round(oldestAgeSeconds),
        ranAt,
      });

      return { markedExpired, hardDeleted, queueDepth, oldestAgeSeconds, ranAt };
    } finally {
      client.release();
    }
  }

  private emitMetric(name: string, value: number): void {
    this.logger.log(`[metric] ${name}`, { metric: name, value });
  }
}
