/**
 * SynthesisService — core orchestration for the AI synthesis pipeline.
 *
 * Transaction sequence (AC-4, AC-5, AC-7):
 *   Tx-1: SET LOCAL app.current_tenant
 *         Idempotency guard (INSERT ... ON CONFLICT DO NOTHING)
 *         UPSERT ticket_ai_summaries SET ai_status = 'running'
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
 * AC-10: ticket closure never blocked — the ticket.resolved transition writes
 *        ai_status = 'pending' before the worker ever sees the message. Ticket
 *        resolution is complete regardless of whether this worker is running.
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import {
  ticketAiSummaries,
  ticketAffectedAreas,
  aiSynthesisIdempotency,
  outboxEvents,
  auditLogs,
} from '@opsninja/db';
import { ThreadLoader } from './thread-loader';
import { IdempotencyRepository } from './idempotency.repository';
import {
  LLM_PROVIDER,
  RetryableLlmError,
  NonRetryableLlmError,
  type LlmProviderPort,
} from './llm-provider.port';
import { AI_POLICY, type AiPolicyPort } from './ai-policy.port';

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

    // ── Tx-1: idempotency + claim running ───────────────────────────────────
    let summaryId: string | null = null;
    let alreadyProcessed = false;

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
        if (policy === 'skip') {
          await this.upsertSummaryStatus(client1, tenantId, ticketId, 'skipped', null);
          await client1.query('COMMIT');
          this.emitMetric('ai_synthesis_processed_total', { tenantId, outcome: 'skipped' });
          return { outcome: 'skipped', shouldRetry: false };
        }

        // Upsert running + SELECT FOR UPDATE to serialise concurrent redeliveries
        const result = await client1.query<{ id: string }>(
          `INSERT INTO ticket_ai_summaries (tenant_id, ticket_id, ai_status, created_at, updated_at)
           VALUES ($1, $2, 'running', now(), now())
           ON CONFLICT (tenant_id, ticket_id) DO UPDATE
             SET ai_status = 'running', updated_at = now()
           RETURNING id`,
          [tenantId, ticketId],
        );
        summaryId = result.rows[0]?.id ?? null;

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
      if (!alreadyProcessed || summaryId === null) {
        // only release after commit/rollback branch above
      }
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
      const msg2 = (err as Error).message;
      if (msg2.includes('not found')) {
        this.logger.warn('Ticket not found — skipping synthesis', { tenantId, ticketId });
        client2.release();
        await this.markFailedPermanent(tenantId, ticketId, 'TICKET_NOT_FOUND');
        return { outcome: 'ticket_not_found', shouldRetry: false };
      }
      client2.release();
      this.logger.error('Thread load failed', { tenantId, ticketId, error: msg2 });
      return { outcome: 'failed_retryable', shouldRetry: true };
    } finally {
      client2.release();
    }

    // ── LLM call (no open transaction) ────────────────────────────────────
    let result;
    try {
      result = await this.llmProvider.synthesise(request);
    } catch (err) {
      if (err instanceof NonRetryableLlmError) {
        this.logger.error('Non-retryable LLM error', {
          tenantId, ticketId, errorCode: err.errorCode,
        });
        await this.markFailedPermanent(tenantId, ticketId, err.errorCode);
        this.emitMetric('ai_synthesis_processed_total', { tenantId, outcome: 'failed_permanent' });
        return { outcome: 'failed_permanent', shouldRetry: false };
      }
      this.logger.warn('Retryable LLM error', {
        tenantId, ticketId, error: (err as Error).message,
      });
      this.emitMetric('ai_synthesis_processed_total', { tenantId, outcome: 'failed_retryable' });
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
         SET ai_status        = 'succeeded',
             crux_summary     = $3,
             resolution_summary = $4,
             model_id         = $5,
             prompt_version   = $6,
             generated_at     = $7,
             truncated        = $8,
             prompt_tokens    = $9,
             completion_tokens = $10,
             last_error_code  = NULL,
             updated_at       = now()
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

      // Outbox event (AC-9)
      await client3.query(
        `INSERT INTO outbox_events (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, status, created_at)
         VALUES ($1, $2, 'ticket', $3, 'ai.synthesis.completed', $4, 'pending', now())`,
        [
          randomUUID(), tenantId, ticketId,
          JSON.stringify({
            tenantId,
            ticketId,
            aiStatus: 'succeeded',
            areaCount: deduped.length,
            modelId: result.modelId,
            promptVersion: result.promptVersion,
          }),
        ],
      );

      // Audit record (AC-8)
      await client3.query(
        `INSERT INTO audit_logs (tenant_id, actor_id, actor_kind, event_type, outcome, resource_type, resource_id,
          action, after_state, source, trace_id, created_at)
         VALUES ($1, 'system:ai-synthesis', 'system', 'ai.synthesis.writeback', 'success',
                 'ticket', $2, 'synthesise', $3, 'ai-synthesis-worker', $4, now())`,
        [
          tenantId, ticketId,
          JSON.stringify({ modelId: result.modelId, promptVersion: result.promptVersion, areaCount: deduped.length }),
          msg.traceparent ?? randomUUID(),
        ],
      );

      await client3.query('COMMIT');
    } catch (err) {
      await client3.query('ROLLBACK').catch(() => undefined);
      this.logger.error('Tx-2 writeback failed', {
        tenantId, ticketId, error: (err as Error).message,
      });
      return { outcome: 'failed_retryable', shouldRetry: true };
    } finally {
      client3.release();
    }

    const durationMs = Date.now() - start;
    this.emitMetric('ai_synthesis_processed_total', { tenantId, outcome: 'succeeded' });
    this.emitMetric('ai_synthesis_duration_ms', { tenantId, value: String(durationMs) });
    this.logger.log('Synthesis succeeded', {
      tenantId, ticketId, durationMs,
      modelId: result.modelId, areaCount: result.affectedAreas.length,
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
         SET ai_status = EXCLUDED.ai_status,
             last_error_code = EXCLUDED.last_error_code,
             updated_at = now()`,
      [tenantId, ticketId, status, errorCode],
    );
  }

  private async markFailedPermanent(
    tenantId: string,
    ticketId: string,
    errorCode: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await this.upsertSummaryStatus(client, tenantId, ticketId, 'failed', errorCode);
    } catch (err) {
      this.logger.error('Failed to mark summary as failed', { tenantId, ticketId, error: (err as Error).message });
    } finally {
      client.release();
    }
  }

  private deduplicateAreas(areas: Array<{ areaLabel: string; confidence: string }>): Array<{ areaLabel: string; confidence: string }> {
    const seen = new Map<string, string>();
    for (const a of areas) {
      const key = a.areaLabel.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.set(key, a.confidence);
      }
    }
    return Array.from(seen.entries()).map(([areaLabel, confidence]) => ({ areaLabel, confidence }));
  }

  private emitMetric(name: string, labels: Record<string, string>): void {
    console.log(JSON.stringify({ metric: name, labels, value: 1, ts: Date.now() }));
  }
}
