/**
 * ReconciliationJob — WO-064 AC-5.
 *
 * Scheduled task that finds ticket_ai_summaries rows stuck in 'running' or
 * 'pending' beyond configurable thresholds and either re-enqueues them for
 * synthesis or marks them as terminally failed when the attempt cap is reached.
 *
 * Thresholds (configurable via env):
 *   AI_RECON_RUNNING_STALE_MINUTES  — default 15. Rows stuck in 'running'
 *     older than this are assumed to have been abandoned by a crashed worker.
 *   AI_RECON_PENDING_STALE_MINUTES  — default 30. Rows in 'pending' for a
 *     resolved ticket older than this were never picked up (e.g. lost message).
 *
 * Safety guarantees:
 *   - Uses SELECT ... FOR UPDATE SKIP LOCKED LIMIT 200 so concurrent redelivery
 *     and the reconciliation job cannot claim the same row simultaneously.
 *   - The partial index ticket_ai_summaries_stale_idx keeps the scan O(stuck).
 *   - Re-enqueue writes a new outbox event so existing messages left on the SQS
 *     queue are deduplicated by the idempotency guard in SynthesisService.
 *   - Only ticket-AI columns are mutated; ticket status and SLA state are
 *     never touched (AC constraint from WO-064).
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { MAX_ATTEMPTS } from './synthesis.service';
import { emitStuckTotalMetric } from './metrics';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RUNNING_STALE_MINUTES =
  parseInt(process.env['AI_RECON_RUNNING_STALE_MINUTES'] ?? '15', 10);
const PENDING_STALE_MINUTES =
  parseInt(process.env['AI_RECON_PENDING_STALE_MINUTES'] ?? '30', 10);
const SCAN_LIMIT = 200;
const SCHEDULE_MS =
  parseInt(process.env['AI_RECON_INTERVAL_MS'] ?? String(5 * 60 * 1000), 10); // 5 min default

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

interface StaleRow {
  id: string;
  tenant_id: string;
  ticket_id: string;
  ai_status: string;
  attempt_count: number;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

@Injectable()
export class ReconciliationJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationJob.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly pool: Pool) {}

  onModuleInit(): void {
    this.schedule();
  }

  onModuleDestroy(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    this.timer = setTimeout(async () => {
      if (!this.running) return;
      await this.run().catch((err: unknown) =>
        this.logger.error('Reconciliation run failed', { error: (err as Error).message }),
      );
      if (this.running) this.schedule();
    }, SCHEDULE_MS);
    this.running = true;
  }

  /**
   * Public entry point so tests can invoke directly without the scheduler.
   */
  async run(): Promise<{ requeued: number; failed: number; skipped: number }> {
    const stats = { requeued: 0, failed: 0, skipped: 0 };
    const client = await this.pool.connect();

    try {
      // Gather stale rows across all tenants in a single locked scan.
      // SKIP LOCKED ensures we don't contend with live workers processing the
      // same rows. The partial index ticket_ai_summaries_stale_idx
      // (ai_status IN ('pending','running')) keeps this scan fast.
      await client.query('BEGIN');

      const staleRes = await client.query<StaleRow>(
        `SELECT id, tenant_id, ticket_id, ai_status, attempt_count, updated_at
         FROM ticket_ai_summaries
         WHERE (
           (ai_status = 'running'  AND updated_at < now() - ($1 || ' minutes')::interval)
           OR
           (ai_status = 'pending'  AND updated_at < now() - ($2 || ' minutes')::interval)
         )
         ORDER BY updated_at ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED`,
        [RUNNING_STALE_MINUTES, PENDING_STALE_MINUTES, SCAN_LIMIT],
      );

      const rows = staleRes.rows;
      emitStuckTotalMetric(rows.length);

      this.logger.log('Reconciliation scan', {
        staleCount: rows.length,
        runningStaleMinutes: RUNNING_STALE_MINUTES,
        pendingStaleMinutes: PENDING_STALE_MINUTES,
      });

      for (const row of rows) {
        if (row.attempt_count >= MAX_ATTEMPTS) {
          // At cap — mark terminal failure
          await client.query(
            `UPDATE ticket_ai_summaries
             SET ai_status       = 'failed',
                 last_error_code = 'RECONCILIATION_CAP_REACHED',
                 updated_at      = now()
             WHERE id = $1`,
            [row.id],
          );

          // Emit ai.synthesis.failed outbox event
          await client.query(
            `INSERT INTO outbox_events
               (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
             VALUES ($1, $2, 'ticket', $3, 'ai.synthesis.failed', $4, 'pending', now())`,
            [
              randomUUID(), row.tenant_id, row.ticket_id,
              JSON.stringify({
                eventType:     'ai.synthesis.failed',
                tenantId:      row.tenant_id,
                ticketId:      row.ticket_id,
                attemptCount:  row.attempt_count,
                lastErrorCode: 'RECONCILIATION_CAP_REACHED',
                source:        'reconciliation_job',
              }),
            ],
          );

          this.logger.warn('Reconciliation: capped row marked failed', {
            tenantId:     row.tenant_id,
            ticketId:     row.ticket_id,
            attemptCount: row.attempt_count,
          });
          stats.failed++;
        } else {
          // Under cap — re-enqueue by resetting to pending + publishing outbox event.
          // The new eventId ensures the idempotency guard lets the message through.
          await client.query(
            `UPDATE ticket_ai_summaries
             SET ai_status  = 'pending',
                 updated_at = now()
             WHERE id = $1`,
            [row.id],
          );

          await client.query(
            `INSERT INTO outbox_events
               (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
             VALUES ($1, $2, 'ticket', $3, 'ticket.resolved', $4, 'pending', now())`,
            [
              randomUUID(), row.tenant_id, row.ticket_id,
              JSON.stringify({
                eventType:   'ticket.resolved',
                eventId:     randomUUID(),
                tenantId:    row.tenant_id,
                ticketId:    row.ticket_id,
                occurredAt:  new Date().toISOString(),
                source:      'reconciliation_job',
              }),
            ],
          );

          this.logger.log('Reconciliation: stale row re-enqueued', {
            tenantId:     row.tenant_id,
            ticketId:     row.ticket_id,
            attemptCount: row.attempt_count,
            priorStatus:  row.ai_status,
          });
          stats.requeued++;
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error('Reconciliation transaction failed', {
        error: (err as Error).message,
      });
    } finally {
      client.release();
    }

    this.logger.log('Reconciliation run complete', stats);
    return stats;
  }
}
