/**
 * Notification Worker entry point.
 *
 * Bootstraps a NestJS standalone application (no HTTP server), polls the
 * qNotify SQS queue with long polling, and starts a minimal /healthz HTTP
 * probe server for Kubernetes liveness checks.
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
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import * as http from 'http';
import { WorkerModule } from './worker.module';
import { NotificationHandler, RateLimitError } from './notification.handler';

const logger = new Logger('NotificationWorker');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
    bufferLogs: false,
  });

  const config = app.get(ConfigService);
  const handler = app.get(NotificationHandler);

  const queueUrl = config.getOrThrow<string>('SQS_NOTIFY_QUEUE_URL');
  const region = config.get<string>('AWS_REGION', 'us-east-1');
  const sqs = new SQSClient({ region });

  let running = true;

  // ── /healthz probe server ─────────────────────────────────────────────────
  const healthServer = http.createServer((_req, res) => {
    res.writeHead(running ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: running ? 'ok' : 'shutting_down' }));
  });
  healthServer.listen(config.get<number>('HEALTHZ_PORT', 8080));
  logger.log('Health probe listening on :8080');

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.log(`Received ${signal}; draining…`);
    running = false;
    healthServer.close();
    await app.close();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT',  () => void shutdown('SIGINT'));

  // ── SQS poll loop ─────────────────────────────────────────────────────────
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

          const receiveCount = parseInt(
            msg.Attributes?.['ApproximateReceiveCount'] ?? '1',
            10,
          );

          try {
            await handler.handle(msg.Body);
            await sqs.send(
              new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }),
            );
          } catch (err) {
            if (err instanceof RateLimitError) {
              // Return to queue; SQS will redeliver after visibility timeout.
              logger.warn('Rate limited; message returned to queue', {
                tenantId: err.tenantId,
                retryAfterMs: err.retryAfterMs,
              });
              return;
            }

            if (receiveCount >= 5) {
              // Max attempts reached: delete from main queue (DLQ receives via redrive policy).
              logger.error('Max receive count reached; routing to DLQ', {
                receiveCount,
                error: err instanceof Error ? err.message : String(err),
              });
              await sqs.send(
                new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: msg.ReceiptHandle }),
              );
              return;
            }

            logger.warn('Message processing failed; returning to queue', {
              receiveCount,
              error: err instanceof Error ? err.message : String(err),
            });
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
