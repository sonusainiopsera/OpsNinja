/**
 * pipeline.metrics.ts — Dashboard Aggregator + Delta Publisher metric definitions.
 *
 * All metrics use the shared MetricsRegistry from @opsninja/observability to
 * enforce cardinality rules.
 *
 * Metric inventory (AC3):
 *   dashboard_events_consumed_total      — counter {event_type, outcome}
 *   dashboard_events_deduplicated_total  — counter {event_type}
 *   dashboard_event_lag_seconds          — histogram {} (no high-cardinality labels)
 *   dashboard_aggregate_drift            — gauge   {counter, tenant_bucket}
 *   dashboard_publish_interval_lag_ms    — gauge   {}
 *   dashboard_snapshot_source_total      — counter {source}
 *
 * Cardinality note (AC constraint):
 *   tenantId is FORBIDDEN on dashboard_events_consumed_total and
 *   dashboard_events_deduplicated_total (high-volume counters; 200+ tenants
 *   would create 200+ time series per event_type).
 *
 *   dashboard_aggregate_drift uses a tenant_bucket label (e.g. "bucket_0",
 *   "bucket_1", "other") that caps series to MAX_TENANT_BUCKETS + 1 regardless
 *   of tenant count.
 *
 * Internal /metrics listener:
 *   Starts on METRICS_PORT (default 9465), bound to 127.0.0.1 only.
 */

import { getRegistry, LAG_BUCKETS_MS } from '@opsninja/observability';

const COMPONENT = 'dashboard-aggregator';

const reg = getRegistry(COMPONENT);

/** Cap per-tenant drift series to this many buckets; excess → "other". */
const MAX_TENANT_BUCKETS = 50;
const tenantBucketMap    = new Map<string, string>();
let   bucketCounter      = 0;

function getTenantBucket(tenantId: string): string {
  if (tenantBucketMap.has(tenantId)) return tenantBucketMap.get(tenantId)!;
  if (bucketCounter < MAX_TENANT_BUCKETS) {
    const bucket = `bucket_${bucketCounter++}`;
    tenantBucketMap.set(tenantId, bucket);
    return bucket;
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Metric definitions
// ---------------------------------------------------------------------------

reg.register({
  name:       'dashboard_events_consumed_total',
  help:       'Total outbox events consumed by the dashboard aggregator',
  type:       'counter',
  labelNames: ['event_type', 'outcome'],
  // No tenantId — high-volume counter; cardinality guard enforced by registry
});

reg.register({
  name:       'dashboard_events_deduplicated_total',
  help:       'Total events skipped as duplicates (already applied to aggregate)',
  type:       'counter',
  labelNames: ['event_type'],
});

reg.register({
  name:       'dashboard_event_lag_seconds',
  help:       'Time between event occurredAt and aggregator processedAt (seconds)',
  type:       'histogram',
  labelNames: [],
  buckets:    LAG_BUCKETS_MS.map((ms) => ms / 1000),
});

reg.register({
  name:            'dashboard_aggregate_drift',
  help:            'Absolute difference between Redis and Postgres counter values (per reconcile cycle)',
  type:            'gauge',
  labelNames:      ['counter', 'tenant_bucket'],
  allowTenantLabel: true, // gauge — low-volume, bounded by tenant bucket cap
});

reg.register({
  name:       'dashboard_publish_interval_lag_ms',
  help:       'Milliseconds between scheduled publish interval and actual execution',
  type:       'gauge',
  labelNames: [],
});

reg.register({
  name:       'dashboard_snapshot_source_total',
  help:       'Total snapshot aggregates loaded from cache vs database',
  type:       'counter',
  labelNames: ['source'],
});

reg.register({
  name:       'dashboard_reconcile_cycles_total',
  help:       'Total reconciliation cycles completed',
  type:       'counter',
  labelNames: ['outcome'],
});

// ---------------------------------------------------------------------------
// Typed emission helpers
// ---------------------------------------------------------------------------

export function incEventsConsumed(eventType: string, outcome: 'applied' | 'deduplicated' | 'error'): void {
  reg.inc('dashboard_events_consumed_total', { event_type: eventType, outcome });
}

export function incEventsDeduplicated(eventType: string): void {
  reg.inc('dashboard_events_deduplicated_total', { event_type: eventType });
}

/**
 * Observe event lag. Clamps negative values to 0 and counts anomalies
 * separately (clock skew between components can produce negative lag).
 */
export function observeEventLag(occurredAtIso: string): void {
  const lagMs = Date.now() - new Date(occurredAtIso).getTime();
  const clampedMs = Math.max(0, lagMs);
  if (lagMs < 0) {
    // Count clock-skew anomalies separately (not in histogram)
    reg.inc('dashboard_events_consumed_total', { event_type: 'clock_skew_anomaly', outcome: 'applied' });
  }
  reg.observe('dashboard_event_lag_seconds', {}, clampedMs / 1000);
}

export function setAggregateDrift(tenantId: string, counter: string, drift: number): void {
  const bucket = getTenantBucket(tenantId);
  reg.set('dashboard_aggregate_drift', { counter, tenant_bucket: bucket }, drift);
}

export function setPublishIntervalLag(lagMs: number): void {
  reg.set('dashboard_publish_interval_lag_ms', {}, lagMs);
}

export function incSnapshotSource(source: 'cache' | 'database'): void {
  reg.inc('dashboard_snapshot_source_total', { source });
}

export function incReconcileCycles(outcome: 'success' | 'error'): void {
  reg.inc('dashboard_reconcile_cycles_total', { outcome });
}

/** Start the internal /metrics listener. Call once during bootstrap. */
export function startAggregatorMetricsServer(): () => void {
  const port = parseInt(process.env['METRICS_PORT'] ?? '9465', 10);
  return reg.startInternalMetricsServer(port);
}

export { reg as pipelineRegistry };
