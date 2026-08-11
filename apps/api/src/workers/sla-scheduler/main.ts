/**
 * SLA Scheduler Worker entry point — WO-046.
 *
 * Standalone NestJS application context (no HTTP adapter) + a minimal HTTP
 * server exposing /healthz and /readyz on HEALTH_PORT (default 3002).
 *
 * Environment variables:
 *   DATABASE_URL            — primary connection string (opsninja_app role)
 *   SCHEDULER_DATABASE_URL  — scheduler claim role connection (defaults to DATABASE_URL)
 *   SCHEDULER_POOL_SIZE     — claim pool size (default 5)
 *   HEALTH_PORT             — port for liveness/readiness probes (default 3002)
 *
 * Graceful shutdown:
 *   SIGTERM / SIGINT → stop accepting new ticks, drain current batch, close pool.
 *   terminationGracePeriodSeconds in the Kubernetes Deployment must be long enough
 *   to finish an in-flight 15-second tick (recommend 45 s).
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SchedulerModule } from './scheduler.module';
import { SchedulerService } from './scheduler.service';
import { startHealthServer } from './health.controller';

const logger = new Logger('SlaSchedulerMain');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SchedulerModule, {
    // Suppress NestJS bootstrap banner — not useful in a worker container log.
    logger: ['log', 'error', 'warn'],
  });

  const scheduler = app.get(SchedulerService);

  // Attach liveness/readiness probe server.
  const healthServer = startHealthServer(scheduler);

  // Graceful shutdown handler — stops new ticks and waits for current batch.
  let shutdownInProgress = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;

    logger.log(`Received ${signal} — draining SLA scheduler`);

    // SchedulerService.onModuleDestroy sets draining=true and clears the timer.
    healthServer.close();
    await app.close();

    logger.log('SLA scheduler stopped cleanly');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  // Unhandled rejection guard — log and exit so Kubernetes restarts the pod.
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled rejection — exiting', { reason: String(reason) });
    process.exit(1);
  });

  logger.log('SLA scheduler worker started', {
    healthPort: process.env['HEALTH_PORT'] ?? '3002',
    tickIntervalMs: 15_000,
  });
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error in SLA scheduler', err);
  process.exit(1);
});
