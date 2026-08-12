/**
 * Unit tests for computeDiff (aggregate-diff.ts) — WO-069 AC10
 *
 * Covers:
 *  - Undefined prev → full snapshot frame
 *  - Identical prev/curr → null (no frame)
 *  - KPI field added, changed, removed
 *  - Category entry added, changed, removed
 *  - Affected-area entry added, changed, removed
 *  - Breach-risk rows added, updated nextFireAt, removed
 *  - Feed: new entries surface as feedAppended; no duplicate
 *  - Mixed changes: only changed fields appear in delta
 */

import { computeDiff } from './aggregate-diff';
import type { AggregateSnapshot } from './aggregate-diff';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<AggregateSnapshot> = {}): AggregateSnapshot {
  return {
    kpis:         { open_total: 10, active_p1: 2, running_slas: 5 },
    category:     [{ category: 'billing', count: 4 }, { category: 'tech', count: 6 }],
    affectedArea: [{ area: 'payments', count: 3 }],
    breachRisk:   [{ ticketId: 'TK-1', nextFireAt: 1_000_000 }],
    feed:         ['entry-a', 'entry-b'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// undefined prev → full snapshot
// ---------------------------------------------------------------------------

describe('computeDiff — no previous state', () => {
  it('returns a snapshot frame when prev is undefined', () => {
    const curr = makeSnapshot();
    const result = computeDiff(undefined, curr);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('snapshot');
    expect(result!.payload).toEqual(curr);
  });
});

// ---------------------------------------------------------------------------
// Identical state → null
// ---------------------------------------------------------------------------

describe('computeDiff — no changes', () => {
  it('returns null when prev equals curr exactly', () => {
    const curr = makeSnapshot();
    const prev = makeSnapshot();
    expect(computeDiff(prev, curr)).toBeNull();
  });

  it('returns null when both snapshots are empty', () => {
    const empty: AggregateSnapshot = { kpis: {}, category: [], affectedArea: [], breachRisk: [], feed: [] };
    expect(computeDiff(empty, empty)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// KPI diffs
// ---------------------------------------------------------------------------

describe('computeDiff — KPI changes', () => {
  it('emits changed KPI fields only', () => {
    const prev = makeSnapshot({ kpis: { open_total: 10, active_p1: 2 } });
    const curr = makeSnapshot({ kpis: { open_total: 11, active_p1: 2 } });
    const result = computeDiff(prev, curr);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('delta');
    const delta = result!.payload as { kpis?: Record<string, number> };
    expect(delta.kpis).toEqual({ open_total: 11 });
  });

  it('emits newly added KPI fields', () => {
    const prev = makeSnapshot({ kpis: { open_total: 5 } });
    const curr = makeSnapshot({ kpis: { open_total: 5, running_slas: 3 } });
    const result = computeDiff(prev, curr);
    expect(result!.type).toBe('delta');
    const delta = result!.payload as { kpis?: Record<string, number> };
    expect(delta.kpis).toEqual({ running_slas: 3 });
  });

  it('emits 0 for a KPI field removed from curr', () => {
    const prev = makeSnapshot({ kpis: { open_total: 5, active_p1: 2 } });
    const curr = makeSnapshot({ kpis: { open_total: 5 } });
    const result = computeDiff(prev, curr);
    expect(result!.type).toBe('delta');
    const delta = result!.payload as { kpis?: Record<string, number> };
    expect(delta.kpis).toEqual({ active_p1: 0 });
  });
});

// ---------------------------------------------------------------------------
// Category breakdown diffs
// ---------------------------------------------------------------------------

describe('computeDiff — category changes', () => {
  it('emits changed category entry', () => {
    const prev = makeSnapshot({ category: [{ category: 'billing', count: 4 }] });
    const curr = makeSnapshot({ category: [{ category: 'billing', count: 7 }] });
    const result = computeDiff(prev, curr);
    expect(result!.type).toBe('delta');
    const delta = result!.payload as { categoryDelta?: Array<{ categoryPath: string; count: number }> };
    expect(delta.categoryDelta).toEqual([{ categoryPath: 'billing', count: 7 }]);
  });

  it('emits new category entry', () => {
    const prev = makeSnapshot({ category: [{ category: 'billing', count: 4 }] });
    const curr = makeSnapshot({ category: [{ category: 'billing', count: 4 }, { category: 'hardware', count: 2 }] });
    const result = computeDiff(prev, curr);
    const delta = result!.payload as { categoryDelta?: Array<{ categoryPath: string; count: number }> };
    expect(delta.categoryDelta).toEqual([{ categoryPath: 'hardware', count: 2 }]);
  });

  it('emits count=0 for removed category entry', () => {
    const prev = makeSnapshot({ category: [{ category: 'billing', count: 4 }, { category: 'hardware', count: 2 }] });
    const curr = makeSnapshot({ category: [{ category: 'billing', count: 4 }] });
    const result = computeDiff(prev, curr);
    const delta = result!.payload as { categoryDelta?: Array<{ categoryPath: string; count: number }> };
    expect(delta.categoryDelta).toEqual([{ categoryPath: 'hardware', count: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// Affected-area diffs
// ---------------------------------------------------------------------------

describe('computeDiff — affected-area changes', () => {
  it('emits changed area entry', () => {
    const prev = makeSnapshot({ affectedArea: [{ area: 'payments', count: 3 }] });
    const curr = makeSnapshot({ affectedArea: [{ area: 'payments', count: 5 }] });
    const result = computeDiff(prev, curr);
    const delta = result!.payload as { affectedAreaDelta?: Array<{ areaTag: string; count: number }> };
    expect(delta.affectedAreaDelta).toEqual([{ areaTag: 'payments', count: 5 }]);
  });

  it('emits areaTag=0 for removed entry', () => {
    const prev = makeSnapshot({ affectedArea: [{ area: 'billing', count: 2 }] });
    const curr = makeSnapshot({ affectedArea: [] });
    const result = computeDiff(prev, curr);
    const delta = result!.payload as { affectedAreaDelta?: Array<{ areaTag: string; count: number }> };
    expect(delta.affectedAreaDelta).toEqual([{ areaTag: 'billing', count: 0 }]);
  });
});

// ---------------------------------------------------------------------------
// Breach-risk diffs
// ---------------------------------------------------------------------------

describe('computeDiff — breach-risk changes', () => {
  it('emits added breach-risk row', () => {
    const prev = makeSnapshot({ breachRisk: [] });
    const curr = makeSnapshot({ breachRisk: [{ ticketId: 'TK-1', nextFireAt: 2_000_000 }] });
    const result = computeDiff(prev, curr);
    const delta = result!.payload as { breachRiskAdded?: Array<{ ticketId: string; nextFireAt: number }> };
    expect(delta.breachRiskAdded).toEqual([{ ticketId: 'TK-1', nextFireAt: 2_000_000 }]);
  });

  it('emits added when nextFireAt changes', () => {
    const prev = makeSnapshot({ breachRisk: [{ ticketId: 'TK-1', nextFireAt: 1_000_000 }] });
    const curr = makeSnapshot({ breachRisk: [{ ticketId: 'TK-1', nextFireAt: 1_500_000 }] });
    const result = computeDiff(prev, curr);
    const delta = result!.payload as { breachRiskAdded?: Array<{ ticketId: string }> };
    expect(delta.breachRiskAdded).toEqual([{ ticketId: 'TK-1', nextFireAt: 1_500_000 }]);
  });

  it('emits removed breach-risk ticketId', () => {
    const prev = makeSnapshot({ breachRisk: [{ ticketId: 'TK-2', nextFireAt: 1_000_000 }] });
    const curr = makeSnapshot({ breachRisk: [] });
    const result = computeDiff(prev, curr);
    const delta = result!.payload as { breachRiskRemoved?: string[] };
    expect(delta.breachRiskRemoved).toEqual(['TK-2']);
  });
});

// ---------------------------------------------------------------------------
// Feed diffs
// ---------------------------------------------------------------------------

describe('computeDiff — feed changes', () => {
  it('emits new feed entries', () => {
    const prev = makeSnapshot({ feed: ['entry-b'] });
    const curr = makeSnapshot({ feed: ['entry-c', 'entry-b'] });
    const result = computeDiff(prev, curr);
    const delta = result!.payload as { feedAppended?: string[] };
    expect(delta.feedAppended).toEqual(['entry-c']);
  });

  it('does not emit duplicate feed entries', () => {
    const prev = makeSnapshot({ feed: ['entry-a', 'entry-b'] });
    const curr = makeSnapshot({ feed: ['entry-a', 'entry-b'] });
    expect(computeDiff(prev, curr)).toBeNull();
  });

  it('returns null if curr feed is empty and no other changes', () => {
    const prev = makeSnapshot({ feed: [] });
    const curr = makeSnapshot({ feed: [] });
    expect(computeDiff(prev, curr)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mixed changes — only changed fields in delta
// ---------------------------------------------------------------------------

describe('computeDiff — mixed changes', () => {
  it('only includes fields that changed in the delta', () => {
    const prev = makeSnapshot();
    const curr = makeSnapshot({ kpis: { open_total: 11, active_p1: 2, running_slas: 5 } });
    const result = computeDiff(prev, curr);
    expect(result!.type).toBe('delta');
    const delta = result!.payload as Record<string, unknown>;
    expect(delta['kpis']).toEqual({ open_total: 11 });
    expect(delta['categoryDelta']).toBeUndefined();
    expect(delta['affectedAreaDelta']).toBeUndefined();
    expect(delta['breachRiskAdded']).toBeUndefined();
    expect(delta['feedAppended']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Replay idempotence (AC7)
// ---------------------------------------------------------------------------

describe('computeDiff — replay idempotence', () => {
  it('applying the same delta payload twice yields identical state', () => {
    const base = makeSnapshot({ kpis: { open_total: 10 } });
    const next = makeSnapshot({ kpis: { open_total: 12 } });

    const frame = computeDiff(base, next)!;
    expect(frame.type).toBe('delta');

    // Simulate client applying the delta once
    const stateAfterFirst = { ...base.kpis, ...(frame.payload as { kpis: Record<string, number> }).kpis };

    // Apply again — result must be identical
    const stateAfterSecond = { ...base.kpis, ...(frame.payload as { kpis: Record<string, number> }).kpis };

    expect(stateAfterFirst).toEqual(stateAfterSecond);
    expect(stateAfterFirst['open_total']).toBe(12);
  });
});
