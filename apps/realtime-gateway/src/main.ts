/**
 * Realtime Gateway – entry point.
 *
 * Starts a NestJS application on port 8081 (configurable via PORT env var).
 * Uses a custom WsAdapter (ws library, not socket.io) bound to the HTTP server.
 * Only /ws/v1/dashboard accepts WebSocket upgrades; /healthz and /readyz are
 * plain HTTP; all other paths return 404 or 503 (upgrade rejection).
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from './gateway/ws.adapter';
import { DashboardGateway } from './gateway/dashboard.gateway';
import type * as http from 'http';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  // Custom ws adapter — must be applied before listen()
  const wsAdapter = new WsAdapter(app);
  app.useWebSocketAdapter(wsAdapter);

  const port = parseInt(process.env['PORT'] ?? '8081', 10);
  const drainGraceMs = parseInt(process.env['DRAIN_GRACE_MS'] ?? '20000', 10);

  await app.listen(port);

  // Wire upgrade handler so only /ws/v1/dashboard upgrades are accepted
  const httpServer = app.getHttpServer() as http.Server;
  wsAdapter.bindUpgradeHandler(httpServer, (_req, socket) => {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  });

  const gateway = app.get(DashboardGateway);

  // ── Graceful drain on SIGTERM ─────────────────────────────────────────────
  process.on('SIGTERM', () => {
    gateway.startDrain(drainGraceMs);
    setTimeout(async () => {
      await app.close();
      process.exit(0);
    }, drainGraceMs + 1_000);
  });

  console.log(`Realtime Gateway listening on port ${port}`);
}

void bootstrap();
