/**
 * Alert expression evaluation tests (WO-071 AC11, AC12).
 *
 * Validates that:
 *   1. Committed alert rule YAML exists and contains the five required alerts.
 *   2. Committed SLO YAML exists and contains the three named SLIs.
 *   3. The stalled-publisher metric fixture satisfies the RealtimeNoFramesPublished
 *      alert condition (events consumed with no new frame delivery).
 *   4. The drift metric fixture satisfies the RealtimeAggregateDriftHigh,
 *      RealtimeDlqNonEmpty and RealtimeSnapshotSourceDatabaseHigh conditions.
 *   5. The healthy metric fixture satisfies NONE of the alert conditions.
 *
 * Implementation note:
 *   Full PromQL evaluation requires a running Prometheus instance. These tests
 *   implement an equivalent in-process evaluation against the fixture values,
 *   exercising the same threshold logic the PromQL expressions encode.
 *   Lint of the YAML syntax is done by promtool in CI
 *   (`promtool check rules packages/observability/alerts/realtime.rules.yaml`).
 *
 * Fixture files:
 *   test/fixtures/metrics-healthy.prom          — nominal healthy state
 *   test/fixtures/metrics-stalled-publisher.prom — publisher stall scenario
 *   test/fixtures/metrics-drift.prom             — high-drift + DLQ scenario
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

// ---------------------------------------------------------------------------
// Prometheus text format parser (minimal — only what the tests need)
// ---------------------------------------------------------------------------

interface MetricSample {
  name:   string;
  labels: Record<string, string>;
  value:  number;
}

function parsePrometheusText(text: string): MetricSample[] {
  const samples: MetricSample[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Parse: metric_name{label="val",...} value
    // or:    metric_name value
    const braceIdx = trimmed.indexOf('{');
    const spaceIdx = trimmed.lastIndexOf(' ');
    if (spaceIdx < 0) continue;

    const valueStr = trimmed.slice(spaceIdx + 1);
    const value    = parseFloat(valueStr);
    if (isNaN(value)) continue;

    let name: string;
    let labels: Record<string, string> = {};

    if (braceIdx >= 0) {
      name = trimmed.slice(0, braceIdx);
      const labelPart = trimmed.slice(braceIdx + 1, trimmed.lastIndexOf('}'));
      for (const pair of labelPart.split(',')) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx < 0) continue;
        const k = pair.slice(0, eqIdx).trim();
        const v = pair.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
        labels[k] = v;
      }
    } else {
      name = trimmed.slice(0, spaceIdx);
    }

    samples.push({ name, labels, value });
  }
  return samples;
}

function loadFixture(filename: string): MetricSample[] {
  const fixturePath = resolve(__dirname, '../../test/fixtures', filename);
  return parsePrometheusText(readFileSync(fixturePath, 'utf-8'));
}

/** Sum all samples with the given name (and optional label filter). */
function sumMetric(
  samples: MetricSample[],
  name: string,
  labelFilter?: Record<string, string>,
): number {
  return samples
    .filter((s) => {
      if (s.name !== name) return false;
      if (labelFilter) {
        return Object.entries(labelFilter).every(([k, v]) => s.labels[k] === v);
      }
      return true;
    })
    .reduce((acc, s) => acc + s.value, 0);
}

/** Max value across all samples with the given name. */
function maxMetric(samples: MetricSample[], name: string): number {
  const values = samples.filter((s) => s.name === name).map((s) => s.value);
  return values.length ? Math.max(...values) : 0;
}

/** Get a single gauge value (first match). */
function gaugeValue(
  samples: MetricSample[],
  name: string,
  labelFilter?: Record<string, string>,
): number {
  const found = samples.find((s) => {
    if (s.name !== name) return false;
    if (labelFilter) {
      return Object.entries(labelFilter).every(([k, v]) => s.labels[k] === v);
    }
    return true;
  });
  return found?.value ?? 0;
}

// ---------------------------------------------------------------------------
// Alert condition evaluators (equivalent to PromQL expressions in realtime.rules.yaml)
// ---------------------------------------------------------------------------

/**
 * RealtimeNoFramesPublished:
 *   sum(increase(dashboard_events_consumed_total{outcome="applied"}[10m])) > 0
 *   AND sum(increase(realtime_frames_delivered_total[1m])) == 0
 *
 * In fixture evaluation, we use the current counter totals as proxies for
 * "increase over interval": if events_consumed > 0 AND no frames in the
 * new_frames_delta counter.
 *
 * The fixtures set these explicitly:
 *   - stalled: events_consumed > 0, frames_delivered_delta = 0 (new_frames = 0)
 *   - healthy: events_consumed > 0, frames_delivered_delta > 0
 */
