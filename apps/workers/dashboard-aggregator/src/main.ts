/**
 * Dashboard Aggregator Worker — entry point.
 *
 * NestJS standalone application with no HTTP listener.
 * Health probe on HEALTH_PORT (default 3003).
 *
 * Required env:
 *   DATABASE_URL          — PostgreSQL connection string
 *   REDIS_URL             — Redis connection string
 *   DASHBOARD_QUEUE_URL   — SQS queue subscribed to the outbox SNS topic
 *   AWS_REGION            — AWS region (default: us-east-1)
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WorkerModule } from './worker.module';

const logger = new Logger('main');

async function bootstrap(): Promise<void> {
  const required = ['DATABASE_URL', 'REDIS_URL', 'DASHBOARD_QUEUE_URL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });

  const healthPort = parseInt(process.env['HEALTH_PORT'] ?? '3003', 10);
  const healthServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  healthServer.listen(healthPort, () => {
    logger.log(`Health probe on :${healthPort}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal} — shutting down`);
    healthServer.close();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log('Dashboard aggregator worker started');
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
