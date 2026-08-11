/**
 * Retention Worker — entry point.
 *
 * Invoked by a Kubernetes CronJob. Runs the nightly retention job once and exits.
 * A Redis distributed lock prevents concurrent runs from overlapping CronJob pods.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';
import { RetentionJob } from './retention.job';

const logger = new Logger('main');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: false,
  });

  // Healthz probe — lets Kubernetes confirm the pod is running.
  const healthPort = parseInt(process.env['HEALTH_PORT'] ?? '3002', 10);
  const healthServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  healthServer.listen(healthPort);

  logger.log('Retention worker started — running job');

  try {
    const job = app.get(RetentionJob);
    await job.run();
    logger.log('Retention job completed');
  } catch (err) {
    logger.error('Retention job failed', { error: (err as Error).message });
    process.exitCode = 1;
  } finally {
    healthServer.close();
    await app.close();
  }
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
