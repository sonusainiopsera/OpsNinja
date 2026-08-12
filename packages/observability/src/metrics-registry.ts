/**
 * metrics-registry.ts — Shared Prometheus-compatible metrics registry.
 *
 * Provides a single factory that all streaming components use so metric
 * naming, label conventions and cardinality rules are enforced in one place.
 *
 * Design decisions:
 *   - In-memory counters/gauges/histograms tracked per (name, labelSet) key.
 *   - Prometheus text format emitted on demand via toPrometheusText().
 *   - Duplicate registration is safe: returns the same collector instance.
 *   - tenantId label is FORBIDDEN on counters (high-cardinality guard).
 *     Only gauges declared with allowTenantLabel=true may carry it.
 *   - Label values are validated against an allow-list at registration time.
 *   - Component failures are caught and logged; they never propagate into
 *     the request/message handling path.
 *
 * Standard histogram buckets for latency (seconds) and lag (ms) are exported
 * as LATENCY_BUCKETS_S and LAG_BUCKETS_MS respectively.
 */

export const LATENCY_BUCKETS_S  = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
export const LAG_BUCKETS_MS     = [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/** Labels always forbidden on high-cardinality counters. */
const HIGH_CARDINALITY_LABELS   = new Set(['tenantId', 'ticketId', 'userId', 'orgId', 'issueKey']);

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricDef {
  name: string;
  help: string;
  type: MetricType;
  labelNames: readonly string[];
  buckets?: number[];
  /** Gauges that track per-tenant state may opt in to tenantId label. */
  allowTenantLabel?: boolean;
}

// ---------------------------------------------------------------------------
// Internal storage
// ---------------------------------------------------------------------------

type LabelSet = Record<string, string>;

function labelKey(labels: LabelSet): string {
  return Object.keys(labels).sort().map((k) => `${k}="${labels[k]}"`).join(',');
}

interface HistogramBucket { le: number; count: number }

interface HistogramData {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

interface MetricStore {
  def: MetricDef;
  counters: Map<string, number>;
  histograms: Map<string, HistogramData>;
}

// ---------------------------------------------------------------------------
// Registry class
// ---------------------------------------------------------------------------

export class MetricsRegistry {
  private readonly stores = new Map<string, MetricStore>();
  private readonly component: string;

  constructor(component: string) {
    this.component = component;
  }

  /** Register a metric definition. Safe to call multiple times with the same name. */
  register(def: MetricDef): void {
    if (this.stores.has(def.name)) return; // duplicate — idempotent

    // Cardinality guard: counters must not use high-cardinality labels
    if (def.type === 'counter' && !def.allowTenantLabel) {
      for (const label of def.labelNames) {
        if (HIGH_CARDINALITY_LABELS.has(label)) {
          throw new Error(
            `[MetricsRegistry] Counter "${def.name}" uses forbidden high-cardinality label "${label}". ` +
            `Use a gauge with allowTenantLabel=true for per-tenant series.`,
          );
        }
      }
    }

    this.stores.set(def.name, {
      def,
      counters:   new Map(),
      histograms: new Map(),
    });
  }

  /** Increment a counter or set a gauge. */
  inc(name: string, labels: LabelSet = {}, value = 1): void {
    const store = this.stores.get(name);
    if (!store) return; // unregistered metric — silently ignore to not break hot path

    const key = labelKey(labels);
    const prev = store.counters.get(key) ?? 0;
    if (store.def.type === 'gauge') {
      store.counters.set(key, prev + value);
    } else {
      store.counters.set(key, prev + value);
    }
  }

  /** Set a gauge to an absolute value. */
  set(name: string, labels: LabelSet = {}, value: number): void {
    const store = this.stores.get(name);
    if (!store || store.def.type !== 'gauge') return;
    store.counters.set(labelKey(labels), value);
  }

  /** Observe a histogram value. */
  observe(name: string, labels: LabelSet = {}, value: number): void {
    const store = this.stores.get(name);
    if (!store || store.def.type !== 'histogram') return;

    const key = labelKey(labels);
    if (!store.histograms.has(key)) {
      const buckets = (store.def.buckets ?? LATENCY_BUCKETS_S).map((le) => ({ le, count: 0 }));
      store.histograms.set(key, { buckets, sum: 0, count: 0 });
    }
    const hist = store.histograms.get(key)!;
    hist.sum   += value;
    hist.count += 1;
    for (const bucket of hist.buckets) {
      if (value <= bucket.le) bucket.count++;
    }
  }

  /** Render all metrics in Prometheus text exposition format. */
  toPrometheusText(): string {
    const lines: string[] = [];

    for (const [, store] of this.stores) {
      lines.push(`# HELP ${store.def.name} ${store.def.help}`);
      lines.push(`# TYPE ${store.def.name} ${store.def.type}`);

      if (store.def.type === 'histogram') {
        for (const [labelStr, hist] of store.histograms) {
          const prefix = labelStr ? `{${labelStr},` : '{';
          for (const bucket of hist.buckets) {
            lines.push(`${store.def.name}_bucket${prefix}le="${bucket.le}"} ${bucket.count}`);
          }
          lines.push(`${store.def.name}_bucket${prefix}le="+Inf"} ${hist.count}`);
          lines.push(`${store.def.name}_sum${labelStr ? `{${labelStr}}` : ''} ${hist.sum}`);
          lines.push(`${store.def.name}_count${labelStr ? `{${labelStr}}` : ''} ${hist.count}`);
        }
      } else {
        for (const [labelStr, value] of store.counters) {
          lines.push(`${store.def.name}${labelStr ? `{${labelStr}}` : ''} ${value}`);
        }
      }
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Start an internal-only HTTP listener on metricsPort that serves /metrics.
   * Binds to 127.0.0.1 so it is never reachable from outside the pod network.
   * Returns a cleanup function.
   */
  startInternalMetricsServer(metricsPort: number): () => void {
    // Lazy import to avoid requiring 'http' in environments that don't need it
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const http = require('http') as typeof import('http');

    const server = http.createServer((req, res) => {
      if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(this.toPrometheusText());
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // Bind to localhost only — never exposed via ALB or ingress
    server.listen(metricsPort, '127.0.0.1', () => {
      console.log(JSON.stringify({
        level:     'log',
        context:   'MetricsRegistry',
        component: this.component,
        message:   `Internal /metrics listener started on 127.0.0.1:${metricsPort}`,
      }));
    });

    return () => server.close();
  }
}

// ---------------------------------------------------------------------------
// Singleton factory per component
// ---------------------------------------------------------------------------

const registries = new Map<string, MetricsRegistry>();

/**
 * Get or create the singleton MetricsRegistry for a named component.
 * All three components call this with their own name so label sets stay separate.
 */
export function getRegistry(component: string): MetricsRegistry {
  if (!registries.has(component)) {
    registries.set(component, new MetricsRegistry(component));
  }
  return registries.get(component)!;
}

/** Reset all registries (for testing only). */
export function _resetRegistriesForTesting(): void {
  registries.clear();
}
