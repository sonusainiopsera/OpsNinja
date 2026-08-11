/**
 * main.ts — bootstrap entry point for the jira-sync worker (WO-056).
 *
 * Creates a standalone NestJS application (no HTTP server), registers the
 * WorkerModule, and starts the SQS long-poll loop.
 *
 * Graceful shutdown:
 *   SIGTERM / SIGINT → NestJS close → WorkerModule.onModuleDestroy
 *                    → SqsConsumerService drains in-flight messages
 *
 * Required environment variables:
 *   DATABASE_URL           PostgreSQL connection string
 *   REDIS_URL              Redis connection string (defaults to localhost)
 *   JIRA_SYNC_QUEUE_URL    SQS queue URL for jira-sync events
 *   AWS_REGION             AWS region (defaults to us-east-1)
 *
 * Optional:
 *   NODE_ENV               Set to 'production' in production deployments
 *   LOG_LEVEL              Override log level (verbose | debug | log | warn | error)
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  logger.log('Starting jira-sync worker…');

  // Validate required environment variables
  const requiredEnv = ['DATABASE_URL', 'JIRA_SYNC_QUEUE_URL'];
  const missing = requiredEnv.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: (process.env['LOG_LEVEL'] as ('verbose' | 'debug' | 'log' | 'warn' | 'error') | undefined)
      ? [process.env['LOG_LEVEL'] as 'verbose' | 'debug' | 'log' | 'warn' | 'error']
      : ['log', 'warn', 'error'],
  });

  // Enable graceful shutdown hooks (SIGTERM, SIGINT)
  app.enableShutdownHooks();

  logger.log('jira-sync worker is running');
}

bootstrap().catch((err: unknown) => {
  logger.error('Fatal startup error', { error: (err as Error).message });
  process.exit(1);
});
