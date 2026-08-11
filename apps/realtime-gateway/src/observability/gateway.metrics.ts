/**
 * gateway.metrics.ts — Realtime Gateway Prometheus metric definitions.
 *
 * All metrics registered here use the shared MetricsRegistry from
 * @opsninja/observability to enforce label cardinality rules.
 *
 * Metric inventory (AC2):
 *   realtime_connections_active        — gauge   {pod}
 *   realtime_connection_churn_total    — counter {reason, close_code}
 *   realtime_authz_denied_total        — counter {close_code}
 *   realtime_frames_delivered_total    — counter {frame_type}
 *   realtime_backfill_frames_total     — counter {}
 *   realtime_snapshot_required_total   — counter {reason}
 *   realtime_slow_consumer_drops_total — counter {}
 *   realtime_frame_delivery_seconds    — histogram {frame_type}
 *
 * Cardinality note:
 *   tenantId is NOT a label on any counter here — at 200+ tenants that would
 *   explode time-series cardinality. Per-tenant state is tracked via the
 *   aggregate drift gauge in pipeline.metrics.ts instead.
 *
 * Internal /metrics listener:
 *   Starts on METRICS_PORT (default 9464), bound to 127.0.0.1 only.
 */

import { getRegistry, LATENCY_BUCKETS_S } from '@opsninja/observability';

const COMPONENT = 'realtime-gateway';
const POD_NAME  = process.env['POD_NAME'] ?? 'local';

const reg = getRegistry(COMPONENT);

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

reg.register({
  name:       'realtime_connections_active',
  help:       'Number of active WebSocket connections on this pod',
  type:       'gauge',
  labelNames: ['pod'],
  // Pod label is low-cardinality (one series per pod replica)
});

reg.register({
  name:       'realtime_connection_churn_total',
  help:       'Total WebSocket connection close events',
  type:       'counter',
  labelNames: ['reason', 'close_code'],
});

reg.register({
  name:       'realtime_authz_denied_total',
  help:       'Total connection attempts denied at authorisation',
  type:       'counter',
  labelNames: ['close_code'],
});

reg.register({
  name:       'realtime_frames_delivered_total',
  help:       'Total frames delivered to connected clients',
  type:       'counter',
  labelNames: ['frame_type'],
});

reg.register({
  name:       'realtime_backfill_frames_total',
  help:       'Total backfill frames sent on reconnect',
  type:       'counter',
  labelNames: [],
});

reg.register({
  name:       'realtime_snapshot_required_total',
  help:       'Total times a snapshot frame was required instead of a delta',
  type:       'counter',
  labelNames: ['reason'],
});

reg.register({
  name:       'realtime_slow_consumer_drops_total',
  help:       'Total frames dropped because the consumer outbound queue was full',
  type:       'counter',
  labelNames: [],
});

reg.register({
  name:       'realtime_frame_delivery_seconds',
  help:       'Latency from frame generation to socket send (seconds)',
  type:       'histogram',
  labelNames: ['frame_type'],
  buckets:    LATENCY_BUCKETS_S,
});

// ---------------------------------------------------------------------------
// Typed emission helpers
// ---------------------------------------------------------------------------

export function setActiveConnections(count: number): void {
  reg.set('realtime_connections_active', { pod: POD_NAME }, count);
}

export function incConnectionChurn(reason: string, closeCode: string | number): void {
  reg.inc('realtime_connection_churn_total', { reason, close_code: String(closeCode) });
}

export function incAuthzDenied(closeCode: string | number): void {
  reg.inc('realtime_authz_denied_total', { close_code: String(closeCode) });
}

export function incFramesDelivered(frameType: 'delta' | 'snapshot' | 'hello' | 'going_away' | 'sla'): void {
  reg.inc('realtime_frames_delivered_total', { frame_type: frameType });
}

export function incBackfillFrames(): void {
  reg.inc('realtime_backfill_frames_total');
}

export function incSnapshotRequired(reason: 'oversized_delta' | 'drift_correction' | 'reconnect' | 'first_frame'): void {
  reg.inc('realtime_snapshot_required_total', { reason });
}

export function incSlowConsumerDrops(): void {
  reg.inc('realtime_slow_consumer_drops_total');
}

export function observeFrameDelivery(frameType: string, latencySeconds: number): void {
  reg.observe('realtime_frame_delivery_seconds', { frame_type: frameType }, latencySeconds);
}

/** Start the internal /metrics listener. Call once during bootstrap. */
export function startGatewayMetricsServer(): () => void {
  const port = parseInt(process.env['METRICS_PORT'] ?? '9464', 10);
  return reg.startInternalMetricsServer(port);
}

export { reg as gatewayRegistry };
