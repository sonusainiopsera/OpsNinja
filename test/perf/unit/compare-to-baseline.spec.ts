/**
 * Unit tests: baseline comparison regression detector (AC11).
 *
 * Verifies:
 *   - compareMetric correctly classifies regression / improvement / unchanged
 *   - HIGHER_IS_WORSE semantics are respected for each metric type
 *   - compareReports correctly aggregates regressions and improvements
 *   - overallPassed is false when any regression is found
 *   - Zero-baseline edge case does not throw
 *   - Injected known regression is always detected
 */

import { describe, it, expect } from 'vitest';
import {
  compareMetric,
  compareReports,
  extractMetricPoints,
  buildPointKey,
  type MetricPoint,
} from '../reporting/compare-to-baseline';
import type { PerformanceReport } from '../types';
import type { MetricName } from '../thresholds.config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMetricPoint(
  scenario: string,
  endpoint: string,
  metric: MetricName,
  value: number,
): MetricPoint {
  return { scenario, endpoint, metric, value };
}

function makeReport(overrides: Partial<PerformanceReport> = {}): PerformanceReport {
  const base: PerformanceReport = {
    runId:       'run-001',
    generatedAt: '2024-01-01T00:00:00.000Z',
    gitRef:      'abc1234',
    profile:     'steady_state',
    dataset: {
      seed:                   0xdeadbeef,
      profile:                'large',
      tenantCount:            3,
      approximateTicketCount: 60000,
    },
    endpointResults: [
      {
        scenario: 'agent_queue_read',
        endpoint: 'GET /api/v1/tickets',
        profile:  'steady_state',
        metrics: {
          p50_ms:         80,
          p95_ms:         220,
          p99_ms:         450,
          error_rate_pct: 0.02,
          throughput_rps: 95,
          sample_count:   50000,
        },
      },
    ],
    verdicts: [],
    stressResults: {
      savedViewCompiler:    [],
      schedulerContention: { schedulerCount: 4, activeTimerCount: 10000, duplicateClaims: 0, skippedTimers: 0, maxTickDurationMs: 3000, tickDurationLimitMs: 15000, passed: true },
      outboxDrain:         { injectedEvents: 1000, drainedEvents: 1000, lostEvents: 0, drainRateEventsPerSec: 150, minRequiredRateEventsPerSec: 120, orderingViolations: 0, endToEndLagP95Ms: 800, passed: true },
      exportMemory:        { rowCount: 500000, peakMemoryMb: 95, memoryEnvelopeMb: 128, streamingConfirmed: true, rowCapEnforced: true, timeoutEnforced: true, errorActionable: true, passed: true },
      realtimeConnections: { targetConnections: 500, successfulConnections: 498, handshakeSuccessRatePct: 99.6, deltaLatencyP95Ms: 5200, memoryPerConnectionKb: 38, memoryLimitPerConnectionKb: 40, gracefulRejectionOnOverload: true, passed: true },
    },
    summary: {
      totalThresholds:  20,
      gatingPassed:     8,
      gatingFailed:     0,
      nonGatingPassed:  12,
      nonGatingFailed:  0,
      overallPassed:    true,
    },
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// compareMetric
// ---------------------------------------------------------------------------

describe('compareMetric', () => {
  const TOLERANCE = 10; // 10%

  describe('higher-is-worse metrics (latency, error_rate)', () => {
    it('flags regression when current exceeds baseline by more than tolerance', () => {
      const baseline = makeMetricPoint('s', 'e', 'p95_ms', 200);
      const current  = makeMetricPoint('s', 'e', 'p95_ms', 230); // +15%
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('regression');
    });

    it('flags improvement when current is more than tolerance below baseline', () => {
      const baseline = makeMetricPoint('s', 'e', 'p95_ms', 200);
      const current  = makeMetricPoint('s', 'e', 'p95_ms', 170); // -15%
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('improvement');
    });

    it('reports unchanged within tolerance band', () => {
      const baseline = makeMetricPoint('s', 'e', 'p95_ms', 200);
      const current  = makeMetricPoint('s', 'e', 'p95_ms', 208); // +4%
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('unchanged');
    });

    it('exact tolerance boundary is unchanged (not regression)', () => {
      const baseline = makeMetricPoint('s', 'e', 'p95_ms', 100);
      const current  = makeMetricPoint('s', 'e', 'p95_ms', 110); // exactly +10%
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('unchanged');
    });

    it('one tick above tolerance is regression', () => {
      const baseline = makeMetricPoint('s', 'e', 'p95_ms', 100);
      const current  = makeMetricPoint('s', 'e', 'p95_ms', 111); // +11%
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('regression');
    });

    it('handles error_rate_pct regression (higher is worse)', () => {
      const baseline = makeMetricPoint('s', 'e', 'error_rate_pct', 0.05);
      const current  = makeMetricPoint('s', 'e', 'error_rate_pct', 0.1); // +100%
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('regression');
    });
  });

  describe('lower-is-worse metrics (throughput)', () => {
    it('flags regression when throughput drops more than tolerance', () => {
      const baseline = makeMetricPoint('s', 'e', 'throughput_rps', 100);
      const current  = makeMetricPoint('s', 'e', 'throughput_rps', 80); // -20%
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('regression');
    });

    it('flags improvement when throughput rises more than tolerance', () => {
      const baseline = makeMetricPoint('s', 'e', 'throughput_rps', 100);
      const current  = makeMetricPoint('s', 'e', 'throughput_rps', 120); // +20%
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('improvement');
    });

    it('unchanged within tolerance for throughput', () => {
      const baseline = makeMetricPoint('s', 'e', 'throughput_rps', 100);
      const current  = makeMetricPoint('s', 'e', 'throughput_rps', 95); // -5%
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('unchanged');
    });
  });

  describe('zero-baseline edge case', () => {
    it('returns regression when baseline=0 and current>0 (error rate appeared)', () => {
      const baseline = makeMetricPoint('s', 'e', 'error_rate_pct', 0);
      const current  = makeMetricPoint('s', 'e', 'error_rate_pct', 0.1);
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('regression');
    });

    it('returns unchanged when both are zero', () => {
      const baseline = makeMetricPoint('s', 'e', 'error_rate_pct', 0);
      const current  = makeMetricPoint('s', 'e', 'error_rate_pct', 0);
      expect(compareMetric(baseline, current, TOLERANCE)).toBe('unchanged');
    });
  });
});

// ---------------------------------------------------------------------------
// extractMetricPoints
// ---------------------------------------------------------------------------

describe('extractMetricPoints', () => {
  it('extracts all 5 metric types per endpoint result', () => {
    const report  = makeReport();
    const points  = extractMetricPoints(report);
    // 1 endpoint × 5 metrics
    expect(points.length).toBe(5);
  });

  it('preserves scenario and endpoint labels', () => {
    const report = makeReport();
    const points = extractMetricPoints(report);
    for (const p of points) {
      expect(p.scenario).toBe('agent_queue_read');
      expect(p.endpoint).toBe('GET /api/v1/tickets');
    }
  });

  it('returns empty array for report with no endpoint results', () => {
    const report = makeReport({ endpointResults: [] });
    expect(extractMetricPoints(report)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildPointKey
// ---------------------------------------------------------------------------

describe('buildPointKey', () => {
  it('produces a unique key per (scenario, endpoint, metric) triple', () => {
    const p1 = makeMetricPoint('s1', 'e1', 'p95_ms',   100);
    const p2 = makeMetricPoint('s1', 'e1', 'p50_ms',   100);
    const p3 = makeMetricPoint('s2', 'e1', 'p95_ms',   100);
    const keys = [buildPointKey(p1), buildPointKey(p2), buildPointKey(p3)];
    expect(new Set(keys).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// compareReports
// ---------------------------------------------------------------------------

describe('compareReports', () => {
  it('overallPassed=true when no regressions', () => {
    const baseline = makeReport({ runId: 'run-baseline' });
    const current  = makeReport({ runId: 'run-current' });
    const result   = compareReports(baseline, current, 10);
    expect(result.overallPassed).toBe(true);
    expect(result.regressions.length).toBe(0);
  });

  it('detects a p95 regression when current exceeds baseline by >tolerance', () => {
    const baseline = makeReport({ runId: 'run-baseline' });
    const current  = makeReport({
      runId: 'run-current',
      endpointResults: [{
        ...baseline.endpointResults[0]!,
        metrics: { ...baseline.endpointResults[0]!.metrics, p95_ms: 350 }, // was 220 → +59%
      }],
    });

    const result = compareReports(baseline, current, 10);
    expect(result.overallPassed).toBe(false);
    expect(result.regressions.length).toBeGreaterThan(0);

    const p95regression = result.regressions.find((r) => r.metric === 'p95_ms');
    expect(p95regression).toBeDefined();
    expect(p95regression!.currentValue).toBe(350);
    expect(p95regression!.baselineValue).toBe(220);
  });

  it('reports an improvement when current p95 drops significantly', () => {
    const baseline = makeReport({ runId: 'run-baseline' });
    const current  = makeReport({
      runId: 'run-current',
      endpointResults: [{
        ...baseline.endpointResults[0]!,
        metrics: { ...baseline.endpointResults[0]!.metrics, p95_ms: 150 }, // was 220 → -32%
      }],
    });

    const result = compareReports(baseline, current, 10);
    expect(result.overallPassed).toBe(true); // improvement is not a failure
    const improvement = result.improvements.find((i) => i.metric === 'p95_ms');
    expect(improvement).toBeDefined();
  });

  it('preserves runId references', () => {
    const baseline = makeReport({ runId: 'baseline-001' });
    const current  = makeReport({ runId: 'current-002' });
    const result   = compareReports(baseline, current, 10);
    expect(result.baselineRunId).toBe('baseline-001');
    expect(result.currentRunId).toBe('current-002');
  });

  it('unchanged metrics increment unchangedCount', () => {
    const baseline = makeReport({ runId: 'b' });
    const current  = makeReport({ runId: 'c' }); // identical metrics
    const result   = compareReports(baseline, current, 10);
    // 5 metric points, all identical → all unchanged
    expect(result.unchangedCount).toBe(5);
    expect(result.regressions.length).toBe(0);
    expect(result.improvements.length).toBe(0);
  });

  it('injected 50% latency regression is detected (gate-breach rehearsal)', () => {
    const baseline = makeReport({ runId: 'b' });
    const mutated  = makeReport({
      runId: 'mutated',
      endpointResults: [{
        ...baseline.endpointResults[0]!,
        metrics: {
          ...baseline.endpointResults[0]!.metrics,
          p95_ms: Math.round(baseline.endpointResults[0]!.metrics.p95_ms * 1.5),
        },
      }],
    });

    const result = compareReports(baseline, mutated, 10);
    expect(result.overallPassed).toBe(false);
    expect(result.regressions.some((r) => r.metric === 'p95_ms')).toBe(true);
  });
});
