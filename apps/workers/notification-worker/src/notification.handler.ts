/**
 * NotificationHandler – processes a single SQS notification message.
 *
 * Flow per message:
 *  1. Zod-parse the SQS body into a typed envelope.
 *  2. Open a transaction + SET LOCAL app.current_tenant.
 *  3. Insert notifications row with ON CONFLICT DO NOTHING (idempotency).
 *  4. If insert was a no-op (duplicate), ACK the message and return.
 *  5. Check suppression list (SHA-256 email hash lookup).
 *  6. Check per-tenant rate limit (Redis token bucket).
 *  7. Render template via NotificationTemplateService.
 *  8. Send via EmailSenderPort.
 *  9. Update row to sent/suppressed/failed.
 * 10. ACK message (delete from SQS).
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { z } from 'zod';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { notifications, notificationSuppressions } from '@opsninja/db';
import { eq, and } from 'drizzle-orm';
import { EMAIL_SENDER_PORT, EmailSenderPort } from './ports/email-sender.port';
import { SesErrorClass, classifySesError } from './adapters/ses-error-classifier';
import { SESv2ServiceException } from '@aws-sdk/client-sesv2';
import { NotificationTemplateService } from './notification-template.service';
import { TokenBucketService } from './rate-limit/token-bucket.service';
import { redactString } from '@opsninja/observability';
import { WORKER_DB_POOL } from './worker.module';

// ── Zod schema for inbound SQS envelope ───────────────────────────────────────

const NotificationEnvelopeSchema = z.object({
  tenantId: z.string().uuid(),
  notificationId: z.string().uuid().optional(),
  recipientEmail: z.string().email(),
  templateKey: z.string().min(1).max(200),
  dedupeKey: z.string().min(1).max(500),
  ticketId: z.string().uuid().optional(),
  recipientContactId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).optional(),
  traceId: z.string().optional(),
});

export type NotificationEnvelope = z.infer<typeof NotificationEnvelopeSchema>;

// ── Constants ─────────────────────────────────────────────────────────────────

export const MAX_ATTEMPTS = 5;

@Injectable()
export class NotificationHandler {
  private readonly logger = new Logger(NotificationHandler.name);

  constructor(
    @Inject(WORKER_DB_POOL) private readonly pool: Pool,
    @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    private readonly templateService: NotificationTemplateService,
    private readonly tokenBucket: TokenBucketService,
  ) {}

  /** Parses and processes one raw SQS message body. */
  async handle(rawBody: string): Promise<void> {
    let envelope: NotificationEnvelope;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      envelope = NotificationEnvelopeSchema.parse(parsed);
    } catch (err) {
      this.logger.error('Invalid SQS envelope — discarding', {
        error: err instanceof Error ? err.message : String(err),
        bodyLength: rawBody.length,
      });
      return; // Do not throw — bad message goes to DLQ via max-receive-count
    }

    await this.processEnvelope(envelope);
  }

  private async processEnvelope(envelope: NotificationEnvelope): Promise<void> {
    const { tenantId, dedupeKey, recipientEmail, templateKey, traceId } = envelope;
    const emailHash = hashEmail(recipientEmail);

    const db = drizzle(this.pool);

    await db.transaction(async (tx) => {
      // ── Bind tenant context ────────────────────────────────────────────────
      await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);

      // ── Idempotency insert ─────────────────────────────────────────────────
      const inserted = await tx
        .insert(notifications)
        .values({
          tenantId,
          ticketId: envelope.ticketId,
          recipientContactId: envelope.recipientContactId,
          recipientEmail,
          templateKey,
          dedupeKey,
          payload: envelope.payload as Record<string, unknown> | null | undefined,
          status: 'queued',
        })
        .onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] })
        .returning({ id: notifications.id });

      if (inserted.length === 0) {
        // Duplicate message — already processed or in progress.
        this.logger.log('Duplicate SQS message; no-op', {
          tenantId,
          dedupeKey,
          traceId,
        });
        return;
      }

      const notifId = inserted[0].id;

      // ── Suppression check ──────────────────────────────────────────────────
      const suppressed = await tx
        .select({ id: notificationSuppressions.id })
        .from(notificationSuppressions)
        .where(
          and(
            eq(notificationSuppressions.tenantId, tenantId),
            eq(notificationSuppressions.emailHash, emailHash),
          ),
        )
        .limit(1);

      if (suppressed.length > 0) {
        await tx
          .update(notifications)
          .set({ status: 'suppressed', attempts: sql`${notifications.attempts} + 1` })
          .where(eq(notifications.id, notifId));

        this.logger.log('Notification suppressed (bounce/complaint list)', {
          tenantId,
          notifId,
          templateKey,
          traceId,
        });
        return;
      }

      // ── Rate limit ─────────────────────────────────────────────────────────
      const rateCheck = await this.tokenBucket.consume(tenantId);
      if (!rateCheck.allowed) {
        // Throw to return the message to the queue via visibility timeout.
        // SQS will redeliver after the visibility window; we do NOT consume a
        // DLQ slot for rate-limit backpressure.
        throw new RateLimitError(tenantId, rateCheck.retryAfterMs);
      }

      // ── Template rendering ─────────────────────────────────────────────────
      const templateVars: Record<string, unknown> = {
        ...(envelope.payload ?? {}),
        tenantId,
        ticketId: envelope.ticketId,
      };

      const rendered = await this.templateService.render(
        templateKey,
        templateVars as never,
        'en',
      );

      // ── Email send ─────────────────────────────────────────────────────────
      try {
        const result = await this.emailSender.send({
          to: recipientEmail,
          subject: rendered.subject,
          htmlBody: rendered.htmlBody,
          textBody: rendered.textBody,
          referenceId: notifId,
        });

        await tx
          .update(notifications)
          .set({
            status: 'sent',
            providerMessageId: result.messageId,
            sentAt: new Date(),
            attempts: sql`${notifications.attempts} + 1`,
          })
          .where(eq(notifications.id, notifId));

        this.logger.log('Notification sent', {
          tenantId,
          notifId,
          templateKey,
          traceId,
          outcome: 'sent',
        });
      } catch (sendErr) {
        const { errorClass, errorCode } = classifyError(sendErr);

        await tx
          .update(notifications)
          .set({
            status: errorClass === SesErrorClass.TERMINAL ? 'failed' : 'queued',
            errorCode,
            attempts: sql`${notifications.attempts} + 1`,
          })
          .where(eq(notifications.id, notifId));

        this.logger.warn('Notification send failed', {
          tenantId,
          notifId,
          templateKey,
          errorClass,
          errorCode,
          traceId,
          outcome: 'failed',
        });

        if (errorClass === SesErrorClass.RETRYABLE) {
          // Re-throw so SQS returns the message to the queue for retry.
          throw sendErr;
        }
        // Terminal error: row is marked failed; message is ACK'd.
      }
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

export class RateLimitError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly retryAfterMs: number,
  ) {
    super(`Rate limit exceeded for tenant ${tenantId}; retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitError';
  }
}

function classifyError(err: unknown): { errorClass: SesErrorClass; errorCode: string } {
  if (err instanceof SESv2ServiceException) {
    return { errorClass: classifySesError(err), errorCode: err.name };
  }
  return { errorClass: SesErrorClass.RETRYABLE, errorCode: 'UNKNOWN' };
}
