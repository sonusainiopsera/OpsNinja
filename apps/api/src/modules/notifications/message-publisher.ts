/**
 * MessagePublisher — WO-081.
 *
 * Publishes resolved DeliveryIntents to the email SQS queue and, when the
 * tenant has matching webhook subscriptions, to the webhook SQS queue.
 *
 * The outbox_event_id is propagated as the idempotency key so both queues
 * can detect duplicate deliveries if the resolver is retried.
 *
 * This is a thin port — the concrete implementation either calls SQS directly
 * (production) or captures calls in memory (tests / local).
 */

import { Injectable, Logger } from '@nestjs/common';
import type { DeliveryIntent } from './notification-rule.resolver';

// ---------------------------------------------------------------------------
// Port interface — allows InMemoryMessagePublisher for tests
// ---------------------------------------------------------------------------

export interface MessagePublisherPort {
  publishEmailDelivery(intent: DeliveryIntent): Promise<void>;
  publishWebhookDelivery(tenantId: string, eventType: string, payload: unknown, outboxEventId: string): Promise<void>;
}

export const MESSAGE_PUBLISHER = Symbol('MESSAGE_PUBLISHER');

// ---------------------------------------------------------------------------
// SQS envelope shapes
// ---------------------------------------------------------------------------

export interface EmailDeliveryMessage {
  version: '1';
  type: 'notification';
  data: {
    tenantId: string;
    dedupeKey: string;
    templateKey: string;
    channel: 'email';
    recipientEmail: string;
    recipientContactId?: string;
    ticketId?: string;
    locale: string;
    payload: unknown;
    outboxTraceId?: string;
  };
}

// ---------------------------------------------------------------------------
// SQS implementation
// ---------------------------------------------------------------------------

@Injectable()
export class SqsMessagePublisher implements MessagePublisherPort {
  private readonly logger = new Logger(SqsMessagePublisher.name);

  private get emailQueueUrl(): string {
    return process.env['NOTIFICATION_EMAIL_QUEUE_URL'] ?? '';
  }

  private get webhookQueueUrl(): string {
    return process.env['NOTIFICATION_WEBHOOK_QUEUE_URL'] ?? '';
  }

  async publishEmailDelivery(intent: DeliveryIntent): Promise<void> {
    const message: EmailDeliveryMessage = {
      version: '1',
      type: 'notification',
      data: {
        tenantId: intent.tenantId,
        dedupeKey: intent.dedupeKey,
        templateKey: intent.templateKey,
        channel: 'email',
        recipientEmail: intent.recipientEmail,
        recipientContactId: intent.recipientContactId,
        ticketId: intent.ticketId ?? undefined,
        locale: intent.locale,
        payload: intent.projectedPayload,
        outboxTraceId: intent.outboxEventId,
      },
    };

    if (!this.emailQueueUrl) {
      this.logger.warn('NOTIFICATION_EMAIL_QUEUE_URL not configured — email delivery skipped', {
        tenantId: intent.tenantId,
        dedupeKey: intent.dedupeKey,
      });
      return;
    }

    // Lazy-import SQS to avoid loading AWS SDK in test environments
    const { SQSClient, SendMessageCommand } = await import('@aws-sdk/client-sqs');
    const sqs = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: this.emailQueueUrl,
        MessageBody: JSON.stringify(message),
        MessageDeduplicationId: intent.dedupeKey, // FIFO dedup
        MessageGroupId: intent.tenantId,
      }),
    );

    this.logger.debug('Email delivery enqueued', {
      tenantId: intent.tenantId,
      templateKey: intent.templateKey,
      dedupeKey: intent.dedupeKey,
    });
  }

  async publishWebhookDelivery(
    tenantId: string,
    eventType: string,
    payload: unknown,
    outboxEventId: string,
  ): Promise<void> {
    if (!this.webhookQueueUrl) {
      return;
    }

    const { SQSClient, SendMessageCommand } = await import('@aws-sdk/client-sqs');
    const sqs = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: this.webhookQueueUrl,
        MessageBody: JSON.stringify({
          version: '1',
          tenantId,
          eventType,
          payload,
          idempotencyKey: outboxEventId,
        }),
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests / local dev)
// ---------------------------------------------------------------------------

export class InMemoryMessagePublisher implements MessagePublisherPort {
  readonly emailMessages: EmailDeliveryMessage[] = [];
  readonly webhookMessages: Array<{ tenantId: string; eventType: string; payload: unknown; idempotencyKey: string }> = [];

  async publishEmailDelivery(intent: DeliveryIntent): Promise<void> {
    this.emailMessages.push({
      version: '1',
      type: 'notification',
      data: {
        tenantId: intent.tenantId,
        dedupeKey: intent.dedupeKey,
        templateKey: intent.templateKey,
        channel: 'email',
        recipientEmail: intent.recipientEmail,
        recipientContactId: intent.recipientContactId,
        ticketId: intent.ticketId ?? undefined,
        locale: intent.locale,
        payload: intent.projectedPayload,
        outboxTraceId: intent.outboxEventId,
      },
    });
  }

  async publishWebhookDelivery(
    tenantId: string,
    eventType: string,
    payload: unknown,
    outboxEventId: string,
  ): Promise<void> {
    this.webhookMessages.push({ tenantId, eventType, payload, idempotencyKey: outboxEventId });
  }

  reset(): void {
    this.emailMessages.length = 0;
    this.webhookMessages.length = 0;
  }
}
