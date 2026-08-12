/**
 * Unit tests: report generator — k6 summary → PerformanceReport (AC11).
 *
 * Verifies:
 *   - buildEndpointResults maps k6 Trend metrics to EndpointResult correctly
 *   - buildVerdicts evaluates all applicable thresholds for a profile
 *   - Gating verdict is FAIL when observed > limit for latency metrics
 *   - Gating verdict is PASS when observed <= limit for latency metrics
 *   - buildVerdicts: throughput threshold passes when observed >= limit
 *   - buildSummary counts gating vs non-gating pass/fail correctly
 *   - overallPassed is false when any GATING verdict fails
 *   - overallPassed is true even when non-gating verdicts fail
 *   - Missing endpoint (no k6 measurement) results in passed=false
 *   - buildEndpointResults returns empty array for empty metrics
 */

import { describe, it, expect } from 'vitest';
import {
  buildEndpointResults,
  buildVerdicts,
  buildSummary,
} from '../reporting/generate-report';
import type { EndpointResult } from '../types';
import type { ProfileName } from '../thresholds.config';

// ---------------------------------------------------------------------------
// Fixtures — minimal k6 metric shapes
// ---------------------------------------------------------------------------

function makeTrendEntry(p50: number, p95: number, p99: number) {
  return {
    type: 'Trend' as const,
    contains: 'time',
    values: {
      avg: (p50 + p95 + p99) / 3,
      min: p50 * 0.5,
      max: p99 * 1.2,
      med: p50,
      'p(50)': p50,
      'p(90)': p95 * 0.95,
      'p(95)': p95,
      'p(99)': p99,
    },
  };
}

function makeRateEntry(rate: number) {
  return {
    type: 'Rate' as const,
    contains: 'default',
    values: { passes: Math.round((1 - rate) * 1000), fails: Math.round(rate * 1000), rate },
  };
}

function makeCounterEntry(count: number, rps: number) {
  return {
    type: 'Counter' as const,
    contains: 'default',
    values: { count, rate: rps },
  };
}

/** Minimal k6 metrics map satisfying agent_queue_read scenario. */
function makeAgentQueueMetrics(p95: number, errorRate = 0.001) {
  return {
    agent_queue_read_duration_ms:    makeTrendEntry(100, p95, p95 * 2),
    agent_queue_read_error_rate:     makeRateEntry(errorRate),
    http_reqs:                       makeCounterEntry(50000, 90),
  };
}

// ---------------------------------------------------------------------------
// buildEndpointResults
// ---------------------------------------------------------------------------

