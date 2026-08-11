/**
 * DeliveryHandler
 *
 * Processes a single webhook delivery SQS message end-to-end:
 *
 *  1. Zod-parse the SQS envelope.
 *  2. Open a DB transaction with tenant context.
 *  3. Load the endpoint — if missing/deleted/auto_disabled → drop.
 *  4. Check Redis concurrency semaphore and tenant token bucket.
 *  5. Decrypt signing secret (in-memory only — not cached).
 *  6. Check idempotency: if attempt row already exists → no-op.
 *  7. Dispatch via dispatchWebhook (SSRF re-validation, timeouts, signing).
 *  8. Record attempt row (idempotent ON CONFLICT DO NOTHING).
 *  9. Classify retry: succeed/retry/dlq/drop.
 * 10. On failure: atomic consecutive_failures increment + auto-disable at threshold.
 * 11. On success: reset consecutive_failures to 0.
 * 12. On auto-disable: enqueue admin notification via notifications table.
 *
 * Auto-disable threshold: 20 consecutive failures.
 * Secrets never logged; response snippets passed through log redactor.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import * as schema from '@opsninja/db';
import { redactLogObject } from '@opsninja/observability';
import { dispatchWebhook, buildCanonicalEvent } from '@opsninja/webhooks';
import type { EnvelopeCipherPort } from '@opsninja/crypto';

import { parseEnvelope, type WebhookDeliveryEnvelope } from './sqs-envelope.schema';
import { classifyRetry, MAX_ATTEMPTS } from './retry-classifier';
import type { RedisGating } from './redis-gating';

const AUTO_DISABLE_THRESHOLD = parseInt(process.env['WEBHOOK_AUTO_DISABLE_THRESHOLD'] ?? '20', 10);
const MAX_SNIPPET_BYTES = 1024;

export class DedupeConflictError extends Error {
  constructor() {
    super('Duplicate delivery attempt — idempotency guard triggered');
    this.name = 'DedupeConflictError';
  }
}

@Injectable()
export class DeliveryHandler {
  private readonly logger = new Logger(DeliveryHandler.name);

  constructor(
    private readonly pool: Pool,
    private readonly cipher: EnvelopeCipherPort,
    private readonly gating: RedisGating,
  ) {}

  async handleMessage(sqsBody: string): Promise<{ retry?: { delaySeconds: number; nextAttempt: number } }> {
    let envelope: WebhookDeliveryEnvelope;
    try {
      envelope = parseEnvelope(sqsBody);
    } catch (err) {
      this.logger.error('Invalid webhook delivery envelope — discarding', {
        error: (err as Error).message,
      });
      return {};
    }

    const { tenantId, endpointId, eventId, eventType, occurredAt, attempt, data, traceId } =
      envelope.data;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

      const tx = drizzle(client as unknown as Parameters<typeof drizzle>[0], { schema });

      // ── Load endpoint ──────────────────────────────────────────────────────
      const endpoints = await tx
        .select()
        .from(schema.webhookEndpoints)
        .where(
          and(
            eq(schema.webhookEndpoints.tenantId, tenantId),
            eq(schema.webhookEndpoints.id, endpointId),
          ),
        )
        .limit(1);

      const endpoint = endpoints[0];

      if (!endpoint || endpoint.deletedAt !== null || endpoint.status === 'auto_disabled') {
        // Endpoint inactive — record drop and stop
        await this.recordAttempt(tx, {
          tenantId, endpointId, eventId, eventType, attempt,
          status: 'dropped',
          httpStatus: null, latencyMs: null,
          responseSnippet: null, errorCode: 'endpoint_inactive',
          canonicalPayload: { id: eventId, type: eventType, occurredAt, tenantId, data },
        });
        await client.query('COMMIT');
        this.emitMetric('webhook_delivery_total', { outcome: 'dropped', tenantId });
        return {};
      }

      // ── Idempotency check ──────────────────────────────────────────────────
      const existing = await tx
        .select({ id: schema.webhookDeliveries.id })
        .from(schema.webhookDeliveries)
        .where(
          and(
            eq(schema.webhookDeliveries.tenantId, tenantId),
            eq(schema.webhookDeliveries.endpointId, endpointId),
            eq(schema.webhookDeliveries.eventId, eventId),
            eq(schema.webhookDeliveries.attempt, attempt),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await client.query('COMMIT');
        this.logger.log('Duplicate delivery attempt — idempotency guard', {
          tenantId, endpointId, eventId, attempt,
        });
        return {};
      }

      await client.query('COMMIT');
      client.release();

      // ── Redis gating (outside DB transaction — no pool slot held) ─────────
      const [concOk, rateOk] = await Promise.all([
        this.gating.acquireConcurrencySlot(endpointId),
        this.gating.checkTenantRateLimit(tenantId),
      ]);

      if (!concOk || !rateOk) {
        this.logger.warn('Webhook gated — requeue', {
          tenantId, endpointId, concOk, rateOk,
        });
        // Re-enqueue (caller will use ChangeMessageVisibility)
        return { retry: { delaySeconds: 1, nextAttempt: attempt } };
      }

      // ── Decrypt secrets (in-memory, not cached) ─────────────────────────
      const plaintextSecret = await this.cipher.decrypt(endpoint.secretCiphertext, tenantId);
      let previousPlaintextSecret: string | undefined;
      if (
        endpoint.previousSecretCiphertext &&
        endpoint.previousSecretExpiresAt &&
        new Date() < endpoint.previousSecretExpiresAt
      ) {
        previousPlaintextSecret = await this.cipher.decrypt(
          endpoint.previousSecretCiphertext,
          tenantId,
        );
      }

      // ── Dispatch ─────────────────────────────────────────────────────────
      const canonicalEvent = buildCanonicalEvent(
        eventId, eventType, tenantId, new Date(occurredAt), data,
      );

      const dispatchResult = await dispatchWebhook({
        url: endpoint.url,
        plaintextSecret,
        previousPlaintextSecret,
        event: canonicalEvent,
      });

      // Release concurrency slot immediately after dispatch
      await this.gating.releaseConcurrencySlot(endpointId).catch(() => undefined);

      const retryDecision = classifyRetry(dispatchResult.outcome, attempt);

      // ── Record attempt + update endpoint counters ─────────────────────────
      const client2 = await this.pool.connect();
      try {
        await client2.query('BEGIN');
        await client2.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
        const tx2 = drizzle(client2 as unknown as Parameters<typeof drizzle>[0], { schema });

        // Truncate + redact response snippet
        const safeSnippet = redactLogObject({ s: dispatchResult.responseSnippet.slice(0, MAX_SNIPPET_BYTES) }) as { s: string };

        await this.recordAttempt(tx2, {
          tenantId, endpointId, eventId, eventType, attempt,
          status: dispatchResult.outcome === 'delivered' ? 'delivered'
            : retryDecision.action === 'drop' ? 'dropped' : 'failed',
          httpStatus: dispatchResult.httpStatus || null,
          latencyMs: dispatchResult.latencyMs,
          responseSnippet: safeSnippet.s,
          errorCode: dispatchResult.errorCode ?? null,
          canonicalPayload: canonicalEvent as unknown as Record<string, unknown>,
        });

        if (dispatchResult.outcome === 'delivered') {
          await tx2.update(schema.webhookEndpoints).set({
            consecutiveFailures: 0,
            lastSuccessAt: new Date(),
            updatedAt: new Date(),
          }).where(
            and(
              eq(schema.webhookEndpoints.tenantId, tenantId),
              eq(schema.webhookEndpoints.id, endpointId),
            ),
          );
        } else if (dispatchResult.outcome === 'failed_retryable' || dispatchResult.outcome === 'failed_permanent') {
          // Atomic consecutive_failures increment + auto-disable
          const updateResult = await client2.query<{ id: string; consecutive_failures: number; status: string }>(
            `UPDATE webhook_endpoints
             SET consecutive_failures = consecutive_failures + 1,
                 status = CASE
                   WHEN consecutive_failures + 1 >= $1 THEN 'auto_disabled'
                   ELSE status
                 END,
                 updated_at = now()
             WHERE tenant_id = $2::uuid AND id = $3::uuid
             RETURNING id, consecutive_failures, status`,
            [AUTO_DISABLE_THRESHOLD, tenantId, endpointId],
          );

          const updated = updateResult.rows[0];
          if (updated?.status === 'auto_disabled' && updated.consecutive_failures >= AUTO_DISABLE_THRESHOLD) {
            await this.enqueueAutoDisableNotification(tx2, tenantId, endpointId);
            this.emitMetric('webhook_endpoint_auto_disabled_total', { tenantId });
          }
        }

        await client2.query('COMMIT');
      } catch (err) {
        await client2.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client2.release();
      }

      // ── Emit metrics ────────────────────────────────────────────────────
      this.emitMetric('webhook_delivery_total', { outcome: dispatchResult.outcome, tenantId });
      if (dispatchResult.latencyMs > 0) {
        this.emitMetric('webhook_delivery_latency_seconds', {
          outcome: dispatchResult.outcome,
          tenantId,
          value: String(dispatchResult.latencyMs / 1000),
        });
      }

      this.logger.log('Webhook delivery recorded', redactLogObject({
        tenantId, endpointId, eventId, attempt,
        outcome: dispatchResult.outcome,
        httpStatus: dispatchResult.httpStatus,
        latencyMs: dispatchResult.latencyMs,
        traceId,
      }) as Record<string, unknown>);

      if (retryDecision.action === 'retry') {
        return { retry: { delaySeconds: retryDecision.delaySeconds, nextAttempt: retryDecision.nextAttempt } };
      }
      return {};
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
      throw err;
    }
  }

  private async recordAttempt(
    tx: ReturnType<typeof drizzle>,
    row: {
      tenantId: string; endpointId: string; eventId: string; eventType: string;
      attempt: number; status: string; httpStatus: number | null;
      latencyMs: number | null; responseSnippet: string | null;
      errorCode: string | null; canonicalPayload: Record<string, unknown>;
    },
  ): Promise<void> {
    await (tx as ReturnType<typeof drizzle<typeof schema>>)
      .insert(schema.webhookDeliveries)
      .values({
        tenantId: row.tenantId,
        endpointId: row.endpointId,
        eventId: row.eventId,
        eventType: row.eventType,
        attempt: row.attempt as unknown as number,
        status: row.status as schema.WebhookDeliveryStatus,
        httpStatus: row.httpStatus as unknown as number | undefined,
        latencyMs: row.latencyMs ?? undefined,
        responseSnippet: row.responseSnippet ?? undefined,
        errorCode: row.errorCode ?? undefined,
        canonicalPayload: row.canonicalPayload,
      })
      .onConflictDoNothing();
  }

  private async enqueueAutoDisableNotification(
    tx: ReturnType<typeof drizzle>,
    tenantId: string,
    endpointId: string,
  ): Promise<void> {
    await (tx as ReturnType<typeof drizzle<typeof schema>>)
      .insert(schema.notifications)
      .values({
        tenantId,
        dedupeKey: createHash('sha256')
          .update(`webhook_auto_disabled:${tenantId}:${endpointId}`)
          .digest('hex'),
        templateKey: 'webhook_auto_disabled',
        channel: 'email',
        status: 'pending',
        locale: 'en',
        payload: { endpointId },
      })
      .onConflictDoNothing();
  }

  private emitMetric(name: string, labels: Record<string, string>): void {
    console.log(JSON.stringify({ metric: name, labels, value: 1, ts: Date.now() }));
  }
}
