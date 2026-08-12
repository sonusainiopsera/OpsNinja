/**
 * Unit tests: scenario weighting logic (AC11).
 *
 * Verifies:
 *   - SCENARIO_WEIGHTS cover all named scenarios in the load suite
 *   - Dominant scenarios (agent_queue_read) carry higher weight than minor ones
 *   - Normalised weights sum to exactly 1.0
 *   - No scenario has zero weight
 *   - Traffic mix reflects documented channel assumptions
 *     (portal + agent origin > 80% of write volume → ticket_create > ticket_update)
 */

import { describe, it, expect } from 'vitest';
import {
  SCENARIO_WEIGHTS,
  normaliseWeights,
} from '../thresholds.config';

// Expected scenario names from the load test suite (AC1)
const EXPECTED_SCENARIOS = [
  'agent_queue_read',
  'ticket_create',
  'ticket_update',
  'portal_submission',
  'report_query',
  'export_request',
  'dashboard_realtime',
] as const;

describe('SCENARIO_WEIGHTS coverage', () => {
  it('declares a weight for every named scenario in the suite (AC1)', () => {
    const declared = new Set(SCENARIO_WEIGHTS.map((w) => w.scenario));
    for (const name of EXPECTED_SCENARIOS) {
      expect(declared.has(name), `missing scenario: ${name}`).toBe(true);
    }
  });

  it('has no unknown scenario names', () => {
    const knownSet = new Set<string>(EXPECTED_SCENARIOS);
    for (const w of SCENARIO_WEIGHTS) {
      expect(knownSet.has(w.scenario), `unexpected scenario: ${w.scenario}`).toBe(true);
    }
  });

  it('every weight is a positive number', () => {
    for (const w of SCENARIO_WEIGHTS) {
      expect(typeof w.weight).toBe('number');
      expect(w.weight).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty description', () => {
    for (const w of SCENARIO_WEIGHTS) {
      expect(typeof w.description).toBe('string');
      expect(w.description.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('Traffic mix assumptions', () => {
  const map = normaliseWeights(SCENARIO_WEIGHTS);

  it('agent_queue_read is the single highest-weight scenario (dominant read path)', () => {
    const aqr = map.get('agent_queue_read') ?? 0;
    for (const [name, weight] of map) {
      if (name === 'agent_queue_read') continue;
      expect(aqr).toBeGreaterThanOrEqual(weight);
    }
  });

  it('ticket_create weight > ticket_update weight (create > update in channel mix)', () => {
    const createW = map.get('ticket_create') ?? 0;
    const updateW = map.get('ticket_update') ?? 0;
    expect(createW).toBeGreaterThan(updateW);
  });

  it('dashboard_realtime has lower weight than agent_queue_read (long-lived connections, fewer requests)', () => {
    const rtW  = map.get('dashboard_realtime') ?? 0;
    const aqrW = map.get('agent_queue_read')   ?? 0;
    expect(aqrW).toBeGreaterThan(rtW);
  });

  it('export_request has the lowest or equal-lowest weight (infrequent, async)', () => {
    const exportW = map.get('export_request') ?? 0;
    for (const [name, weight] of map) {
      if (name === 'export_request') continue;
      // Export should not be the dominant scenario
      expect(weight).toBeGreaterThanOrEqual(exportW);
    }
  });

  it('combined ticket write weight (create + update) < agent_queue_read weight', () => {
    const aqrW    = map.get('agent_queue_read') ?? 0;
    const createW = map.get('ticket_create')    ?? 0;
    const updateW = map.get('ticket_update')    ?? 0;
    // Read traffic dominates writes (queue reads happen more frequently than creates)
    expect(aqrW).toBeGreaterThan(createW + updateW);
  });
});

describe('normaliseWeights arithmetic', () => {
  it('sum of normalised weights equals exactly 1.0', () => {
    const map   = normaliseWeights(SCENARIO_WEIGHTS);
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it('produces a map with the same number of entries as input', () => {
    const map = normaliseWeights(SCENARIO_WEIGHTS);
    expect(map.size).toBe(SCENARIO_WEIGHTS.length);
  });

  it('relative ordering is preserved after normalisation', () => {
    // Heaviest raw weight should have heaviest normalised weight
    const heaviest = SCENARIO_WEIGHTS.reduce((a, b) => (a.weight >= b.weight ? a : b));
    const map       = normaliseWeights(SCENARIO_WEIGHTS);
    const maxNorm   = Math.max(...Array.from(map.values()));
    expect(map.get(heaviest.scenario)).toBeCloseTo(maxNorm, 10);
  });

  it('handles large integer weights without overflow', () => {
    const large = [
      { scenario: 'a', weight: 1_000_000, description: '' },
      { scenario: 'b', weight: 2_000_000, description: '' },
      { scenario: 'c', weight: 3_000_000, description: '' },
    ];
    const map   = normaliseWeights(large);
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1.0, 10);
    expect(map.get('a')).toBeCloseTo(1 / 6, 10);
    expect(map.get('b')).toBeCloseTo(2 / 6, 10);
    expect(map.get('c')).toBeCloseTo(3 / 6, 10);
  });
});
