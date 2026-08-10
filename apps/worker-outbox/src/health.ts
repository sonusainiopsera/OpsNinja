/**
 * Health and readiness HTTP endpoints for the outbox worker.
 *
 * /healthz  — liveness probe: returns 200 as long as the process is alive.
 * /readyz   — readiness probe: returns 200 when the drain loop is running
 *             and has completed at least one iteration without error.
 * /metrics  — structured JSON snapshot of current outbox metrics.
 *
 * These are the only inbound HTTP surfaces on the worker process.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { metrics } from './metrics.js';

export interface HealthServerOptions {
  port?: number;
  isReady: () => boolean;
}

export function startHealthServer(opts: HealthServerOptions): { close: () => Promise<void> } {
  const { port = 9090, isReady } = opts;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const { url } = req;

    if (url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (url === '/readyz') {
      if (isReady()) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      } else {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('not ready');
      }
      return;
    }

    if (url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(metrics.snapshot(), null, 2));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });

  server.listen(port, () => {
    console.log(
      JSON.stringify({ level: 'info', msg: 'health.server.started', port }),
    );
  });

  return {
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