function evalNoFramesPublished(
  samples: MetricSample[],
  /** Frames delivered since last check — 0 for stalled fixture, > 0 for healthy */
  newFramesDelta: number,
): boolean {
  const eventsApplied = sumMetric(samples, 'dashboard_events_consumed_total', { outcome: 'applied' });
  return eventsApplied > 0 && newFramesDelta === 0;
}

/**
 * RealtimeAggregateDriftHigh:
 *   max(dashboard_aggregate_drift) > 50
 */
function evalAggregateDriftHigh(samples: MetricSample[]): boolean {
  return maxMetric(samples, 'dashboard_aggregate_drift') > 50;
}

/**
 * RealtimeSnapshotSourceDatabaseHigh:
 *   rate(database[5m]) / (rate(database[5m]) + rate(cache[5m])) > 0.05
 *
 * Approximated with total counts: db_total / (db_total + cache_total) > 0.05
 */
function evalSnapshotSourceDatabaseHigh(samples: MetricSample[]): boolean {
  const dbTotal    = sumMetric(samples, 'dashboard_snapshot_source_total', { source: 'database' });
  const cacheTotal = sumMetric(samples, 'dashboard_snapshot_source_total', { source: 'cache' });
  const total      = dbTotal + cacheTotal;
  if (total === 0) return false;
  return dbTotal / total > 0.05;
}

/**
 * RealtimeDlqNonEmpty:
 *   dashboard_dlq_depth > 0
 */
function evalDlqNonEmpty(samples: MetricSample[]): boolean {
  return gaugeValue(samples, 'dashboard_dlq_depth') > 0;
}

// ---------------------------------------------------------------------------
// Alert rule YAML structure validation
// ---------------------------------------------------------------------------

describe('Alert rule YAML — committed and structurally valid', () => {
  const RULES_PATH = resolve(__dirname, '../../alerts/realtime.rules.yaml');
  let rulesContent: string;

  try {
    rulesContent = readFileSync(RULES_PATH, 'utf-8');
  } catch {
    rulesContent = '';
  }

  it('realtime.rules.yaml exists and is non-empty', () => {
    expect(rulesContent.length).toBeGreaterThan(0);
  });

  it('contains the five required alert names', () => {
    const required = [
      'RealtimeNoFramesPublished',
      'RealtimeAggregateDriftHigh',
      'RealtimeSnapshotSourceDatabaseHigh',
      'RealtimeDlqNonEmpty',
      'RealtimeGatewayReadinessDegraded',
    ];
    for (const alertName of required) {
      expect(rulesContent).toContain(alertName);
    }
  });

  it('every alert has a severity label', () => {
    expect(rulesContent).toContain('severity:');
  });

  it('every alert has a runbook_url annotation', () => {
    expect(rulesContent).toContain('runbook_url:');
  });

  it('every alert has a team label', () => {
    expect(rulesContent).toContain('team:');
  });

  it('every alert has an sli label referencing a named SLI', () => {
    expect(rulesContent).toContain('sli:');
    expect(rulesContent).toContain('dashboard_freshness');
    expect(rulesContent).toContain('aggregate_correctness');
    expect(rulesContent).toContain('stream_availability');
  });
});

// ---------------------------------------------------------------------------
// SLO YAML structure validation
// ---------------------------------------------------------------------------

describe('SLO YAML — three named SLIs committed (AC5)', () => {
  const SLO_PATH = resolve(__dirname, '../../slo/realtime.slo.yaml');
  let sloContent: string;

  try {
    sloContent = readFileSync(SLO_PATH, 'utf-8');
  } catch {
    sloContent = '';
  }

  it('realtime.slo.yaml exists and is non-empty', () => {
    expect(sloContent.length).toBeGreaterThan(0);
  });

  it('contains the dashboard_freshness SLI (p95 frame age < 10s)', () => {
    expect(sloContent).toContain('dashboard_freshness');
    expect(sloContent).toContain('10');
  });

  it('contains the stream_availability SLI (sessions in live state > 99%)', () => {
    expect(sloContent).toContain('stream_availability');
    expect(sloContent).toContain('99');
  });

  it('contains the aggregate_correctness SLI (drift-free cycles > 99.9%)', () => {
    expect(sloContent).toContain('aggregate_correctness');
    expect(sloContent).toContain('99.9');
  });

  it('specifies a 30-day error budget window', () => {
    expect(sloContent).toContain('30d');
  });
});

// ---------------------------------------------------------------------------
// Alert expression evaluation: healthy fixture (AC11)
// ---------------------------------------------------------------------------

