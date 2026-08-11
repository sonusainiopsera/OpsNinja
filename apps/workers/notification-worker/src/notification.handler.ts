/**
 * NotificationHandler
 *
 * Processes a single qNotify SQS message end-to-end:
 *
 *  1. Zod-parse the SQS envelope (rejects malformed messages).
 *  2. Open a DB transaction and SET LOCAL app.current_tenant.
 *  3. INSERT notification row with ON CONFLICT DO NOTHING (idempotency).
 *     If 0 rows were inserted the message is a duplicate — short-circuit.
 *  4. Check email_hash against notification_suppressions.
 *     Suppressed → mark suppressed, count metric, return.
 *  5. Consume one token from the per-tenant Redis rate-limit bucket.
 *     Bucket empty → throw RateLimitExceededError (SQS requeues).
 *  6. Load + render the Handlebars template from DB (HTML-escaped by default).
 *  7. Call EmailSenderPort.sendEmail().
 *  8. Persist sent/failed/suppressed status + provider_message_id.
 *
 * All PII (recipient email, rendered body) is excluded from logs via the
 * @opsninja/observability log redactor.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import Handlebars from 'handlebars';
import * as schema from '@opsninja/db';
import { redactLogObject } from '@opsninja/observability';

import { parseEnvelope, type NotificationEnvelope } from './sqs-envelope.schema';
import { RateLimiterService } from './rate-limiter.service';
import type { EmailSenderPort } from './ports/email-sender.port';
import { classifySesError } from './ports/email-sender.port';

export const MAX_SES_ATTEMPTS = 5;

export class DedupeConflictError extends Error {
  constructor(dedupeKey: string) {
    super(`Duplicate notification skipped: dedupeKey=${dedupeKey}`);
    this.name = 'DedupeConflictError';
  }
}

export class RateLimitExceededError extends Error {
  constructor(tenantId: string) {
    super(`Rate limit exceeded for tenant ${tenantId}`);
    this.name = 'RateLimitExceededError';
  }
}

export class SesTerminalError extends Error {
  constructor(
    public readonly sesErrorName: string,
    message: string,
  ) {
    super(message);
    this.name = 'SesTerminalError';
  }
}

@Injectable()
export class NotificationHandler {
  private readonly logger = new Logger(NotificationHandler.name);

  constructor(
    private readonly pool: Pool,
    private readonly emailSender: EmailSenderPort,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  async handleMessage(sqsBody: string): Promise<void> {
    let envelope: NotificationEnvelope;
    try {
      envelope = parseEnvelope(sqsBody);
    } catch (err) {
      this.logger.error('Invalid SQS envelope — discarding', {
        error: (err as Error).message,
      });
      // Return without throwing so SQS deletes the message (it will never be valid).
      return;
    }

    const { tenantId, dedupeKey, templateKey, channel, locale, payload, outboxTraceId } =
      envelope.data;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);

      const tx = drizzle(client as unknown as Parameters<typeof drizzle>[0], { schema });

      // ── Step 3: Idempotency insert ──────────────────────────────────────────
      const inserted = await tx
        .insert(schema.notifications)
        .values({
          tenantId,
          ticketId: envelope.data.ticketId,
          recipientContactId: envelope.data.recipientContactId,
          recipientEmail: envelope.data.recipientEmail,
          channel,
          templateKey,
          payload: payload as Record<string, unknown>,
          dedupeKey,
          status: 'queued',
          attempts: 0,
        })
        .onConflictDoNothing({
          target: [schema.notifications.tenantId, schema.notifications.dedupeKey],
        })
        .returning({ id: schema.notifications.id });

      if (inserted.length === 0) {
        // Duplicate — idempotent no-op, delete the SQS message.
        await client.query('COMMIT');
        this.logger.log('Duplicate notification skipped', redactLogObject({
          tenantId,
          dedupeKey,
          traceId: outboxTraceId,
        }) as Record<string, unknown>);
        return;
      }

      const notificationId = inserted[0]!.id;

      // ── Step 4: Suppression check ───────────────────────────────────────────
      const emailHash = createHash('sha256')
        .update(envelope.data.recipientEmail.toLowerCase().trim())
        .digest('hex');

      const suppressed = await tx
        .select({ emailHash: schema.notificationSuppressions.emailHash })
        .from(schema.notificationSuppressions)
        .where(
          and(
            eq(schema.notificationSuppressions.tenantId, tenantId),
            eq(schema.notificationSuppressions.emailHash, emailHash),
          ),
        )
        .limit(1);

      if (suppressed.length > 0) {
        await tx
          .update(schema.notifications)
          .set({ status: 'suppressed', errorCode: 'SUPPRESSED' })
          .where(
            and(
              eq(schema.notifications.tenantId, tenantId),
              eq(schema.notifications.id, notificationId),
            ),
          );
        await client.query('COMMIT');
        this.logger.log('Notification suppressed', {
          tenantId,
          notificationId,
          templateKey,
          outcome: 'suppressed',
        });
        // Emit suppressed metric
        this.emitMetric('notification_suppressed_total', { tenantId, templateKey });
        return;
      }

      // ── Step 5: Rate limiting ───────────────────────────────────────────────
      const allowed = await this.rateLimiter.tryConsume(tenantId);
      if (!allowed) {
        // Roll back so the notification row stays queued; SQS will redeliver.
        await client.query('ROLLBACK');
        throw new RateLimitExceededError(tenantId);
      }

      // ── Step 6: Template rendering ──────────────────────────────────────────
      const tmplRows = await tx
        .select()
        .from(schema.notificationTemplates)
        .where(
          and(
            eq(schema.notificationTemplates.tenantId, tenantId),
            eq(schema.notificationTemplates.key, templateKey),
            eq(schema.notificationTemplates.locale, locale),
            eq(schema.notificationTemplates.isActive, true),
          ),
        )
        .limit(1);

      const tmpl = tmplRows[0];
      if (!tmpl) {
        this.logger.warn('Template not found — no fallback available', {
          tenantId,
          templateKey,
          notificationId,
        });
        await tx
          .update(schema.notifications)
          .set({ status: 'failed', errorCode: 'TEMPLATE_NOT_FOUND' })
          .where(
            and(
              eq(schema.notifications.tenantId, tenantId),
              eq(schema.notifications.id, notificationId),
            ),
          );
        await client.query('COMMIT');
        return;
      }

      const renderData = payload as Record<string, unknown>;
      // HTML escaping is ON by default in Handlebars — no noEscape option needed.
      const subject = Handlebars.compile(tmpl.subject)(renderData);
      const htmlBody = Handlebars.compile(tmpl.bodyTemplate)(renderData);
      const textBody = Handlebars.compile(tmpl.textTemplate)(renderData);

      // ── Step 7: Send via EmailSenderPort ────────────────────────────────────
      const startMs = Date.now();
      let providerMessageId: string;
      try {
        const result = await this.emailSender.sendEmail({
          from: process.env['SES_FROM_ADDRESS'] ?? 'noreply@example.com',
          to: envelope.data.recipientEmail,
          subject,
          htmlBody,
          textBody,
          traceId: outboxTraceId,
        });
        providerMessageId = result.messageId;
      } catch (sesErr) {
        const sesErrorName = (sesErr as { name?: string }).name;
        const classification = classifySesError(sesErrorName);

        if (classification === 'permanent') {
          // Mark failed immediately — do not retry.
          await tx
            .update(schema.notifications)
            .set({ status: 'failed', errorCode: sesErrorName ?? 'SES_PERMANENT', attempts: 1 })
            .where(
              and(
                eq(schema.notifications.tenantId, tenantId),
                eq(schema.notifications.id, notificationId),
              ),
            );
          await client.query('COMMIT');
          this.logger.error('SES permanent failure', redactLogObject({
            tenantId,
            notificationId,
            templateKey,
            errorCode: sesErrorName,
            traceId: outboxTraceId,
          }) as Record<string, unknown>);
          this.emitMetric('notification_failed_total', { tenantId, templateKey, reason: 'permanent' });
          throw new SesTerminalError(sesErrorName ?? 'UNKNOWN', (sesErr as Error).message);
        }

        // Retryable: increment attempts, roll back, rethrow for SQS requeue.
        const currentRow = await tx
          .select({ attempts: schema.notifications.attempts })
          .from(schema.notifications)
          .where(
            and(
              eq(schema.notifications.tenantId, tenantId),
              eq(schema.notifications.id, notificationId),
            ),
          )
          .limit(1);
        const nextAttempts = (currentRow[0]?.attempts ?? 0) + 1;

        if (nextAttempts >= MAX_SES_ATTEMPTS) {
          await tx
            .update(schema.notifications)
            .set({ status: 'failed', errorCode: 'MAX_ATTEMPTS', attempts: nextAttempts })
            .where(
              and(
                eq(schema.notifications.tenantId, tenantId),
                eq(schema.notifications.id, notificationId),
              ),
            );
          await client.query('COMMIT');
          this.logger.error('Notification DLQ routed after max attempts', {
            tenantId,
            notificationId,
            templateKey,
            attempts: nextAttempts,
          });
          this.emitMetric('notification_failed_total', { tenantId, templateKey, reason: 'max_attempts' });
          return;
        }

        await tx
          .update(schema.notifications)
          .set({ attempts: nextAttempts })
          .where(
            and(
              eq(schema.notifications.tenantId, tenantId),
              eq(schema.notifications.id, notificationId),
            ),
          );
        await client.query('ROLLBACK');
        // Rethrow for SQS visibility timeout backoff requeue
        throw sesErr;
      }

      // ── Step 8: Persist sent status ─────────────────────────────────────────
      const latencyMs = Date.now() - startMs;
      await tx
        .update(schema.notifications)
        .set({ status: 'sent', providerMessageId, sentAt: new Date(), attempts: 1 })
        .where(
          and(
            eq(schema.notifications.tenantId, tenantId),
            eq(schema.notifications.id, notificationId),
          ),
        );
      await client.query('COMMIT');

      this.logger.log('Notification sent', {
        tenantId,
        notificationId,
        templateKey,
        providerMessageId,
        outcome: 'sent',
        latency_ms: latencyMs,
        traceId: outboxTraceId,
      });
      this.emitMetric('notification_sent_total', { tenantId, templateKey });
    } catch (err) {
      if (!(err instanceof RateLimitExceededError) && !(err instanceof SesTerminalError)) {
        try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private emitMetric(name: string, labels: Record<string, string>): void {
    // Structured log entry picked up by OpenTelemetry log-to-metrics pipeline.
    console.log(JSON.stringify({ metric: name, labels, value: 1, ts: Date.now() }));
  }
}
