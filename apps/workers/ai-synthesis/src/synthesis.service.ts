/**
 * SynthesisService — core orchestration for the AI synthesis pipeline.
 *
 * Transaction sequence (AC-4, AC-5, AC-7):
 *   Tx-1: SET LOCAL app.current_tenant
 *         Idempotency guard (INSERT ... ON CONFLICT DO NOTHING)
 *         UPSERT ticket_ai_summaries SET ai_status = 'running',
 *           attempt_count = attempt_count + 1   ← WO-064 attempt counting
 *         SELECT ... FOR UPDATE on the summary row (serialises concurrent redeliveries)
 *         COMMIT
 *
 *   [No open transaction]
 *   Call LlmProvider.synthesise()  ← may take up to 30s, no DB connection held
 *
 *   Tx-2: SET LOCAL app.current_tenant
 *         UPDATE ticket_ai_summaries SET ai_status = 'succeeded', crux_summary, …
 *         DELETE FROM ticket_affected_areas WHERE ticket_id = ?
 *         INSERT INTO ticket_affected_areas (de-duplicated)
 *         INSERT INTO outbox_events (ai.synthesis.completed)
 *         INSERT INTO audit_logs
 *         COMMIT
 *
 *   SQS message deleted only after Tx-2 commits.
 *
 * Attempt cap (WO-064, AC-4):
 *   attempt_count is incremented before every provider call.
 *   When attempt_count reaches MAX_ATTEMPTS (3) and inference fails, the worker
 *   transitions to failed, emits ai.synthesis.failed, and does NOT rethrow —
 *   the SQS message is deleted so it does not flow to the DLQ.
 *
 * AC-10: ticket closure never blocked — the ticket.resolved transition writes
 *        ai_status = 'pending' before the worker ever sees the message. Ticket
 *        resolution is complete regardless of whether this worker is running.
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import {
  LLM_PROVIDER,
  RetryableLlmError,
  NonRetryableLlmError,
  type LlmProviderPort,
} from './llm-provider.port';
import { AI_POLICY, type AiPolicyPort } from './ai-policy.port';
import { ThreadLoader } from './thread-loader';
import { IdempotencyRepository } from './idempotency.repository';
import {
  emitAttemptMetric,
  emitLagMetric,
  type AttemptOutcome,
} from './metrics';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of processing attempts before terminal failure (matches SQS maxReceiveCount). */
export const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// SQS message shape
// ---------------------------------------------------------------------------

export interface SynthesisMessage {
  eventId: string;
  eventType: string;
  tenantId: string;
  ticketId: string;
  occurredAt: string;
  traceparent?: string;
}

export type SynthesisOutcome =
  | 'succeeded'
  | 'skipped'
  | 'idempotent_skip'
  | 'ticket_not_found'
  | 'failed_permanent'
  | 'failed_retryable';

