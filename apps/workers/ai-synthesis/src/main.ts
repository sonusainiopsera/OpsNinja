/**
 * AI Synthesis Worker entry point — WO-062.
 *
 * NestJS standalone application — no HTTP listener.
 * A lightweight HTTP /healthz probe server runs on HEALTH_PORT (default 3002).
 *
 * Required env:
 *   DATABASE_URL              PostgreSQL connection string
 *   AI_SYNTHESIS_QUEUE_URL    SQS queue URL subscribed to ticket.resolved SNS topic
 *   AWS_REGION                AWS region (default: us-east-1)
 *
 * Optional env:
 *   BEDROCK_MODEL_ID          Bedrock model ARN (default: claude-3-sonnet)
 *   AI_SYNTHESIS_BATCH_SIZE   SQS batch size (default: 5)
 *   HEALTH_PORT               Health probe port (default: 3002)
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WorkerModule } from './worker.module';

const logger = new Logger('main');

async function bootstrap(): Promise<void> {
  const required = ['DATABASE_URL', 'AI_SYNTHESIS_QUEUE_URL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });

  // Healthz probe — lightweight HTTP server on a separate port
  const healthPort = parseInt(process.env['HEALTH_PORT'] ?? '3002', 10);
  const healthServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  healthServer.listen(healthPort, () => {
    logger.log(`Health probe on :${healthPort}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`${signal} received — shutting down`);
    healthServer.close();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log('AI synthesis worker started');
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
