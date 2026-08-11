/**
 * Webhook Delivery Worker entry point.
 *
 * NestJS standalone application — no HTTP listener.
 * A health probe HTTP server runs on HEALTH_PORT (default 3002).
 *
 * KEDA ScaledObject targets WEBHOOK_SQS_QUEUE_URL queue depth.
 * Graceful drain on SIGTERM: SqsConsumerService.onModuleDestroy waits
 * for in-flight deliveries before the process exits.
 */

import { NestFactory } from '@nestjs/core';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WorkerModule } from './worker.module';
import { Logger } from '@nestjs/common';
import { createLogger } from '@opsninja/observability';

const logger = new Logger('main');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: createLogger({ context: 'WebhookWorker' }),
  });

  const healthPort = parseInt(process.env['HEALTH_PORT'] ?? '3002', 10);
  const healthServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  healthServer.listen(healthPort, () => {
    logger.log(`Webhook worker health probe on :${healthPort}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal} — shutting down webhook worker`);
    healthServer.close();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err: Error) => {
  console.error('Failed to start webhook worker', err);
  process.exit(1);
});
