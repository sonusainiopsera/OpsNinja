/**
 * Unit tests: MetricsRegistry — metric registration, instrumentation and
 * cardinality enforcement (WO-071 AC10).
 *
 * Coverage:
 *  - Duplicate registration is safe (idempotent)
 *  - Counter registration and increment
 *  - Gauge registration and set/inc
 *  - Histogram registration and observe
 *  - High-cardinality label guard: counters MUST NOT use tenantId/ticketId/userId
 *  - Gauges with allowTenantLabel=true ARE allowed to use tenantId
 *  - toPrometheusText() emits correct exposition format
 *  - getRegistry() singleton factory per component
 *  - _resetRegistriesForTesting() clears state
 *  - Unregistered metric operations are silently ignored (never throw)
 *  - LATENCY_BUCKETS_S and LAG_BUCKETS_MS are well-formed
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MetricsRegistry,
  getRegistry,
  _resetRegistriesForTesting,
  LATENCY_BUCKETS_S,
  LAG_BUCKETS_MS,
} from './metrics-registry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistry(component = 'test-component'): MetricsRegistry {
  return new MetricsRegistry(component);
}

// ---------------------------------------------------------------------------
// Duplicate registration
// ---------------------------------------------------------------------------

describe('MetricsRegistry — duplicate registration', () => {
  it('is safe to register the same metric name twice (idempotent)', () => {
    const reg = makeRegistry();
    reg.register({ name: 'my_counter', help: 'help', type: 'counter', labelNames: [] });
    expect(() => {
      reg.register({ name: 'my_counter', help: 'different help', type: 'counter', labelNames: [] });
    }).not.toThrow();
  });

  it('retains the first definition after a duplicate call', () => {
    const reg = makeRegistry();
    reg.register({ name: 'my_gauge', help: 'first', type: 'gauge', labelNames: [] });
    reg.register({ name: 'my_gauge', help: 'second', type: 'gauge', labelNames: [] });
    reg.set('my_gauge', {}, 42);
    const text = reg.toPrometheusText();
    expect(text).toContain('# HELP my_gauge first');
    expect(text).not.toContain('# HELP my_gauge second');
  });
});

// ---------------------------------------------------------------------------
// Cardinality guard — counters
// ---------------------------------------------------------------------------

describe('MetricsRegistry — cardinality guard on counters', () => {
  it('throws when counter uses tenantId label', () => {
    const reg = makeRegistry();
    expect(() => {
      reg.register({
        name: 'bad_counter',
        help: 'bad',
        type: 'counter',
        labelNames: ['tenantId'],
      });
    }).toThrow(/tenantId/);
  });

  it('throws when counter uses ticketId label', () => {
    const reg = makeRegistry();
    expect(() => {
      reg.register({
        name: 'bad_counter_ticket',
        help: 'bad',
        type: 'counter',
        labelNames: ['event_type', 'ticketId'],
      });
    }).toThrow(/ticketId/);
  });

  it('throws when counter uses userId label', () => {
    const reg = makeRegistry();
    expect(() => {
      reg.register({
        name: 'bad_counter_user',
        help: 'bad',
        type: 'counter',
        labelNames: ['userId'],
      });
    }).toThrow(/userId/);
  });

  it('allows low-cardinality labels (event_type, outcome, component) on counters', () => {
    const reg = makeRegistry();
    expect(() => {
      reg.register({
        name: 'ok_counter',
        help: 'ok',
        type: 'counter',
        labelNames: ['event_type', 'outcome', 'component'],
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Cardinality guard — gauges with allowTenantLabel
// ---------------------------------------------------------------------------

describe('MetricsRegistry — gauges with allowTenantLabel', () => {
  it('allows tenantId label on gauge when allowTenantLabel=true', () => {
    const reg = makeRegistry();
    expect(() => {
      reg.register({
        name: 'tenant_gauge',
        help: 'per-tenant gauge',
        type: 'gauge',
        labelNames: ['tenantId', 'counter'],
        allowTenantLabel: true,
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Counter — inc
// ---------------------------------------------------------------------------

describe('MetricsRegistry — counter inc()', () => {
  let reg: MetricsRegistry;

  beforeEach(() => {
    reg = makeRegistry();
    reg.register({
      name: 'events_total',
      help: 'total events',
      type: 'counter',
      labelNames: ['event_type', 'outcome'],
    });
  });

  it('increments from zero on first call', () => {
    reg.inc('events_total', { event_type: 'ticket.created', outcome: 'applied' });
    const text = reg.toPrometheusText();
    expect(text).toContain('events_total{event_type="ticket.created",outcome="applied"} 1');
  });

  it('accumulates increments for the same label set', () => {
    reg.inc('events_total', { event_type: 'ticket.created', outcome: 'applied' });
    reg.inc('events_total', { event_type: 'ticket.created', outcome: 'applied' });
    reg.inc('events_total', { event_type: 'ticket.created', outcome: 'applied' });
    const text = reg.toPrometheusText();
    expect(text).toContain('events_total{event_type="ticket.created",outcome="applied"} 3');
  });

  it('tracks distinct label sets independently', () => {
    reg.inc('events_total', { event_type: 'ticket.created', outcome: 'applied' });
    reg.inc('events_total', { event_type: 'ticket.updated', outcome: 'error' });
    const text = reg.toPrometheusText();
    expect(text).toContain('events_total{event_type="ticket.created",outcome="applied"} 1');
    expect(text).toContain('events_total{event_type="ticket.updated",outcome="error"} 1');
  });

  it('accepts an explicit value > 1', () => {
    reg.inc('events_total', { event_type: 'tick', outcome: 'applied' }, 5);
    const text = reg.toPrometheusText();
    expect(text).toContain('events_total{event_type="tick",outcome="applied"} 5');
  });

  it('silently ignores inc() for unregistered metric (never throws)', () => {
    expect(() => {
      reg.inc('nonexistent_metric', { label: 'value' });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Gauge — set and inc
// ---------------------------------------------------------------------------

describe('MetricsRegistry — gauge set()', () => {
  let reg: MetricsRegistry;

  beforeEach(() => {
    reg = makeRegistry();
    reg.register({
      name: 'active_connections',
      help: 'active connections',
      type: 'gauge',
      labelNames: ['pod'],
    });
  });

  it('sets the gauge to the given value', () => {
    reg.set('active_connections', { pod: 'pod-0' }, 42);
    const text = reg.toPrometheusText();
    expect(text).toContain('active_connections{pod="pod-0"} 42');
  });

  it('overwrites an earlier set', () => {
    reg.set('active_connections', { pod: 'pod-0' }, 100);
    reg.set('active_connections', { pod: 'pod-0' }, 17);
    const text = reg.toPrometheusText();
    expect(text).toContain('active_connections{pod="pod-0"} 17');
    expect(text).not.toContain('100');
  });

  it('tracks multiple label sets independently', () => {
    reg.set('active_connections', { pod: 'pod-0' }, 10);
    reg.set('active_connections', { pod: 'pod-1' }, 20);
    const text = reg.toPrometheusText();
    expect(text).toContain('active_connections{pod="pod-0"} 10');
    expect(text).toContain('active_connections{pod="pod-1"} 20');
  });

  it('silently ignores set() on a counter', () => {
    reg.register({ name: 'a_counter', help: 'c', type: 'counter', labelNames: [] });
    expect(() => reg.set('a_counter', {}, 99)).not.toThrow();
  });

  it('silently ignores set() for unregistered metric', () => {
    expect(() => reg.set('nonexistent', {}, 5)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Histogram — observe
// ---------------------------------------------------------------------------

describe('MetricsRegistry — histogram observe()', () => {
  let reg: MetricsRegistry;

  beforeEach(() => {
    reg = makeRegistry();
    reg.register({
      name:       'request_duration_seconds',
      help:       'request latency',
      type:       'histogram',
      labelNames: ['method'],
      buckets:    [0.05, 0.1, 0.5, 1.0],
    });
  });

  it('emits _bucket, _sum and _count lines in Prometheus text format', () => {
    reg.observe('request_duration_seconds', { method: 'GET' }, 0.07);
    const text = reg.toPrometheusText();
    expect(text).toContain('# TYPE request_duration_seconds histogram');
    expect(text).toContain('request_duration_seconds_bucket');
    expect(text).toContain('request_duration_seconds_sum');
    expect(text).toContain('request_duration_seconds_count');
  });

  it('correctly buckets an observation below the first bucket', () => {
    reg.observe('request_duration_seconds', { method: 'GET' }, 0.03);
    const text = reg.toPrometheusText();
    // 0.03 <= 0.05, so the 0.05 bucket count is 1
    expect(text).toMatch(/request_duration_seconds_bucket\{[^}]*le="0.05"[^}]*\} 1/);
    // 0.03 <= 0.1 too
    expect(text).toMatch(/request_duration_seconds_bucket\{[^}]*le="0.1"[^}]*\} 1/);
  });

  it('emits +Inf bucket with total count', () => {
    reg.observe('request_duration_seconds', { method: 'GET' }, 0.07);
    reg.observe('request_duration_seconds', { method: 'GET' }, 2.0);
    const text = reg.toPrometheusText();
    expect(text).toMatch(/request_duration_seconds_bucket\{[^}]*le="\+Inf"[^}]*\} 2/);
  });

  it('accumulates sum correctly', () => {
    reg.observe('request_duration_seconds', { method: 'GET' }, 0.1);
    reg.observe('request_duration_seconds', { method: 'GET' }, 0.3);
    const text = reg.toPrometheusText();
    expect(text).toMatch(/request_duration_seconds_sum.*0\.4/);
  });

  it('silently ignores observe() for unregistered metric', () => {
    expect(() => reg.observe('nonexistent', {}, 0.5)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// toPrometheusText — structure
// ---------------------------------------------------------------------------

describe('MetricsRegistry — toPrometheusText() structure', () => {
  it('includes HELP and TYPE lines for each metric', () => {
    const reg = makeRegistry();
    reg.register({ name: 'my_metric', help: 'A description', type: 'counter', labelNames: [] });
    reg.inc('my_metric');
    const text = reg.toPrometheusText();
    expect(text).toContain('# HELP my_metric A description');
    expect(text).toContain('# TYPE my_metric counter');
  });

  it('emits no label braces for metrics with no labels', () => {
    const reg = makeRegistry();
    reg.register({ name: 'no_labels', help: 'h', type: 'counter', labelNames: [] });
    reg.inc('no_labels');
    const text = reg.toPrometheusText();
    expect(text).toContain('no_labels 1');
    expect(text).not.toMatch(/no_labels\{/);
  });

  it('ends with a newline', () => {
    const reg = makeRegistry();
    reg.register({ name: 'c', help: 'h', type: 'counter', labelNames: [] });
    reg.inc('c');
    expect(reg.toPrometheusText()).toMatch(/\n$/);
  });

  it('returns only HELP/TYPE lines (no value lines) when no observations made', () => {
    const reg = makeRegistry();
    reg.register({ name: 'idle_counter', help: 'h', type: 'counter', labelNames: [] });
    const text = reg.toPrometheusText();
    expect(text).toContain('# HELP idle_counter');
    // No value line since nothing was incremented
    expect(text).not.toMatch(/^idle_counter /m);
  });
});

// ---------------------------------------------------------------------------
// getRegistry() singleton factory
// ---------------------------------------------------------------------------

describe('getRegistry() singleton factory', () => {
  beforeEach(() => {
    _resetRegistriesForTesting();
  });

  it('returns the same instance for the same component name', () => {
    const a = getRegistry('comp-a');
    const b = getRegistry('comp-a');
    expect(a).toBe(b);
  });

  it('returns different instances for different component names', () => {
    const a = getRegistry('comp-a');
    const b = getRegistry('comp-b');
    expect(a).not.toBe(b);
  });

  it('_resetRegistriesForTesting clears state so getRegistry returns a fresh instance', () => {
    const before = getRegistry('comp-reset');
    _resetRegistriesForTesting();
    const after = getRegistry('comp-reset');
    expect(before).not.toBe(after);
  });
});

// ---------------------------------------------------------------------------
// Standard bucket arrays
// ---------------------------------------------------------------------------

describe('LATENCY_BUCKETS_S and LAG_BUCKETS_MS', () => {
  it('LATENCY_BUCKETS_S is a non-empty strictly increasing array', () => {
    expect(LATENCY_BUCKETS_S.length).toBeGreaterThan(0);
    for (let i = 1; i < LATENCY_BUCKETS_S.length; i++) {
      expect(LATENCY_BUCKETS_S[i]).toBeGreaterThan(LATENCY_BUCKETS_S[i - 1]!);
    }
  });

  it('LATENCY_BUCKETS_S covers the 300ms SLO threshold (0.3s)', () => {
    expect(LATENCY_BUCKETS_S.some((b) => b >= 0.3)).toBe(true);
  });

  it('LAG_BUCKETS_MS is a non-empty strictly increasing array', () => {
    expect(LAG_BUCKETS_MS.length).toBeGreaterThan(0);
    for (let i = 1; i < LAG_BUCKETS_MS.length; i++) {
      expect(LAG_BUCKETS_MS[i]).toBeGreaterThan(LAG_BUCKETS_MS[i - 1]!);
    }
  });

  it('LAG_BUCKETS_MS covers the 10s freshness SLO (10000ms)', () => {
    expect(LAG_BUCKETS_MS.some((b) => b >= 10000)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Gateway metric inventory (AC2 cardinality verification)
// ---------------------------------------------------------------------------

describe('Gateway metric cardinality — tenantId not on high-cardinality counters', () => {
  it('rejects a simulated gateway counter with tenantId label', () => {
    const reg = makeRegistry('gateway-test');
    expect(() => {
      reg.register({
        name: 'realtime_frames_delivered_total',
        help: 'total frames delivered',
        type: 'counter',
        labelNames: ['frame_type', 'tenantId'], // tenantId FORBIDDEN on counter
      });
    }).toThrow();
  });

  it('accepts a simulated gateway counter with only approved labels', () => {
    const reg = makeRegistry('gateway-test-2');
    expect(() => {
      reg.register({
        name: 'realtime_frames_delivered_total_ok',
        help: 'total frames delivered',
        type: 'counter',
        labelNames: ['frame_type'],
      });
    }).not.toThrow();
  });
});
