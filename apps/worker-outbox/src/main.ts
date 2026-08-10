/**
 * Outbox worker entry point.
 *
 * Standalone deployable process that:
 *   1. Validates required configuration.
 *   2. Selects the publisher adapter based on NODE_ENV / PUBLISHER_ADAPTER.
 *   3. Starts the drain service loop (500ms tick, batch 200).
 *   4. Starts the health/metrics HTTP server on HEALTH_PORT (default 9090).
 *   5. Handles SIGTERM and SIGINT for graceful shutdown (finishes in-flight
 *      batch, then exits).
 *
 * Environment variables:
 *   DATABASE_URL         — PostgreSQL connection string (required)
 *   PUBLISHER_ADAPTER    — 'logging' | 'in-memory' (default: 'logging')
 *   DRAIN_INTERVAL_MS    — drain loop interval in ms (default: 500)
 *   DRAIN_BATCH_SIZE     — max rows per iteration (default: 200)
 *   DRAIN_TX_BUDGET_MS   — max transaction open time in ms (default: 5000)
 *   HEALTH_PORT          — HTTP health server port (default: 9090)
 *   HEARTBEAT_INTERVAL_S — metrics heartbeat log interval in seconds (default: 30)
 */

import { DrainService } from './drain.service.js';
import { startHealthServer } from './health.js';
import { metrics } from './metrics.js';
import {
  LoggingPublisher,
  InMemoryPublisher,
} from '@opsninja/shared/messaging';
import type { PublisherPort } from '@opsninja/shared/messaging';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  console.error(JSON.stringify({ level: 'fatal', msg: 'DATABASE_URL is required' }));
  process.exit(1);
}

const PUBLISHER_ADAPTER = process.env['PUBLISHER_ADAPTER'] ?? 'logging';
const DRAIN_INTERVAL_MS = parseInt(process.env['DRAIN_INTERVAL_MS'] ?? '500', 10);
const DRAIN_BATCH_SIZE = parseInt(process.env['DRAIN_BATCH_SIZE'] ?? '200', 10);
const DRAIN_TX_BUDGET_MS = parseInt(process.env['DRAIN_TX_BUDGET_MS'] ?? '5000', 10);
const HEALTH_PORT = parseInt(process.env['HEALTH_PORT'] ?? '9090', 10);
const HEARTBEAT_INTERVAL_S = parseInt(process.env['HEARTBEAT_INTERVAL_S'] ?? '30', 10);

// ---------------------------------------------------------------------------
// Publisher adapter selection
// ---------------------------------------------------------------------------

function createPublisher(adapter: string): PublisherPort {
  switch (adapter) {
    case 'in-memory':
      return new InMemoryPublisher();
    case 'logging':
    default:
      return new LoggingPublisher();
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let drainIterationsCompleted = 0;

const publisher = createPublisher(PUBLISHER_ADAPTER);
const drain = new DrainService({
  connectionString: DATABASE_URL,
  publisher,
  intervalMs: DRAIN_INTERVAL_MS,
  batchSize: DRAIN_BATCH_SIZE,
  txBudgetMs: DRAIN_TX_BUDGET_MS,
});

const health = startHealthServer({
  port: HEALTH_PORT,
  isReady: () => drainIterationsCompleted > 0,
});

// Heartbeat log for stall detection.
const heartbeatTimer = setInterval(
  () => metrics.emitHeartbeat(),
  HEARTBEAT_INTERVAL_S * 1_000,
);

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

let stopping = false;

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;

  console.log(JSON.stringify({ level: 'info', msg: 'outbox.worker.shutdown', signal }));
  clearInterval(heartbeatTimer);

  // Stop drain (waits for in-flight batch to complete).
  await drain.stop();
  await health.close();

  console.log(JSON.stringify({ level: 'info', msg: 'outbox.worker.exit', signal }));
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'uncaughtException', err: String(err) }));
  void shutdown('uncaughtException');
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log(
  JSON.stringify({
    level: 'info',
    msg: 'outbox.worker.starting',
    publisher: publisher.name,
    drainIntervalMs: DRAIN_INTERVAL_MS,
    drainBatchSize: DRAIN_BATCH_SIZE,
    healthPort: HEALTH_PORT,
  }),
);

// Patch drain runOnce to track iteration count for readiness probe.
const originalRunOnce = drain.runOnce.bind(drain);
(drain as unknown as { runOnce: typeof drain.runOnce }).runOnce = async (...args: Parameters<typeof drain.runOnce>) => {
  const result = await originalRunOnce(...args);
  drainIterationsCompleted++;
  return result;
};

drain.start();