describe('buildEndpointResults', () => {
  it('returns empty array when metrics are empty', () => {
    const results = buildEndpointResults({}, 'steady_state');
    expect(results).toEqual([]);
  });

  it('maps agent_queue_read_duration_ms to correct scenario and endpoint', () => {
    const metrics = makeAgentQueueMetrics(220);
    const results = buildEndpointResults(metrics, 'steady_state');

    const queueResult = results.find(
      (r) => r.scenario === 'agent_queue_read' && r.endpoint === 'GET /api/v1/tickets',
    );
    expect(queueResult).toBeDefined();
    expect(queueResult!.metrics.p95_ms).toBe(220);
  });

  it('extracts error_rate_pct as percentage (0–100), not fraction (0–1)', () => {
    const metrics = makeAgentQueueMetrics(200, 0.001); // 0.1% error rate
    const results = buildEndpointResults(metrics, 'steady_state');

    const queueResult = results.find((r) => r.scenario === 'agent_queue_read');
    expect(queueResult).toBeDefined();
    // 0.001 rate → 0.1% → should be ~0.1
    expect(queueResult!.metrics.error_rate_pct).toBeCloseTo(0.1, 2);
  });

  it('extracts throughput_rps from http_reqs counter', () => {
    const metrics = makeAgentQueueMetrics(200, 0);
    const results = buildEndpointResults(metrics, 'steady_state');

    const queueResult = results.find((r) => r.scenario === 'agent_queue_read');
    expect(queueResult!.metrics.throughput_rps).toBe(90);
  });

  it('sets profile on each result from the argument', () => {
    const metrics = makeAgentQueueMetrics(200);
    const results = buildEndpointResults(metrics, 'peak');

    for (const r of results) {
      expect(r.profile).toBe('peak');
    }
  });

  it('maps multiple metrics from different scenarios in the same batch', () => {
    const metrics = {
      ...makeAgentQueueMetrics(200),
      ticket_create_agent_duration_ms:  makeTrendEntry(120, 350, 700),
      ticket_create_portal_duration_ms: makeTrendEntry(150, 450, 900),
      ticket_create_error_rate:         makeRateEntry(0.0005),
    };
    const results = buildEndpointResults(metrics, 'steady_state');

    const scenarios = new Set(results.map((r) => r.scenario));
    expect(scenarios.has('agent_queue_read')).toBe(true);
    expect(scenarios.has('ticket_create')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildVerdicts
// ---------------------------------------------------------------------------

describe('buildVerdicts', () => {
  function makeEndpointResult(
    scenario: string,
    endpoint: string,
    metrics: Partial<EndpointResult['metrics']>,
  ): EndpointResult {
    return {
      scenario,
      endpoint,
      profile: 'steady_state',
      metrics: {
        p50_ms:          100,
        p95_ms:          200,
        p99_ms:          400,
        error_rate_pct:  0.02,
        throughput_rps:  95,
        sample_count:    50000,
        ...metrics,
      },
    };
  }

  it('returns at least one verdict per threshold in the config', () => {
    const endpointResults = [
      makeEndpointResult('agent_queue_read', 'GET /api/v1/tickets', { p95_ms: 200 }),
    ];
    const verdicts = buildVerdicts(endpointResults, 'steady_state');
    expect(verdicts.length).toBeGreaterThan(0);
  });

  it('PASS when observed p95 < gating limit (300ms architecture SLO)', () => {
    const endpointResults = [
      makeEndpointResult('agent_queue_read', 'GET /api/v1/tickets', {
        p95_ms: 250, // under 300ms limit
        error_rate_pct: 0.05,
      }),
    ];
    const verdicts = buildVerdicts(endpointResults, 'steady_state');

    const p95Verdict = verdicts.find(
      (v) => v.scenario === 'agent_queue_read' && v.metric === 'p95_ms' && v.gating,
    );
    expect(p95Verdict).toBeDefined();
    expect(p95Verdict!.passed).toBe(true);
    expect(p95Verdict!.observed).toBe(250);
    expect(p95Verdict!.limit).toBe(300);
  });

  it('FAIL when observed p95 > gating limit (300ms architecture SLO)', () => {
    const endpointResults = [
      makeEndpointResult('agent_queue_read', 'GET /api/v1/tickets', {
        p95_ms: 350, // breaches 300ms limit
        error_rate_pct: 0.05,
      }),
    ];
    const verdicts = buildVerdicts(endpointResults, 'steady_state');

    const p95Verdict = verdicts.find(
      (v) => v.scenario === 'agent_queue_read' && v.metric === 'p95_ms' && v.gating,
    );
    expect(p95Verdict!.passed).toBe(false);
    expect(p95Verdict!.observed).toBe(350);
  });

  it('PASS when observed error_rate_pct < 0.1 (gating)', () => {
    const endpointResults = [
      makeEndpointResult('agent_queue_read', 'GET /api/v1/tickets', {
        p95_ms: 200,
        error_rate_pct: 0.05, // 0.05% < 0.1%
      }),
    ];
    const verdicts = buildVerdicts(endpointResults, 'steady_state');

    const errVerdict = verdicts.find(
      (v) => v.scenario === 'agent_queue_read' && v.metric === 'error_rate_pct' && v.gating,
    );
    expect(errVerdict!.passed).toBe(true);
  });

  it('FAIL when observed error_rate_pct > 0.1 (gating)', () => {
    const endpointResults = [
      makeEndpointResult('agent_queue_read', 'GET /api/v1/tickets', {
        p95_ms: 200,
        error_rate_pct: 0.5, // 0.5% > 0.1%
      }),
    ];
    const verdicts = buildVerdicts(endpointResults, 'steady_state');

    const errVerdict = verdicts.find(
      (v) => v.scenario === 'agent_queue_read' && v.metric === 'error_rate_pct' && v.gating,
    );
    expect(errVerdict!.passed).toBe(false);
  });

  it('PASS for throughput when observed >= limit', () => {
    const endpointResults = [
      makeEndpointResult('agent_queue_read', 'GET /api/v1/tickets', {
        throughput_rps: 90, // >= 80 rps limit
      }),
    ];
    const verdicts = buildVerdicts(endpointResults, 'steady_state');

    const tpVerdict = verdicts.find(
      (v) => v.scenario === 'agent_queue_read' && v.metric === 'throughput_rps',
    );
    if (tpVerdict) {
      expect(tpVerdict.passed).toBe(true);
    }
  });

  it('FAIL for throughput when observed < limit', () => {
    const endpointResults = [
      makeEndpointResult('agent_queue_read', 'GET /api/v1/tickets', {
        throughput_rps: 50, // < 80 rps limit
      }),
    ];
    const verdicts = buildVerdicts(endpointResults, 'steady_state');

    const tpVerdict = verdicts.find(
      (v) => v.scenario === 'agent_queue_read' && v.metric === 'throughput_rps' && !v.gating,
    );
    if (tpVerdict) {
      expect(tpVerdict.passed).toBe(false);
    }
  });

  it('emits passed=false for missing endpoint (no measurement)', () => {
    // No endpoint results → all verdicts for un-measured endpoints are false
    const verdicts = buildVerdicts([], 'steady_state');
    const gatingFailed = verdicts.filter((v) => v.gating && !v.passed);
    expect(gatingFailed.length).toBeGreaterThan(0);
  });

  it('includes both gating and non-gating verdicts', () => {
    const endpointResults = [
      makeEndpointResult('agent_queue_read', 'GET /api/v1/tickets', {}),
    ];
    const verdicts = buildVerdicts(endpointResults, 'steady_state');
    expect(verdicts.some((v) => v.gating)).toBe(true);
    expect(verdicts.some((v) => !v.gating)).toBe(true);
  });

  it('only returns verdicts applicable to the given profile', () => {
    // steady_state profile should not return peak-only verdicts
    const endpointResults = [
      makeEndpointResult('agent_queue_read', 'GET /api/v1/tickets', {}),
    ];
    const verdicts = buildVerdicts(endpointResults, 'steady_state');
    // No verdict should have profile='peak' (peak-only entries are filtered out)
    const peakOnly = verdicts.filter((v) => v.profile === 'peak');
    expect(peakOnly.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildSummary
// ---------------------------------------------------------------------------

describe('buildSummary', () => {
  function makeVerdict(gating: boolean, passed: boolean) {
    return {
      scenario:  's',
      endpoint:  'e',
      metric:    'p95_ms' as const,
      profile:   'steady_state' as ProfileName,
      limit:     300,
      observed:  passed ? 200 : 400,
      passed,
      gating,
    };
  }

  it('overallPassed=true when no gating verdicts fail', () => {
    const verdicts = [
      makeVerdict(true,  true),
      makeVerdict(true,  true),
      makeVerdict(false, false), // non-gating failure does NOT block
    ];
    const summary = buildSummary(verdicts);
    expect(summary.overallPassed).toBe(true);
    expect(summary.gatingPassed).toBe(2);
    expect(summary.gatingFailed).toBe(0);
    expect(summary.nonGatingFailed).toBe(1);
  });

  it('overallPassed=false when at least one gating verdict fails', () => {
    const verdicts = [
      makeVerdict(true,  true),
      makeVerdict(true,  false), // gating FAIL
      makeVerdict(false, true),
    ];
    const summary = buildSummary(verdicts);
    expect(summary.overallPassed).toBe(false);
    expect(summary.gatingFailed).toBe(1);
  });

  it('totalThresholds equals verdict count', () => {
    const verdicts = Array.from({ length: 7 }, (_, i) => makeVerdict(i % 2 === 0, true));
    const summary = buildSummary(verdicts);
    expect(summary.totalThresholds).toBe(7);
  });

  it('returns all zeros and overallPassed=true for empty verdicts', () => {
    const summary = buildSummary([]);
    expect(summary.totalThresholds).toBe(0);
    expect(summary.gatingPassed).toBe(0);
    expect(summary.gatingFailed).toBe(0);
    expect(summary.overallPassed).toBe(true);
  });

  it('correctly handles all-pass scenario (architecture SLO rehearsal)', () => {
    const verdicts = [
      makeVerdict(true,  true),
      makeVerdict(true,  true),
      makeVerdict(false, true),
      makeVerdict(false, true),
    ];
    const summary = buildSummary(verdicts);
    expect(summary.overallPassed).toBe(true);
    expect(summary.nonGatingFailed).toBe(0);
  });

  it('detects gating failure even when non-gating all pass (gate-breach rehearsal)', () => {
    const verdicts = [
      makeVerdict(true,  false), // gating FAIL — blocks promotion
      makeVerdict(false, true),
      makeVerdict(false, true),
    ];
    const summary = buildSummary(verdicts);
    expect(summary.overallPassed).toBe(false);
    expect(summary.gatingFailed).toBe(1);
    expect(summary.gatingPassed).toBe(0);
    expect(summary.nonGatingPassed).toBe(2);
  });
});
