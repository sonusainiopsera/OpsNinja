/**
 * WebhookDeliveryHandler – core delivery logic for the webhook worker.
 *
 * Per-message flow:
 *  1. Zod-parse the SQS envelope.
 *  2. Load endpoint row under tenant context; drop if inactive/deleted.
 *  3. Check idempotency: unique (tenant_id, endpoint_id, event_id, attempt) row.
 *  4. Acquire Redis per-endpoint concurrency semaphore.
 *  5. Acquire Redis per-tenant token bucket.
 *  6. Decrypt signing secret (and previous secret if in rotation window).
 *  7. Dispatch via WebhookDispatcher (SSRF re-validate → sign → POST).
 *  8. Record idempotent delivery row.
 *  9. Update endpoint consecutive_failures / last_success_at.
 * 10. Auto-disable endpoint after threshold consecutive failures.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql, isNull } from 'drizzle-orm';
import Redis from 'ioredis';
import {
  webhookEndpoints,
  webhookDeliveries,
  type WebhookEndpointStatus,
} from '@opsninja/db';
import { ENVELOPE_CIPHER_PORT, EnvelopeCipherPort } from '@opsninja/crypto';
import {
  dispatch,
  classifyRetry,
  buildCanonicalPayload,
  type DeliveryOutcome,
  type WebhookEventEnvelope,
} from '@opsninja/webhooks';
import { WEBHOOK_DB_POOL, WEBHOOK_REDIS } from './worker.module';

// ── Constants ─────────────────────────────────────────────────────────────────

export const AUTO_DISABLE_THRESHOLD = 20;
const CONCURRENCY_LIMIT = 5;
const RATE_LIMIT_PER_SECOND = 20;
const RATE_LIMIT_BURST = 40;
const CONCURRENCY_TTL_SEC = 60;

// ── Zod schema for inbound SQS envelope ──────────────────────────────────────

export const WebhookDeliveryEnvelopeSchema = z.object({
  tenantId: z.string().uuid(),
  endpointId: z.string().uuid(),
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  occurredAt: z.string().datetime(),
  attempt: z.number().int().min(1).default(1),
  data: z.record(z.unknown()).default({}),
  traceId: z.string().optional(),
});

export type WebhookDeliveryEnvelope = z.infer<typeof WebhookDeliveryEnvelopeSchema>;

// ── Lua scripts ───────────────────────────────────────────────────────────────

const CONCURRENCY_ACQUIRE_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local current = tonumber(redis.call('GET', key) or '0')
if current < limit then
  redis.call('INCR', key)
  redis.call('EXPIRE', key, ttl)
  return 1
end
return 0
`;

const CONCURRENCY_RELEASE_LUA = `
local key = KEYS[1]
local val = tonumber(redis.call('GET', key) or '0')
if val > 0 then redis.call('DECR', key) end
return 1
`;

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local max_tokens = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1]) or max_tokens
local last = tonumber(data[2]) or now
local elapsed = math.max(0, now - last)
local refilled = math.min(max_tokens, tokens + elapsed * rate)
if refilled >= cost then
  redis.call('HMSET', key, 'tokens', refilled - cost, 'last_refill', now)
  redis.call('EXPIRE', key, math.ceil(max_tokens / rate) + 10)
  return {1, 0}
else
  local deficit = cost - refilled
  local wait_ms = math.ceil((deficit / rate) * 1000)
  redis.call('HMSET', key, 'tokens', refilled, 'last_refill', now)
  redis.call('EXPIRE', key, math.ceil(max_tokens / rate) + 10)
  return {0, wait_ms}
end
`;

@Injectable()
export class WebhookDeliveryHandler {
  private readonly logger = new Logger(WebhookDeliveryHandler.name);

  constructor(
    @Inject(WEBHOOK_DB_POOL) private readonly pool: Pool,
    @Inject(WEBHOOK_REDIS) private readonly redis: Redis,
    @Inject(ENVELOPE_CIPHER_PORT) private readonly cipher: EnvelopeCipherPort,
  ) {}

  async handle(rawBody: string): Promise<void> {
    let envelope: WebhookDeliveryEnvelope;
    try {
      envelope = WebhookDeliveryEnvelopeSchema.parse(JSON.parse(rawBody) as unknown);
    } catch (err) {
      this.logger.error('Invalid webhook delivery envelope — discarding', {
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    await this.processEnvelope(envelope);
  }

  async processEnvelope(envelope: WebhookDeliveryEnvelope): Promise<void> {
    const { tenantId, endpointId, eventId, eventType, occurredAt, attempt, data, traceId } = envelope;
    const db = drizzle(this.pool);

    // ── Bind tenant context ───────────────────────────────────────────────────
    await db.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, false)`);

    // ── Load endpoint ─────────────────────────────────────────────────────────
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);

      const endpoints = await tx
        .select()
        .from(webhookEndpoints)
        .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId)))
        .limit(1);

      if (endpoints.length === 0 || endpoints[0].status === 'deleted' || endpoints[0].status === 'auto_disabled') {
        this.logger.log('Endpoint inactive; dropping delivery', { tenantId, endpointId, traceId });
        await this.writeDelivery(tx, {
          tenantId, endpointId, eventId, eventType, attempt,
          status: 'dropped', errorCode: 'ENDPOINT_INACTIVE',
          canonicalPayload: { id: eventId, type: eventType, occurredAt, tenantId, data },
        });
        return;
      }

      const endpoint = endpoints[0];

      // ── Idempotency check ───────────────────────────────────────────────────
      const existing = await tx
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(and(
          eq(webhookDeliveries.tenantId, tenantId),
          eq(webhookDeliveries.endpointId, endpointId),
          eq(webhookDeliveries.eventId, eventId),
          eq(webhookDeliveries.attempt, attempt),
        ))
        .limit(1);

      if (existing.length > 0) {
        this.logger.log('Idempotent redelivery; skipping', { tenantId, endpointId, eventId, attempt, traceId });
        return;
      }

      // ── Redis concurrency semaphore ─────────────────────────────────────────
      const concKey = `wh:conc:${endpointId}`;
      const acquired = await this.acquireConcurrency(concKey);
      if (!acquired) {
        this.logger.warn('Concurrency limit reached; returning to queue', { tenantId, endpointId });
        throw new ConcurrencyError(endpointId);
      }

      try {
        // ── Redis token bucket ──────────────────────────────────────────────
        const rateAllowed = await this.checkRateLimit(tenantId);
        if (!rateAllowed) {
          this.logger.warn('Rate limit exceeded; returning to queue', { tenantId });
          throw new RateLimitError(tenantId);
        }

        // ── Decrypt signing secret ─────────────────────────────────────────
        const secret = await this.cipher.decrypt(endpoint.secretCiphertext!, endpoint.secretKeyVersion);
        let previousSecret: string | undefined;
        if (endpoint.previousSecretCiphertext && endpoint.previousSecretExpiresAt) {
          if (endpoint.previousSecretExpiresAt > new Date()) {
            previousSecret = await this.cipher.decrypt(
              endpoint.previousSecretCiphertext,
              endpoint.secretKeyVersion,
            );
          }
        }

        // ── Build canonical payload ─────────────────────────────────────────
        const envelopePayload: WebhookEventEnvelope = {
          id: eventId,
          type: eventType,
          occurredAt,
          tenantId,
          data,
        };
        const canonicalPayload = JSON.parse(buildCanonicalPayload(envelopePayload)) as Record<string, unknown>;

        // ── Dispatch ────────────────────────────────────────────────────────
        const result = await dispatch({
          url: endpoint.url,
          secret: secret.toString('base64url'),
          previousSecret: previousSecret?.toString('base64url'),
          envelope: envelopePayload,
        });

        // ── Record delivery attempt ─────────────────────────────────────────
        await this.writeDelivery(tx, {
          tenantId, endpointId, eventId, eventType, attempt,
          status: result.outcome === 'delivered' ? 'delivered' :
                  result.outcome === 'blocked' || result.outcome === 'dropped' ? 'dropped' : 'failed',
          httpStatus: result.httpStatus,
          latencyMs: result.latencyMs,
          responseSnippet: result.responseSnippet ? this.truncateSnippet(result.responseSnippet) : undefined,
          errorCode: result.errorCode,
          canonicalPayload,
        });

        // ── Update endpoint counters ────────────────────────────────────────
        if (result.outcome === 'delivered') {
          await tx
            .update(webhookEndpoints)
            .set({ consecutiveFailures: 0, lastSuccessAt: new Date() })
            .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId)));
        } else if (result.outcome === 'failed_retryable' || result.outcome === 'failed_permanent') {
          const updated = await tx
            .update(webhookEndpoints)
            .set({
              consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
              status: sql`CASE WHEN ${webhookEndpoints.consecutiveFailures} + 1 >= ${AUTO_DISABLE_THRESHOLD} THEN 'auto_disabled'::webhook_endpoint_status ELSE ${webhookEndpoints.status} END`,
            })
            .where(and(eq(webhookEndpoints.tenantId, tenantId), eq(webhookEndpoints.id, endpointId)))
            .returning({ status: webhookEndpoints.status, consecutiveFailures: webhookEndpoints.consecutiveFailures });

          if (updated[0]?.status === 'auto_disabled') {
            this.logger.warn('Endpoint auto-disabled after consecutive failures', {
              tenantId, endpointId, consecutiveFailures: AUTO_DISABLE_THRESHOLD, traceId,
            });
          }
        }

        // ── Retry if needed ─────────────────────────────────────────────────
        const retry = classifyRetry(result.outcome, attempt);
        if (retry.shouldRetry) {
          throw new RetryableError(retry.delaySec, retry.requiresReEnqueue);
        }

      } finally {
        await this.releaseConcurrency(concKey);
      }
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async writeDelivery(
    tx: ReturnType<typeof drizzle>,
    params: {
      tenantId: string;
      endpointId: string;
      eventId: string;
      eventType: string;
      attempt: number;
      status: 'delivered' | 'failed' | 'dropped';
      httpStatus?: number;
      latencyMs?: number;
      responseSnippet?: string;
      errorCode?: string;
      canonicalPayload: Record<string, unknown>;
    },
  ): Promise<void> {
    await (tx as ReturnType<typeof drizzle>)
      .insert(webhookDeliveries)
      .values({
        tenantId: params.tenantId,
        endpointId: params.endpointId,
        eventId: params.eventId,
        eventType: params.eventType,
        attempt: params.attempt,
        status: params.status,
        httpStatus: params.httpStatus ?? null,
        latencyMs: params.latencyMs ?? null,
        responseSnippet: params.responseSnippet ?? null,
        errorCode: params.errorCode ?? null,
        canonicalPayload: params.canonicalPayload,
      })
      .onConflictDoNothing();
  }

  private truncateSnippet(body: string): string {
    return body.slice(0, 1024);
  }

  private async acquireConcurrency(key: string): Promise<boolean> {
    try {
      const result = await this.redis.eval(
        CONCURRENCY_ACQUIRE_LUA, 1, key,
        String(CONCURRENCY_LIMIT), String(CONCURRENCY_TTL_SEC),
      ) as number;
      return result === 1;
    } catch {
      return true; // Redis unavailable: allow through
    }
  }

  private async releaseConcurrency(key: string): Promise<void> {
    try {
      await this.redis.eval(CONCURRENCY_RELEASE_LUA, 1, key);
    } catch {
      // ignore
    }
  }

  private async checkRateLimit(tenantId: string): Promise<boolean> {
    const key = `wh:rate:${tenantId}`;
    try {
      const result = await this.redis.eval(
        TOKEN_BUCKET_LUA, 1, key,
        String(RATE_LIMIT_BURST), String(RATE_LIMIT_PER_SECOND),
        String(Date.now() / 1000), '1',
      ) as [number, number];
      return result[0] === 1;
    } catch {
      return true; // Redis unavailable: allow through
    }
  }
}

// ── Error classes ─────────────────────────────────────────────────────────────

export class ConcurrencyError extends Error {
  constructor(public readonly endpointId: string) {
    super(`Concurrency limit reached for endpoint ${endpointId}`);
    this.name = 'ConcurrencyError';
  }
}

export class RateLimitError extends Error {
  constructor(public readonly tenantId: string) {
    super(`Rate limit exceeded for tenant ${tenantId}`);
    this.name = 'RateLimitError';
  }
}

export class RetryableError extends Error {
  constructor(
    public readonly delaySec: number,
    public readonly requiresReEnqueue: boolean,
  ) {
    super(`Retryable failure; delay ${delaySec}s`);
    this.name = 'RetryableError';
  }
}
