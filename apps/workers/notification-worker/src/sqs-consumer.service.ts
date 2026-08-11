/**
 * SqsConsumerService — long-polling SQS consumer for qNotify.
 *
 * Long-poll: batchSize=10, waitTimeSeconds=20.
 * Graceful drain on SIGTERM: stop polling, wait for in-flight handlers to finish.
 *
 * Message routing (qNotify queue — SQS_QUEUE_URL):
 *  - type === 'notification' → NotificationHandler
 *  - type === 'ses_event'    → SesEventHandler (bounce/complaint)
 *  - unknown type            → logged and deleted
 *
 * SLA notifications queue (SLA_NOTIFICATIONS_SQS_URL):
 *  - eventType === 'sla.reminder_due' | 'sla.breached'
 *    routed to SlaReminderHandler after SNS envelope unwrapping.
 *  - SlaReminderPermanentError → delete immediately (invalid payload)
 *  - other errors              → exponential backoff via visibility change
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import { NotificationHandler, RateLimitExceededError, SesTerminalError } from './notification.handler';
import { SesEventHandler } from './ses-event.handler';
import { SlaReminderHandler, SlaReminderPermanentError } from './handlers/sla-reminder.handler';

const POLL_BATCH_SIZE = 10;
const WAIT_TIME_SECONDS = 20;

// SQS visibility timeout for retryable errors (seconds).
// Exponential backoff: attempt * 30s, capped at 900s (SQS max).
function visibilityForAttempt(attempt: number): number {
  return Math.min(30 * (attempt + 1), 900);
}

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly sqs: SQSClient;
  private running = false;
  private inFlightCount = 0;
  private drainResolve?: () => void;

  constructor(
    private readonly notificationHandler: NotificationHandler,
    private readonly sesEventHandler: SesEventHandler,
    private readonly slaReminderHandler: SlaReminderHandler,
  ) {
    this.sqs = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
  }

  onModuleInit(): void {
    this.running = true;
    void this.pollLoop(process.env['SQS_QUEUE_URL'], 'qNotify');
    // Start SLA notifications consumer only when the queue URL is configured.
    const slaQueueUrl = process.env['SLA_NOTIFICATIONS_SQS_URL'];
    if (slaQueueUrl) {
      void this.pollLoop(slaQueueUrl, 'sla-notifications');
    } else {
      this.logger.warn('SLA_NOTIFICATIONS_SQS_URL not set — SLA reminder consumer will not start');
    }
  }

  onModuleDestroy(): Promise<void> {
    this.running = false;
    this.logger.log('SIGTERM received — draining in-flight messages');
    if (this.inFlightCount === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
  }

  private decrementInFlight(): void {
    this.inFlightCount--;
    if (!this.running && this.inFlightCount === 0 && this.drainResolve) {
      this.drainResolve();
    }
  }

  private async pollLoop(queueUrl: string | undefined, label: string): Promise<void> {
    if (!queueUrl) {
      this.logger.error(`${label}: queue URL not set — consumer will not start`);
      return;
    }

    while (this.running) {
      try {
        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: POLL_BATCH_SIZE,
            WaitTimeSeconds: WAIT_TIME_SECONDS,
            AttributeNames: ['ApproximateReceiveCount'],
          }),
        );

        const messages = response.Messages ?? [];
        for (const msg of messages) {
          this.inFlightCount++;
          void this.processMessage(queueUrl, msg, label).finally(() => this.decrementInFlight());
        }
      } catch (err) {
        if (this.running) {
          this.logger.error(`${label}: SQS poll error — retrying in 5s`, { message: (err as Error).message });
          await new Promise((r) => setTimeout(r, 5_000));
        }
      }
    }
  }

  private async processMessage(
    queueUrl: string,
    msg: { Body?: string; ReceiptHandle?: string; Attributes?: Record<string, string> },
    label: string,
  ): Promise<void> {
    const body = msg.Body ?? '';
    const receiptHandle = msg.ReceiptHandle ?? '';
    const receiveCount = parseInt(msg.Attributes?.['ApproximateReceiveCount'] ?? '1', 10);

    if (label === 'sla-notifications') {
      return this.processSlaMessage(queueUrl, body, receiptHandle, receiveCount);
    }
    return this.processNotificationMessage(queueUrl, body, receiptHandle, receiveCount);
  }

  // ---------------------------------------------------------------------------
  // qNotify queue handler (existing routing)
  // ---------------------------------------------------------------------------

  private async processNotificationMessage(
    queueUrl: string,
    body: string,
    receiptHandle: string,
    receiveCount: number,
  ): Promise<void> {
    let messageType: string | undefined;
    try {
      const parsed = JSON.parse(body) as { type?: string };
      messageType = parsed.type;
    } catch {
      this.logger.error('Unparseable SQS message body — deleting');
      await this.deleteMessage(queueUrl, receiptHandle);
      return;
    }

    try {
      if (messageType === 'notification') {
        await this.notificationHandler.handleMessage(body);
      } else if (messageType === 'ses_event') {
        const parsed = JSON.parse(body) as { data?: { tenantId?: string; snsBody?: string } };
        const tenantId = parsed.data?.tenantId;
        const snsBody = parsed.data?.snsBody;
        if (!tenantId || !snsBody) {
          this.logger.warn('Malformed ses_event envelope — deleting');
        } else {
          await this.sesEventHandler.handleSesEvent(tenantId, snsBody);
        }
      } else {
        this.logger.warn('Unknown SQS message type — deleting', { type: messageType });
      }
      await this.deleteMessage(queueUrl, receiptHandle);
    } catch (err) {
      if (err instanceof RateLimitExceededError) {
        await this.changeVisibility(queueUrl, receiptHandle, 5);
        this.logger.log('Rate limited — requeuing', { receiveCount });
        return;
      }

      if (err instanceof SesTerminalError) {
        await this.deleteMessage(queueUrl, receiptHandle);
        return;
      }

      const backoff = visibilityForAttempt(receiveCount);
      this.logger.warn('Retryable error — backing off', {
        error: (err as Error).message,
        receiveCount,
        backoff_seconds: backoff,
      });
      await this.changeVisibility(queueUrl, receiptHandle, backoff);
    }
  }

  // ---------------------------------------------------------------------------
  // sla-notifications queue handler
  // ---------------------------------------------------------------------------

  private async processSlaMessage(
    queueUrl: string,
    body: string,
    receiptHandle: string,
    receiveCount: number,
  ): Promise<void> {
    try {
      await this.slaReminderHandler.handleMessage(body);
      await this.deleteMessage(queueUrl, receiptHandle);
    } catch (err) {
      if (err instanceof SlaReminderPermanentError) {
        // Invalid payload — permanently discard; DLQ will not receive it.
        this.logger.error('SLA reminder permanent error — deleting message', {
          reason: err.reason,
          message: err.message,
        });
        await this.deleteMessage(queueUrl, receiptHandle);
        return;
      }

      // Retryable — exponential backoff. After the redrive max, SQS moves
      // the message to sla-notifications-dlq automatically.
      const backoff = visibilityForAttempt(receiveCount);
      this.logger.warn('SLA reminder retryable error — backing off', {
        error: (err as Error).message,
        receiveCount,
        backoff_seconds: backoff,
      });
      await this.changeVisibility(queueUrl, receiptHandle, backoff);
    }
  }

  // ---------------------------------------------------------------------------
  // SQS helpers
  // ---------------------------------------------------------------------------

  private async deleteMessage(queueUrl: string, receiptHandle: string): Promise<void> {
    try {
      await this.sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
    } catch (err) {
      this.logger.error('Failed to delete SQS message', { message: (err as Error).message });
    }
  }

  private async changeVisibility(
    queueUrl: string,
    receiptHandle: string,
    seconds: number,
  ): Promise<void> {
    try {
      await this.sqs.send(
        new ChangeMessageVisibilityCommand({
          QueueUrl: queueUrl,
          ReceiptHandle: receiptHandle,
          VisibilityTimeout: seconds,
        }),
      );
    } catch (err) {
      this.logger.error('Failed to change SQS visibility', { message: (err as Error).message });
    }
  }
}
