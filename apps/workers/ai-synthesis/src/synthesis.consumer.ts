/**
 * SynthesisConsumer — SQS long-polling consumer for the ai-synthesis queue.
 *
 * Config (AC-1):
 *   Long poll:          WaitTimeSeconds = 20
 *   Batch size:         MaxNumberOfMessages = 5 (configurable via AI_SYNTHESIS_BATCH_SIZE)
 *   Visibility timeout: 120s (>30s inference + retry overhead)
 *
 * Message routing:
 *   eventType == 'ticket.resolved'  → SynthesisService.handle()
 *   Missing tenantId or ticketId    → DLQ immediately (malformed)
 *   Other eventType                 → log + delete (unknown, no retry)
 *
 * KEDA metric (AC-1): worker logs queue-depth every poll cycle as a structured
 * metric line; the KEDA external scaler reads this from CloudWatch.
 *
 * Graceful drain (AC-7): SIGTERM stops polling; in-flight handlers complete
 * before the process exits.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { SynthesisService, type SynthesisMessage } from './synthesis.service';

const WAIT_TIME_SECONDS = 20;
const VISIBILITY_TIMEOUT = 120;
const POLL_ERROR_BACKOFF_MS = 5_000;

@Injectable()
export class SynthesisConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SynthesisConsumer.name);
  private readonly sqs: SQSClient;
  private readonly queueUrl: string;
  private readonly batchSize: number;

  private running = false;
  private inFlight = 0;
  private drainResolve?: () => void;

  constructor(private readonly synthesisService: SynthesisService) {
    this.sqs = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
    this.queueUrl = process.env['AI_SYNTHESIS_QUEUE_URL'] ?? '';
    this.batchSize = parseInt(process.env['AI_SYNTHESIS_BATCH_SIZE'] ?? '5', 10);
  }

  // --------------------------------------------------------------------------
  // NestJS lifecycle
  // --------------------------------------------------------------------------

  onModuleInit(): void {
    if (!this.queueUrl) {
      this.logger.error('AI_SYNTHESIS_QUEUE_URL not set — consumer will not start');
      return;
    }
    this.running = true;
    void this.pollLoop();
  }

  onModuleDestroy(): Promise<void> {
    this.logger.log('SIGTERM — draining in-flight messages');
    this.running = false;
    if (this.inFlight === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
  }

  // --------------------------------------------------------------------------
  // Poll loop
  // --------------------------------------------------------------------------

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        // Emit KEDA-compatible queue-depth metric
        void this.emitQueueDepth();

        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: this.batchSize,
            WaitTimeSeconds: WAIT_TIME_SECONDS,
            VisibilityTimeout: VISIBILITY_TIMEOUT,
            MessageAttributeNames: ['All'],
            AttributeNames: ['ApproximateReceiveCount', 'SentTimestamp'],
          }),
        );

        const messages = response.Messages ?? [];
        for (const sqsMsg of messages) {
          this.inFlight++;
          void this.processMessage(sqsMsg).finally(() => {
            this.inFlight--;
            if (!this.running && this.inFlight === 0 && this.drainResolve) {
              this.drainResolve();
            }
          });
        }
      } catch (err) {
        if (!this.running) break;
        this.logger.error('SQS poll error', { error: (err as Error).message });
        await new Promise((r) => setTimeout(r, POLL_ERROR_BACKOFF_MS));
      }
    }
  }

  // --------------------------------------------------------------------------
  // Per-message processing
  // --------------------------------------------------------------------------

  private async processMessage(sqsMsg: {
    MessageId?: string;
    Body?: string;
    ReceiptHandle?: string;
    Attributes?: Record<string, string>;
    MessageAttributes?: Record<string, { StringValue?: string }>;
  }): Promise<void> {
    const receiptHandle = sqsMsg.ReceiptHandle ?? '';
    const messageId = sqsMsg.MessageId ?? 'unknown';

    // ── Parse body ────────────────────────────────────────────────────────
    let msg: SynthesisMessage | null = null;
    try {
      msg = this.parseBody(sqsMsg.Body);
    } catch {
      this.logger.error('Malformed SQS body — sending to DLQ', { messageId });
      // Leave message visible → SQS DLQ policy moves it after maxReceiveCount
      await this.changeVisibility(receiptHandle, 0);
      return;
    }

    if (!msg) {
      this.logger.error('Null SQS body — deleting', { messageId });
      await this.deleteMessage(receiptHandle);
      return;
    }

    // ── Validate required fields ──────────────────────────────────────────
    if (!msg.tenantId || !msg.ticketId || !msg.eventId) {
      this.logger.error('Missing required message fields — DLQ', {
        messageId, tenantId: msg.tenantId, ticketId: msg.ticketId, eventId: msg.eventId,
      });
      await this.changeVisibility(receiptHandle, 0);
      return;
    }

    if (msg.eventType !== 'ticket.resolved') {
      this.logger.warn('Unknown eventType — deleting', { messageId, eventType: msg.eventType });
      await this.deleteMessage(receiptHandle);
      return;
    }

    // ── Queue age metric ──────────────────────────────────────────────────
    const sentTimestamp = sqsMsg.Attributes?.['SentTimestamp'];
    if (sentTimestamp) {
      const ageSeconds = (Date.now() - parseInt(sentTimestamp, 10)) / 1000;
      this.emitMetric('ai_queue_age_seconds', { tenantId: msg.tenantId, value: String(ageSeconds) });
    }

    // ── Handle ────────────────────────────────────────────────────────────
    try {
      const result = await this.synthesisService.handle(msg);

      if (result.shouldRetry) {
        // Retryable failure — leave in-flight; SQS redelivers after visibility timeout
        this.logger.warn('Retryable failure — leaving for redelivery', {
          tenantId: msg.tenantId, ticketId: msg.ticketId, outcome: result.outcome,
        });
        return;
      }

      // Success, skip, permanent failure — delete message (AC-7)
      await this.deleteMessage(receiptHandle);
    } catch (err) {
      this.logger.error('Unhandled error in synthesis handler', {
        messageId, tenantId: msg.tenantId, ticketId: msg.ticketId,
        error: (err as Error).message,
      });
      // Leave for redelivery
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private parseBody(raw?: string): SynthesisMessage {
    if (!raw) throw new Error('Empty SQS body');
    let outer: Record<string, unknown>;
    try {
      outer = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('Invalid JSON body');
    }

    // SNS fan-out wraps the real payload in a 'Message' string field
    if (typeof outer['Message'] === 'string') {
      outer = JSON.parse(outer['Message']) as Record<string, unknown>;
    }

    return {
      eventId: String(outer['eventId'] ?? ''),
      eventType: String(outer['eventType'] ?? ''),
      tenantId: String(outer['tenantId'] ?? ''),
      ticketId: String(outer['ticketId'] ?? ''),
      occurredAt: String(outer['occurredAt'] ?? ''),
      traceparent: typeof outer['traceparent'] === 'string' ? outer['traceparent'] : undefined,
    };
  }

  private async deleteMessage(receiptHandle: string): Promise<void> {
    try {
      await this.sqs.send(new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }));
    } catch (err) {
      this.logger.warn('Failed to delete SQS message', { error: (err as Error).message });
    }
  }

  private async changeVisibility(receiptHandle: string, seconds: number): Promise<void> {
    try {
      await this.sqs.send(new ChangeMessageVisibilityCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: seconds,
      }));
    } catch (err) {
      this.logger.warn('Failed to change visibility', { error: (err as Error).message });
    }
  }

  private async emitQueueDepth(): Promise<void> {
    try {
      const attrs = await this.sqs.send(new GetQueueAttributesCommand({
        QueueUrl: this.queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }));
      const depth = attrs.Attributes?.['ApproximateNumberOfMessages'] ?? '0';
      this.emitMetric('ai_synthesis_queue_depth', { value: depth });
    } catch {
      // Non-critical — KEDA can fall back to CloudWatch
    }
  }

  private emitMetric(name: string, labels: Record<string, string>): void {
    console.log(JSON.stringify({ metric: name, labels, value: 1, ts: Date.now() }));
  }
}
