/**
 * Health and readiness HTTP probes for the SLA scheduler worker (WO-046).
 *
 * Exposed on HEALTH_PORT (default 3002) — a separate HTTP server from the
 * main NestJS application context so the scheduler worker does not need
 * a full Express/Fastify adapter.
 *
 * Endpoints:
 *   GET /healthz  — liveness probe; returns 200 OK while the process is alive
 *   GET /readyz   — readiness probe; returns 503 when lag > LAG_READY_THRESHOLD_SECONDS
 *                   or the database is unreachable
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { Logger } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';

const logger = new Logger('HealthController');

export function createHealthServer(scheduler: SchedulerService): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET') {
      res.writeHead(405);
      res.end('Method Not Allowed');
      return;
    }

    switch (req.url) {
      case '/healthz': {
        if (scheduler.isLive()) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'draining' }));
        }
        break;
      }

      case '/readyz': {
        const lagSeconds = scheduler.getLagSeconds();
        if (scheduler.isReady()) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ready', lagSeconds }));
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'not_ready',
            reason: lagSeconds > 0
              ? `lag ${lagSeconds.toFixed(1)}s exceeds threshold`
              : 'initialising',
            lagSeconds,
          }));
        }
        break;
      }

      default: {
        res.writeHead(404);
        res.end('Not Found');
      }
    }
  });

  return server;
}

export function startHealthServer(scheduler: SchedulerService): Server {
  const port = parseInt(process.env['HEALTH_PORT'] ?? '3002', 10);
  const server = createHealthServer(scheduler);

  server.listen(port, () => {
    logger.log(`Health probe listening on :${port}`);
  });

  server.on('error', (err: Error) => {
    logger.error('Health server error', err);
  });

  return server;
}