export interface SynthesisHandleResult {
  outcome: SynthesisOutcome;
  /** Set for retryable failures — caller should NOT delete the SQS message. */
  shouldRetry: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class SynthesisService {
  private readonly logger = new Logger(SynthesisService.name);

  constructor(
    private readonly pool: Pool,
    private readonly threadLoader: ThreadLoader,
    private readonly idempotency: IdempotencyRepository,
    @Inject(LLM_PROVIDER) private readonly llmProvider: LlmProviderPort,
    @Inject(AI_POLICY) private readonly aiPolicy: AiPolicyPort,
  ) {}

  async handle(msg: SynthesisMessage): Promise<SynthesisHandleResult> {
    const { tenantId, ticketId, eventId } = msg;
    const start = Date.now();

    // ── Tx-1: idempotency + claim running + increment attempt_count ─────────
    let summaryId: string | null = null;
    let alreadyProcessed = false;
    let attemptCount = 0;

    const client1 = await this.pool.connect();
    try {
      await client1.query('BEGIN');
      await client1.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      const claimed = await this.idempotency.claim(client1, tenantId, eventId);
      if (!claimed) {
        await client1.query('ROLLBACK');
        this.logger.debug('Idempotency skip', { tenantId, ticketId, eventId });
        alreadyProcessed = true;
      } else {
        // AI policy check (short-circuit before upsert)
        const policy = await this.aiPolicy.check(tenantId, ticketId);
        if (policy.decision === 'skip') {
          await this.upsertSummaryStatus(client1, tenantId, ticketId, 'skipped', policy.reason);
          await client1.query('COMMIT');
          this.logger.log('AI policy skip', { tenantId, ticketId, reason: policy.reason });
          emitAttemptMetric({ tenantId, outcome: 'skipped', errorCode: policy.reason }, 0);
          return { outcome: 'skipped', shouldRetry: false };
        }

        // Upsert running + atomically increment attempt_count (WO-064 AC-1)
        const result = await client1.query<{ id: string; attempt_count: number }>(
          `INSERT INTO ticket_ai_summaries
             (tenant_id, ticket_id, ai_status, attempt_count, created_at, updated_at)
           VALUES ($1, $2, 'running', 1, now(), now())
           ON CONFLICT (tenant_id, ticket_id) DO UPDATE
             SET ai_status     = 'running',
                 attempt_count = ticket_ai_summaries.attempt_count + 1,
                 updated_at    = now()
           RETURNING id, attempt_count`,
          [tenantId, ticketId],
        );
        summaryId = result.rows[0]?.id ?? null;
        attemptCount = result.rows[0]?.attempt_count ?? 1;

        this.logger.log('Synthesis attempt started', {
          tenantId, ticketId, attempt: attemptCount,
        });

        // SELECT FOR UPDATE ensures only one concurrent worker proceeds
        if (summaryId) {
          await client1.query(
            `SELECT id FROM ticket_ai_summaries WHERE id = $1 FOR UPDATE`,
            [summaryId],
          );
        }

        await client1.query('COMMIT');
      }
    } catch (err) {
      await client1.query('ROLLBACK').catch(() => undefined);
      client1.release();
      this.logger.error('Tx-1 failed', { tenantId, ticketId, error: (err as Error).message });
      return { outcome: 'failed_retryable', shouldRetry: true };
    } finally {
      client1.release();
    }

    if (alreadyProcessed) {
      return { outcome: 'idempotent_skip', shouldRetry: false };
    }

    // ── Load thread (no open transaction) ──────────────────────────────────
    let request;
    const client2 = await this.pool.connect();
    try {
      await client2.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      request = await this.threadLoader.load(client2, tenantId, ticketId);
    } catch (err) {
      const errMsg = (err as Error).message;
      if (errMsg.includes('not found')) {
        this.logger.warn('Ticket not found — skipping synthesis', { tenantId, ticketId });
        client2.release();
        await this.markFailedPermanent(tenantId, ticketId, 'TICKET_NOT_FOUND', attemptCount, msg.traceparent);
        emitAttemptMetric({ tenantId, outcome: 'ticket_not_found', errorCode: 'TICKET_NOT_FOUND' }, attemptCount);
        return { outcome: 'ticket_not_found', shouldRetry: false };
      }
      client2.release();
      this.logger.error('Thread load failed', { tenantId, ticketId, attempt: attemptCount, error: errMsg });
      emitAttemptMetric({ tenantId, outcome: 'failed_retryable' }, attemptCount);
      return { outcome: 'failed_retryable', shouldRetry: true };
    } finally {
      client2.release();
    }

    // ── LLM call (no open transaction) ────────────────────────────────────
    let result;
    try {
      result = await this.llmProvider.synthesise(request);
    } catch (err) {
      const errorCode =
        err instanceof NonRetryableLlmError ? err.errorCode : 'LLM_RETRYABLE_ERROR';
      const isNonRetryable = err instanceof NonRetryableLlmError;
      const isCapReached = attemptCount >= MAX_ATTEMPTS;

      this.logger.error('LLM error', {
        tenantId, ticketId, attempt: attemptCount, errorCode,
        type: isNonRetryable ? 'non_retryable' : 'retryable',
        capReached: isCapReached,
      });

      if (isNonRetryable || isCapReached) {
        // Terminal failure: write failed state + emit ai.synthesis.failed outbox event
        await this.markFailedPermanent(tenantId, ticketId, errorCode, attemptCount, msg.traceparent);
        emitAttemptMetric(
          { tenantId, outcome: 'failed_permanent', errorCode },
          attemptCount,
        );
        return { outcome: 'failed_permanent', shouldRetry: false };
      }

      // Retryable and under cap — rethrow for SQS redelivery
      emitAttemptMetric({ tenantId, outcome: 'failed_retryable', errorCode }, attemptCount);
      return { outcome: 'failed_retryable', shouldRetry: true };
    }

    // ── Tx-2: writeback ───────────────────────────────────────────────────
    const client3 = await this.pool.connect();
    try {
      await client3.query('BEGIN');
      await client3.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      // Update summary to succeeded
      await client3.query(
        `UPDATE ticket_ai_summaries
         SET ai_status          = 'succeeded',
             crux_summary       = $3,
             resolution_summary = $4,
             model_id           = $5,
             prompt_version     = $6,
             generated_at       = $7,
             truncated          = $8,
             prompt_tokens      = $9,
             completion_tokens  = $10,
             last_error_code    = NULL,
             updated_at         = now()
         WHERE tenant_id = $1 AND ticket_id = $2`,
        [
          tenantId, ticketId,
          result.cruxSummary,
          result.resolutionSummary,
          result.modelId,
          result.promptVersion,
          result.generatedAt,
          request.truncated,
          result.promptTokens,
          result.completionTokens,
        ],
      );

      // Delete-then-insert affected areas (AC-5)
      await client3.query(
        `DELETE FROM ticket_affected_areas WHERE tenant_id = $1 AND ticket_id = $2`,
        [tenantId, ticketId],
      );

      const deduped = this.deduplicateAreas(result.affectedAreas);
      for (const area of deduped) {
        await client3.query(
          `INSERT INTO ticket_affected_areas (tenant_id, ticket_id, summary_id, area_label, confidence)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenantId, ticketId, summaryId, area.areaLabel, area.confidence],
        );
      }

      // Outbox event (ai.synthesis.completed)
      await client3.query(
        `INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
         VALUES ($1, $2, 'ticket', $3, 'ai.synthesis.completed', $4, 'pending', now())`,
        [
          randomUUID(), tenantId, ticketId,
          JSON.stringify({
            tenantId,
            ticketId,
            aiStatus: 'succeeded',
            attemptCount,
            areaCount: deduped.length,
            modelId: result.modelId,
            promptVersion: result.promptVersion,
          }),
        ],
      );

      // Audit record
      await client3.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, actor_kind, event_type, outcome, resource_type, resource_id,
          action, after_state, source, trace_id, created_at)
         VALUES ($1, 'system:ai-synthesis', 'system', 'ai.synthesis.writeback', 'success',
                 'ticket', $2, 'synthesise', $3, 'ai-synthesis-worker', $4, now())`,
        [
          tenantId, ticketId,
          JSON.stringify({
            modelId: result.modelId, promptVersion: result.promptVersion,
            areaCount: deduped.length, attemptCount,
          }),
          msg.traceparent ?? randomUUID(),
        ],
      );

      await client3.query('COMMIT');
    } catch (err) {
      await client3.query('ROLLBACK').catch(() => undefined);
      this.logger.error('Tx-2 writeback failed', {
        tenantId, ticketId, attempt: attemptCount, error: (err as Error).message,
      });
      emitAttemptMetric({ tenantId, outcome: 'failed_retryable' }, attemptCount);
      return { outcome: 'failed_retryable', shouldRetry: true };
    } finally {
      client3.release();
    }

    // ── Post-success ──────────────────────────────────────────────────────
    const durationMs = Date.now() - start;

    emitAttemptMetric({ tenantId, outcome: 'succeeded' }, attemptCount);
    emitLagMetric({
      tenantId,
      resolvedAt:  msg.occurredAt,
      generatedAt: result.generatedAt.toISOString(),
    });

    this.logger.log('Synthesis succeeded', {
      tenantId, ticketId, attempt: attemptCount, durationMs,
      modelId: result.modelId, areaCount: result.affectedAreas.length,
    });

    // Record token usage for AI budget accounting (WO-063)
    void this.aiPolicy.recordUsage(tenantId, {
      inputTokens:  result.promptTokens,
      outputTokens: result.completionTokens,
      modelId:      result.modelId,
    });

    return { outcome: 'succeeded', shouldRetry: false };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private async upsertSummaryStatus(
    client: PoolClient,
    tenantId: string,
    ticketId: string,
    status: string,
    errorCode: string | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO ticket_ai_summaries (tenant_id, ticket_id, ai_status, last_error_code, created_at, updated_at)
       VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (tenant_id, ticket_id) DO UPDATE
         SET ai_status       = EXCLUDED.ai_status,
             last_error_code = EXCLUDED.last_error_code,
             updated_at      = now()`,
      [tenantId, ticketId, status, errorCode],
    );
  }

  async markFailedPermanent(
    tenantId: string,
    ticketId: string,
    errorCode: string,
    attemptCount: number,
    traceId?: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

      // Set terminal failed state
      await client.query(
        `INSERT INTO ticket_ai_summaries
           (tenant_id, ticket_id, ai_status, last_error_code, created_at, updated_at)
         VALUES ($1, $2, 'failed', $3, now(), now())
         ON CONFLICT (tenant_id, ticket_id) DO UPDATE
           SET ai_status       = 'failed',
               last_error_code = EXCLUDED.last_error_code,
               updated_at      = now()`,
        [tenantId, ticketId, errorCode],
      );

      // Emit ai.synthesis.failed domain event (WO-064 AC-4)
      await client.query(
        `INSERT INTO outbox_events
           (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
         VALUES ($1, $2, 'ticket', $3, 'ai.synthesis.failed', $4, 'pending', now())`,
        [
          randomUUID(), tenantId, ticketId,
          JSON.stringify({
            eventType:    'ai.synthesis.failed',
            tenantId,
            ticketId,
            attemptCount,
            lastErrorCode: errorCode,
          }),
        ],
      );

      await client.query('COMMIT');

      this.logger.error('Synthesis failed permanently', {
        tenantId, ticketId, attemptCount, errorCode, traceId,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error('Failed to write terminal failure state', {
        tenantId, ticketId, error: (err as Error).message,
      });
    } finally {
      client.release();
    }
  }

  private deduplicateAreas(
    areas: Array<{ areaLabel: string; confidence: string }>,
  ): Array<{ areaLabel: string; confidence: string }> {
    const seen = new Map<string, string>();
    for (const a of areas) {
      const key = a.areaLabel.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.set(key, a.confidence);
      }
    }
    return Array.from(seen.entries()).map(([areaLabel, confidence]) => ({ areaLabel, confidence }));
  }
}
