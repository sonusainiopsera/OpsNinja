/**
 * Notification Worker entry point.
 *
 * NestJS standalone application — no HTTP listener.
 * An HTTP /healthz probe server is attached on HEALTH_PORT (default 3001).
 */

import { NestFactory } from '@nestjs/core';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { WorkerModule } from './worker.module';
import { Logger } from '@nestjs/common';

const logger = new Logger('main');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'warn', 'error'],
  });

  // Healthz probe server — lightweight HTTP server on a separate port.
  const healthPort = parseInt(process.env['HEALTH_PORT'] ?? '3001', 10);
  const healthServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  healthServer.listen(healthPort, () => {
    logger.log(`Health probe listening on :${healthPort}`);
  });

  // Graceful shutdown on SIGTERM.
  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal} — shutting down`);
    healthServer.close();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log('Notification worker started');
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
