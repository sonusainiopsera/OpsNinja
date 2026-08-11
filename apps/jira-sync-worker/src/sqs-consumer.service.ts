/**
 * SqsConsumerService — long-polling SQS consumer for the jira-sync queue.
 *
 * Message routing:
 *   source == 'jira-webhook'        → InboundHandler (Jira → OpsNinja)
 *   source == 'jira-reconciliation' → ReconciliationJob (WO-057)
 *   source == 'jira-outbound' (or absent/other) → OutboundHandler (OpsNinja → Jira)
 *
 * Backoff is enforced server-side via SQS visibility timeout extension; this
 * loop never sleeps.  On clean shutdown (SIGTERM) it stops polling, drains
 * in-flight messages, then resolves the graceful shutdown promise.
 *
 * Constraints:
 *   - Batch size: 1 (prevents head-of-line blocking in multi-tenant scenarios)
 *   - Wait time: 20 s (max long-poll to avoid tight-loop cost)
 *   - Visibility timeout: 60 s (gives plenty of time for the Jira HTTP calls)
 *   - Deletion on ack: only after successful or permanent-failed processing
 *     (transient errors leave the message in-flight for SQS to redeliver)
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { InboundHandler } from './inbound/inbound.handler';
import { OutboundHandler } from './outbound/outbound.handler';
import type { ReconciliationJob } from './reconciliation/reconciliation.job';
import type { JiraReconciliationMessage } from './reconciliation/reconciliation.job';

export interface SqsConsumerConfig {
  queueUrl: string;
  batchSize?: number;
  waitTimeSeconds?: number;
  visibilityTimeoutSeconds?: number;
}

@Injectable()
export class SqsConsumerService implements OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private running = false;
  private inFlightCount = 0;
  private shutdownResolve?: () => void;
  private readonly shutdownPromise: Promise<void>;
  private shutdownRequested = false;

  constructor(
    private readonly sqsClient: SQSClient,
    private readonly config: SqsConsumerConfig,
    private readonly inboundHandler: InboundHandler,
    private readonly outboundHandler: OutboundHandler,
    private readonly reconciliationJob?: ReconciliationJob,
  ) {
    this.shutdownPromise = new Promise<void>((resolve) => {
      this.shutdownResolve = resolve;
    });
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.logger.log('SQS consumer started', { queueUrl: this.config.queueUrl });
    void this.poll();
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('SIGTERM received — stopping SQS consumer');
    this.shutdownRequested = true;
    this.running = false;
    if (this.inFlightCount === 0) {
      this.shutdownResolve?.();
    }
    await this.shutdownPromise;
    this.logger.log('SQS consumer drained — shutdown complete');
  }

  // --------------------------------------------------------------------------
  // Poll loop
  // --------------------------------------------------------------------------

  private async poll(): Promise<void> {
    while (this.running && !this.shutdownRequested) {
      try {
        const result = await this.sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.config.queueUrl,
            MaxNumberOfMessages: this.config.batchSize ?? 1,
            WaitTimeSeconds: this.config.waitTimeSeconds ?? 20,
            VisibilityTimeout: this.config.visibilityTimeoutSeconds ?? 60,
            AttributeNames: ['ApproximateReceiveCount'],
            MessageAttributeNames: ['All'],
          }),
        );

        const messages = result.Messages ?? [];
        if (messages.length === 0) continue;

        // Process messages concurrently within the batch
        await Promise.all(messages.map((m) => this.processMessage(m)));
      } catch (err: unknown) {
        if (this.shutdownRequested) break;
        this.logger.error('SQS receive error', { error: (err as Error).message });
        // Brief backoff before retrying to avoid hammering a degraded SQS endpoint
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }

    if (this.shutdownRequested && this.inFlightCount === 0) {
      this.shutdownResolve?.();
    }
  }

  // --------------------------------------------------------------------------
  // Message processing
  // --------------------------------------------------------------------------

  private async processMessage(message: {
    MessageId?: string;
    Body?: string;
    ReceiptHandle?: string;
    Attributes?: Record<string, string>;
  }): Promise<void> {
    this.inFlightCount++;

    const receiptHandle = message.ReceiptHandle ?? '';
    const messageId = message.MessageId ?? 'unknown';
    let shouldDelete = false;

    try {
      const body = this.parseBody(message.Body);
      if (!body) {
        this.logger.warn('Unparseable SQS message — deleting', { messageId });
        shouldDelete = true;
        return;
      }

      const attemptNumber = parseInt(
        message.Attributes?.['ApproximateReceiveCount'] ?? '1', 10,
      ) - 1; // SQS is 1-indexed; we want 0-indexed

      const source: string = body['source'] ?? '';

      if (source === 'jira-webhook') {
        // Inbound: Jira → OpsNinja
        await this.inboundHandler.handle({
          tenantId: body['tenantId'] as string,
          webhookEventId: body['webhookEventId'] as string,
          receiptHandle,
        });
        shouldDelete = true;
      } else if (source === 'jira-reconciliation' && this.reconciliationJob) {
        // Reconciliation: hourly per-connection drift healing (WO-057)
        await this.reconciliationJob.handle(body as unknown as JiraReconciliationMessage);
        shouldDelete = true;
      } else {
        // Outbound: OpsNinja → Jira
        const result = await this.outboundHandler.handle({
          tenantId: body['tenantId'] as string,
          linkId: body['linkId'] as string,
          eventType: body['eventType'] as string,
          receiptHandle,
          attemptNumber,
        });

        // Delete on success, permanent failure, or skipped.
        // Retrying/rate_limited: leave in-flight; visibility timeout drives redelivery.
        shouldDelete = result.outcome === 'success'
          || result.outcome === 'failed'
          || result.outcome === 'skipped';
      }
    } catch (err: unknown) {
      this.logger.error('Unhandled error processing SQS message', {
        messageId,
        error: (err as Error).message,
      });
      // Leave message in-flight; SQS will redeliver after visibility timeout
    } finally {
      if (shouldDelete && receiptHandle) {
        await this.deleteMessage(receiptHandle, messageId);
      }
      this.inFlightCount--;
      if (this.shutdownRequested && this.inFlightCount === 0) {
        this.shutdownResolve?.();
      }
    }
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private parseBody(raw?: string): Record<string, unknown> | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // SNS fan-out wraps the actual payload in a Message field
      if (typeof parsed['Message'] === 'string') {
        return JSON.parse(parsed['Message']) as Record<string, unknown>;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async deleteMessage(receiptHandle: string, messageId: string): Promise<void> {
    try {
      await this.sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: this.config.queueUrl,
          ReceiptHandle: receiptHandle,
        }),
      );
    } catch (err: unknown) {
      this.logger.warn('Failed to delete SQS message', {
        messageId,
        error: (err as Error).message,
      });
    }
  }
}
