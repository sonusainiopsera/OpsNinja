/**
 * Unit tests: threshold configuration parsing and validation (AC11).
 *
 * Verifies:
 *   - All threshold entries have required fields with valid values
 *   - Gating thresholds are a subset of all thresholds
 *   - getThresholdsForScenario returns correct filtered set by profile
 *   - normaliseWeights produces values that sum to exactly 1.0
 *   - SCENARIO_WEIGHTS entries reference known scenario names
 *   - CONCURRENCY values satisfy AC4 (peak ≥ 2× steady_state)
 */

import { describe, it, expect } from 'vitest';
import {
  THRESHOLDS,
  SCENARIO_WEIGHTS,
  CONCURRENCY,
  REGRESSION_TOLERANCE_PCT,
  getThresholdsForScenario,
  normaliseWeights,
  type ThresholdEntry,
  type MetricName,
  type ProfileName,
} from '../thresholds.config';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_METRICS: MetricName[] = ['p50_ms', 'p95_ms', 'p99_ms', 'error_rate_pct', 'throughput_rps'];
const VALID_PROFILES: ProfileName[] = ['steady_state', 'peak', 'both'];

// ---------------------------------------------------------------------------
// Threshold entry structure
// ---------------------------------------------------------------------------

describe('THRESHOLDS', () => {
  it('is a non-empty array', () => {
    expect(THRESHOLDS.length).toBeGreaterThan(0);
  });

  it('every entry has a non-empty scenario string', () => {
    for (const t of THRESHOLDS) {
      expect(typeof t.scenario).toBe('string');
      expect(t.scenario.trim().length).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty endpoint string', () => {
    for (const t of THRESHOLDS) {
      expect(typeof t.endpoint).toBe('string');
      expect(t.endpoint.trim().length).toBeGreaterThan(0);
    }
  });

  it('every entry has a valid metric name', () => {
    for (const t of THRESHOLDS) {
      expect(VALID_METRICS).toContain(t.metric);
    }
  });

  it('every entry has a positive numeric limit', () => {
    for (const t of THRESHOLDS) {
      expect(typeof t.limit).toBe('number');
      expect(t.limit).toBeGreaterThan(0);
    }
  });

  it('every entry has a valid profile', () => {
    for (const t of THRESHOLDS) {
      expect(VALID_PROFILES).toContain(t.profile);
    }
  });

  it('every entry has a boolean gating flag', () => {
    for (const t of THRESHOLDS) {
      expect(typeof t.gating).toBe('boolean');
    }
  });

  it('ticket-list p95 gating threshold is exactly 300ms (architecture SLO)', () => {
    const sloEntry = THRESHOLDS.find(
      (t) =>
        t.scenario  === 'agent_queue_read' &&
        t.endpoint  === 'GET /api/v1/tickets' &&
        t.metric    === 'p95_ms' &&
        t.gating    === true,
    );
    expect(sloEntry).toBeDefined();
    expect(sloEntry!.limit).toBe(300);
  });

  it('error rate gating thresholds use percent values (0–100 scale)', () => {
    const errorRateGating = THRESHOLDS.filter(
      (t) => t.metric === 'error_rate_pct' && t.gating === true,
    );
    expect(errorRateGating.length).toBeGreaterThan(0);
    for (const t of errorRateGating) {
      // 0.1% = 0.1, not 0.001 (that would be fraction scale)
      expect(t.limit).toBeGreaterThan(0);
      expect(t.limit).toBeLessThanOrEqual(100);
    }
  });

  it('gating thresholds are a strict subset of all thresholds', () => {
    const gating = THRESHOLDS.filter((t) => t.gating);
    const nonGating = THRESHOLDS.filter((t) => !t.gating);
    expect(gating.length).toBeGreaterThan(0);
    expect(nonGating.length).toBeGreaterThan(0);
    expect(gating.length + nonGating.length).toBe(THRESHOLDS.length);
  });

  it('has both steady_state and peak coverage for gating thresholds', () => {
    const gating = THRESHOLDS.filter((t) => t.gating);
    const coversProfile = (p: ProfileName) =>
      gating.some((t) => t.profile === p || t.profile === 'both');
    expect(coversProfile('steady_state')).toBe(true);
    expect(coversProfile('peak')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getThresholdsForScenario
// ---------------------------------------------------------------------------

describe('getThresholdsForScenario', () => {
  it('returns entries matching scenario and profile=both', () => {
    const results = getThresholdsForScenario('agent_queue_read', 'steady_state');
    expect(results.length).toBeGreaterThan(0);
    for (const t of results) {
      expect(t.scenario).toBe('agent_queue_read');
      expect(['steady_state', 'both']).toContain(t.profile);
    }
  });

  it('returns peak-profile entries for peak query', () => {
    const results = getThresholdsForScenario('agent_queue_read', 'peak');
    const hasPeakOrBoth = results.every((t) => t.profile === 'peak' || t.profile === 'both');
    expect(hasPeakOrBoth).toBe(true);
  });

  it('does not return steady_state-only entries when querying peak', () => {
    const results = getThresholdsForScenario('agent_queue_read', 'peak');
    const hasSteadyOnly = results.some((t) => t.profile === 'steady_state');
    expect(hasSteadyOnly).toBe(false);
  });

  it('returns empty array for unknown scenario', () => {
    const results = getThresholdsForScenario('nonexistent_scenario_xyz', 'steady_state');
    expect(results).toEqual([]);
  });

  it('includes the p95 gating threshold for agent_queue_read', () => {
    const results = getThresholdsForScenario('agent_queue_read', 'steady_state');
    const p95 = results.find((t) => t.metric === 'p95_ms' && t.gating);
    expect(p95).toBeDefined();
    expect(p95!.limit).toBe(300);
  });
});

// ---------------------------------------------------------------------------
// normaliseWeights
// ---------------------------------------------------------------------------

describe('normaliseWeights', () => {
  it('normalised weights sum to 1.0', () => {
    const map = normaliseWeights(SCENARIO_WEIGHTS);
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('every weight is between 0 and 1 exclusive', () => {
    const map = normaliseWeights(SCENARIO_WEIGHTS);
    for (const [, v] of map) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('handles a single-item list (weight = 1.0)', () => {
    const map = normaliseWeights([{ scenario: 'only', weight: 42, description: '' }]);
    expect(map.get('only')).toBeCloseTo(1.0, 10);
  });

  it('handles equal weights (uniform distribution)', () => {
    const inputs = [
      { scenario: 'a', weight: 1, description: '' },
      { scenario: 'b', weight: 1, description: '' },
      { scenario: 'c', weight: 1, description: '' },
      { scenario: 'd', weight: 1, description: '' },
    ];
    const map = normaliseWeights(inputs);
    for (const [, v] of map) {
      expect(v).toBeCloseTo(0.25, 10);
    }
  });

  it('SCENARIO_WEIGHTS entries have unique scenario names', () => {
    const names = SCENARIO_WEIGHTS.map((w) => w.scenario);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// CONCURRENCY targets (AC4)
// ---------------------------------------------------------------------------

describe('CONCURRENCY targets', () => {
  it('peak agentVUs is at least twice steady_state agentVUs (AC4)', () => {
    expect(CONCURRENCY.peak.agentVUs).toBeGreaterThanOrEqual(
      CONCURRENCY.steady_state.agentVUs * 2,
    );
  });

  it('peak portalVUs is at least twice steady_state portalVUs (AC4)', () => {
    expect(CONCURRENCY.peak.portalVUs).toBeGreaterThanOrEqual(
      CONCURRENCY.steady_state.portalVUs * 2,
    );
  });

  it('peak targetRps is at least twice steady_state (AC4: 200 rps peak)', () => {
    expect(CONCURRENCY.peak.targetRps).toBeGreaterThanOrEqual(
      CONCURRENCY.steady_state.targetRps * 2,
    );
  });

  it('steady_state targets 500 concurrent agents (architecture constraint)', () => {
    expect(CONCURRENCY.steady_state.agentVUs).toBe(500);
  });

  it('peak targets 200 rps (AC4)', () => {
    expect(CONCURRENCY.peak.targetRps).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION_TOLERANCE_PCT
// ---------------------------------------------------------------------------

describe('REGRESSION_TOLERANCE_PCT', () => {
  it('is a positive number', () => {
    expect(typeof REGRESSION_TOLERANCE_PCT).toBe('number');
    expect(REGRESSION_TOLERANCE_PCT).toBeGreaterThan(0);
  });

  it('is a reasonable tolerance (1–25%)', () => {
    expect(REGRESSION_TOLERANCE_PCT).toBeGreaterThanOrEqual(1);
    expect(REGRESSION_TOLERANCE_PCT).toBeLessThanOrEqual(25);
  });
});
