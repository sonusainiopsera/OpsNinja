/**
 * SqsConsumerService — long-polling SQS consumer for webhook deliveries.
 *
 * Long-poll: batchSize=10, waitTimeSeconds=20.
 * Graceful drain on SIGTERM: stop polling, wait for in-flight handlers.
 * Retry backoff via ChangeMessageVisibility.
 * DLQ routing: messages exceeding MAX_ATTEMPTS land in the DLQ automatically
 * via SQS redrive policy — no explicit move needed.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import { DeliveryHandler } from './delivery.handler';

const POLL_BATCH_SIZE = 10;
const WAIT_TIME_SECONDS = 20;

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly sqs: SQSClient;
  private running = false;
  private inFlightCount = 0;
  private drainResolve?: () => void;

  constructor(private readonly handler: DeliveryHandler) {
    this.sqs = new SQSClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
  }

  onModuleInit(): void {
    this.running = true;
    void this.pollLoop();
  }

  onModuleDestroy(): Promise<void> {
    this.running = false;
    this.logger.log('SIGTERM — draining in-flight webhook deliveries');
    if (this.inFlightCount === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.drainResolve = resolve;
    });
  }

  private async pollLoop(): Promise<void> {
    const queueUrl = process.env['WEBHOOK_SQS_QUEUE_URL'] ?? '';

    while (this.running) {
      try {
        const response = await this.sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: POLL_BATCH_SIZE,
            WaitTimeSeconds: WAIT_TIME_SECONDS,
            MessageAttributeNames: ['All'],
          }),
        );

        const messages = response.Messages ?? [];
        await Promise.all(messages.map((msg) => this.processMessage(msg, queueUrl)));
      } catch (err) {
        this.logger.error('SQS poll error', { error: (err as Error).message });
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async processMessage(
    msg: { Body?: string; ReceiptHandle?: string },
    queueUrl: string,
  ): Promise<void> {
    if (!msg.Body || !msg.ReceiptHandle) return;

    this.inFlightCount++;
    try {
      const result = await this.handler.handleMessage(msg.Body);

      if (result.retry) {
        const { delaySeconds, nextAttempt } = result.retry;
        // For short delays (< 900s): use ChangeMessageVisibility.
        // For the 900s step: the SQS redrive will handle via DLQ or we re-enqueue.
        const visibility = Math.min(delaySeconds, 900);
        await this.sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: msg.ReceiptHandle,
            VisibilityTimeout: visibility,
          }),
        );
        this.logger.log('Retrying webhook delivery', {
          delaySeconds,
          nextAttempt,
        });
        return; // Don't delete — let it reappear after visibility timeout
      }

      // Success or permanent failure — delete the message
      await this.sqs.send(
        new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }),
      );
    } catch (err) {
      this.logger.error('Webhook delivery handler threw unexpectedly', {
        error: (err as Error).message,
      });
      // Let SQS redeliver via visibility timeout
    } finally {
      this.inFlightCount--;
      if (!this.running && this.inFlightCount === 0 && this.drainResolve) {
        this.drainResolve();
      }
    }
  }
}
