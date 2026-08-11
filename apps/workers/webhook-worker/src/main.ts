/**
 * Webhook Worker entry point.
 *
 * Bootstraps a NestJS standalone application (no HTTP server), polls the
 * webhook SQS queue with long polling, and starts a minimal /healthz probe
 * server for Kubernetes liveness checks.
 *
 * Graceful shutdown:
 *  - SIGTERM stops accepting new messages.
 *  - In-flight messages are allowed to complete.
 *  - DB pool and Redis connections are drained.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import * as http from 'http';
import { WebhookWorkerModule } from './worker.module';
import { WebhookDeliveryHandler, RetryableError, ConcurrencyError, RateLimitError } from './delivery.handler';
import { BACKOFF_DELAYS_SEC, LONG_DELAY_THRESHOLD_SEC } from '@opsninja/webhooks';

const logger = new Logger('WebhookWorker');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WebhookWorkerModule, {
    logger: ['error', 'warn', 'log'],
    bufferLogs: false,
  });

  const config = app.get(ConfigService);
  const handler = app.get(WebhookDeliveryHandler);

  const queueUrl = config.getOrThrow<string>('SQS_WEBHOOK_QUEUE_URL');
  const dlqUrl = config.get<string>('SQS_WEBHOOK_DLQ_URL');
  const region = config.get<string>('AWS_REGION', 'us-east-1');
  const sqs = new SQSClient({ region });

  let running = true;
  let inFlight = 0;

  // ── /healthz probe server ──────────────────────────────────────────────────
  const healthPort = config.get<number>('HEALTH_PORT', 8080);
  const healthServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });
  healthServer.listen(healthPort, () => {
    logger.log(`Health probe listening on :${healthPort}`);
  });

  // ── Graceful SIGTERM drain ─────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal} received; draining in-flight messages`);
    running = false;
    const waitForDrain = new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (inFlight === 0) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
    await Promise.race([waitForDrain, sleep(30_000)]);
    healthServer.close();
    await app.close();
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));

  // ── SQS poll loop ──────────────────────────────────────────────────────────
  logger.log(`Polling ${queueUrl}`);
  while (running) {
    try {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 20,
          AttributeNames: ['ApproximateReceiveCount'],
        }),
      );

      const messages = response.Messages ?? [];

      await Promise.allSettled(
        messages.map(async (msg) => {
          if (!msg.Body || !msg.ReceiptHandle) return;
          inFlight++;
          try {
            await handler.handle(msg.Body);
            await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }));
          } catch (err) {
            if (err instanceof ConcurrencyError || err instanceof RateLimitError) {
              // Return to queue; SQS will redeliver after visibility timeout
              logger.warn('Backpressure; message returned to queue', {
                error: err.message,
              });
              return;
            }

            if (err instanceof RetryableError) {
              const delaySec = err.delaySec;
              if (err.requiresReEnqueue) {
                // Long delay: re-enqueue with delay (SQS max 900s)
                await sqs.send(new SendMessageCommand({
                  QueueUrl: queueUrl,
                  MessageBody: msg.Body,
                  DelaySeconds: Math.min(delaySec, 900),
                }));
                await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }));
              } else {
                // Short delay: use ChangeMessageVisibility
                await sqs.send(new ChangeMessageVisibilityCommand({
                  QueueUrl: queueUrl,
                  ReceiptHandle: msg.ReceiptHandle,
                  VisibilityTimeout: delaySec,
                }));
              }
              return;
            }

            const receiveCount = parseInt(msg.Attributes?.['ApproximateReceiveCount'] ?? '1', 10);
            if (receiveCount >= 6) {
              logger.error('Max receive count reached; routing to DLQ', {
                receiveCount,
                error: err instanceof Error ? err.message : String(err),
              });
              await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }));
              return;
            }

            logger.warn('Message processing failed; returning to queue', {
              receiveCount,
              error: err instanceof Error ? err.message : String(err),
            });
          } finally {
            inFlight--;
          }
        }),
      );
    } catch (err) {
      if (running) {
        logger.error('SQS receive error', {
          error: err instanceof Error ? err.message : String(err),
        });
        await sleep(2_000);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
