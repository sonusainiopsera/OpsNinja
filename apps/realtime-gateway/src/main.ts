/**
 * Realtime Gateway — application entry point.
 *
 * Bootstraps a NestJS HTTP application (Express) and attaches the ws-based
 * WebSocket gateway to the underlying HTTP server. HTTP routes are limited to:
 *   GET /healthz   — liveness probe
 *   GET /readyz    — readiness probe
 *   GET /ws/v1/dashboard — WebSocket upgrade (handled by DashboardGateway)
 *
 * The process listens on PORT (default 8081) as specified in the architecture.
 *
 * Graceful shutdown on SIGTERM:
 *   1. Stop accepting new upgrades (set draining flag).
 *   2. Broadcast going_away frame to all connected sockets.
 *   3. Close all sockets within DRAIN_GRACE_MS (default 20s).
 *   4. Shut down NestJS application and exit.
 *
 * No token value, secret, or credential is ever committed or logged.
 * Redis credentials arrive via REDIS_URL environment variable at runtime.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { DashboardGateway } from './gateway/dashboard.gateway';

const PORT = parseInt(process.env['PORT'] ?? '8081', 10);
const DRAIN_GRACE_MS = parseInt(process.env['DRAIN_GRACE_MS'] ?? '20000', 10);

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    // Disable built-in WebSocket adapter — we manage ws directly.
    bodyParser: true,
  });

  // No global prefix — health probes must be at root.
  // No CORS — WebSocket upgrades use the Origin header; browsers enforce same-origin.

  await app.listen(PORT);

  // Attach WebSocket gateway to the underlying HTTP server AFTER listen() so
  // the server is bound to the port before we register upgrade handlers.
  const httpServer = app.getHttpServer() as import('http').Server;
  const gateway = app.get(DashboardGateway);
  gateway.attachToHttpServer(httpServer);

  logger.log(`Realtime Gateway listening on port ${PORT}`);
  logger.log('Serving: GET /healthz, GET /readyz, WS /ws/v1/dashboard');

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------

  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Received ${signal} — starting graceful drain`);
    try {
      await gateway.drain(DRAIN_GRACE_MS);
    } catch (err) {
      logger.error('Error during drain', { error: String(err) });
    }
    await app.close();
    logger.log('Realtime Gateway shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

bootstrap().catch((err: unknown) => {
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