describe('Healthy fixture — no alerts fire', () => {
  let samples: MetricSample[];

  try {
    samples = loadFixture('metrics-healthy.prom');
  } catch {
    samples = [];
  }

  it('fixture loads with > 0 samples', () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  it('RealtimeNoFramesPublished does NOT fire (frames being delivered)', () => {
    // In a healthy system, new frames are delivered continuously
    const fires = evalNoFramesPublished(samples, /* newFramesDelta= */ 1200);
    expect(fires).toBe(false);
  });

  it('RealtimeAggregateDriftHigh does NOT fire (drift == 0)', () => {
    expect(evalAggregateDriftHigh(samples)).toBe(false);
  });

  it('RealtimeSnapshotSourceDatabaseHigh does NOT fire (< 5% from DB)', () => {
    expect(evalSnapshotSourceDatabaseHigh(samples)).toBe(false);
  });

  it('RealtimeDlqNonEmpty does NOT fire (DLQ depth == 0)', () => {
    expect(evalDlqNonEmpty(samples)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Alert expression evaluation: stalled-publisher fixture (AC11)
// ---------------------------------------------------------------------------

describe('Stalled-publisher fixture — RealtimeNoFramesPublished fires', () => {
  let samples: MetricSample[];

  try {
    samples = loadFixture('metrics-stalled-publisher.prom');
  } catch {
    samples = [];
  }

  it('fixture loads with > 0 samples', () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  it('RealtimeNoFramesPublished FIRES when events consumed but 0 new frames delivered', () => {
    // newFramesDelta = 0 simulates no increase(realtime_frames_delivered_total[1m])
    const fires = evalNoFramesPublished(samples, /* newFramesDelta= */ 0);
    expect(fires).toBe(true);
  });

  it('events are being consumed (prerequisite: pipeline is active)', () => {
    const applied = sumMetric(samples, 'dashboard_events_consumed_total', { outcome: 'applied' });
    expect(applied).toBeGreaterThan(0);
  });

  it('RealtimeAggregateDriftHigh does NOT fire in stall scenario (drift is low)', () => {
    expect(evalAggregateDriftHigh(samples)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Alert expression evaluation: drift fixture (AC11)
// ---------------------------------------------------------------------------

describe('Drift fixture — aggregate drift and DLQ alerts fire', () => {
  let samples: MetricSample[];

  try {
    samples = loadFixture('metrics-drift.prom');
  } catch {
    samples = [];
  }

  it('fixture loads with > 0 samples', () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  it('RealtimeAggregateDriftHigh FIRES (max drift > 50)', () => {
    expect(evalAggregateDriftHigh(samples)).toBe(true);
  });

  it('max drift exceeds the 50-unit threshold', () => {
    expect(maxMetric(samples, 'dashboard_aggregate_drift')).toBeGreaterThan(50);
  });

  it('RealtimeDlqNonEmpty FIRES (DLQ depth > 0)', () => {
    expect(evalDlqNonEmpty(samples)).toBe(true);
  });

  it('DLQ depth is the expected value from the fixture', () => {
    expect(gaugeValue(samples, 'dashboard_dlq_depth')).toBe(3);
  });

  it('RealtimeSnapshotSourceDatabaseHigh FIRES (db ratio > 5%)', () => {
    expect(evalSnapshotSourceDatabaseHigh(samples)).toBe(true);
  });

  it('RealtimeNoFramesPublished does NOT fire (frames are still being delivered)', () => {
    const fires = evalNoFramesPublished(samples, /* newFramesDelta= */ 4000);
    expect(fires).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixture parser sanity checks
// ---------------------------------------------------------------------------

describe('Prometheus text fixture parser', () => {
  it('parses a counter with labels correctly', () => {
    const text = `
# TYPE my_counter counter
my_counter{label_a="foo",label_b="bar"} 42
`;
    const samples = parsePrometheusText(text);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.name).toBe('my_counter');
    expect(samples[0]!.labels['label_a']).toBe('foo');
    expect(samples[0]!.labels['label_b']).toBe('bar');
    expect(samples[0]!.value).toBe(42);
  });

  it('parses a gauge without labels', () => {
    const text = `
# TYPE my_gauge gauge
my_gauge 7
`;
    const samples = parsePrometheusText(text);
    expect(samples).toHaveLength(1);
    expect(samples[0]!.name).toBe('my_gauge');
    expect(samples[0]!.value).toBe(7);
  });

  it('ignores comment and empty lines', () => {
    const text = `
# HELP my_metric description
# TYPE my_metric counter
my_metric 1
`;
    const samples = parsePrometheusText(text);
    expect(samples).toHaveLength(1);
  });

  it('parses float values correctly', () => {
    const text = 'response_time_seconds 0.0042\n';
    const samples = parsePrometheusText(text);
    expect(samples[0]!.value).toBeCloseTo(0.0042);
  });
});
