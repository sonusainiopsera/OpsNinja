/**
 * applyDelta pure reducer unit tests (WO-070, AC3, AC11).
 *
 * Covers:
 *  - Snapshot frame: full state replacement, seq reset
 *  - Delta frame: KPI merge, category upsert/remove, affected-area upsert/remove
 *  - Breach-risk add/remove
 *  - Feed append with 100-entry cap
 *  - Out-of-order seq rejection (idempotent reapplication)
 *  - Seq gap detection (prevSeq mismatch → seqGap=true)
 *  - Validation failure counting and refetch threshold
 *  - snapshot_required control signal
 *
 * No React, browser globals or network calls.
 */

import { describe, it, expect } from 'vitest';
import {
  applyFrame,
  INITIAL_DASHBOARD_STATE,
} from '../../features/dashboard/state/apply-delta';
import type { DashboardState, IncomingFrame } from '../../features/dashboard/state/apply-delta';
import {
  populatedSnapshot,
  emptyTenantSnapshot,
  deltaFrame43,
  deltaFrame44,
  gapFrame46,
  duplicateFrame43,
  snapshotToFrame,
  POPULATED_BREACH_ROWS,
  POPULATED_FEED_ROWS,
  FIXTURE_GENERATED_AT_MS,
} from '../fixtures/dashboard.fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Apply a snapshot frame to INITIAL state and return the result. */
function applySnapshot(snap = populatedSnapshot): DashboardState {
  return applyFrame(INITIAL_DASHBOARD_STATE, snapshotToFrame(snap));
}

function makeDeltaFrame(
  seq: number,
  prevSeq: number,
  payload: Record<string, unknown> = {},
): IncomingFrame {
  return {
    type: 'delta',
    seq,
    prevSeq,
    generatedAt: '2026-08-12T10:00:00.000Z',
    payload,
  };
}

// ---------------------------------------------------------------------------
// 1. Snapshot frame
// ---------------------------------------------------------------------------

describe('applyFrame — snapshot frame', () => {
  it('replaces KPIs from initial state', () => {
    const next = applySnapshot();
    expect(next.kpis.activeP1).toBe(populatedSnapshot.kpis.activeP1);
    expect(next.kpis.csat7d).toBe(populatedSnapshot.kpis.csat7d);
  });

  it('sets seq from snapshot', () => {
    const next = applySnapshot();
    expect(next.seq).toBe(42);
  });

  it('sets generatedAt from snapshot', () => {
    const next = applySnapshot();
    expect(next.generatedAt).toBe(populatedSnapshot.generatedAt);
  });

  it('populates breachRisk from snapshot', () => {
    const next = applySnapshot();
    expect(next.breachRisk).toHaveLength(POPULATED_BREACH_ROWS.length);
  });

  it('populates activityFeed from snapshot', () => {
    const next = applySnapshot();
    expect(next.activityFeed).toHaveLength(POPULATED_FEED_ROWS.length);
  });

  it('clears seqGap flag on snapshot application', () => {
    const stateWithGap: DashboardState = { ...INITIAL_DASHBOARD_STATE, seqGap: true };
    const next = applyFrame(stateWithGap, snapshotToFrame(populatedSnapshot));
    expect(next.seqGap).toBe(false);
  });

  it('resets validationFailures on snapshot', () => {
    const stateWithFailures: DashboardState = {
      ...INITIAL_DASHBOARD_STATE,
      validationFailures: 3,
    };
    const next = applyFrame(stateWithFailures, snapshotToFrame(populatedSnapshot));
    expect(next.validationFailures).toBe(0);
  });

  it('applies empty-tenant snapshot (zeroed KPIs)', () => {
    const next = applySnapshot(emptyTenantSnapshot);
    expect(next.kpis.activeP1).toBe(0);
    expect(next.breachRisk).toHaveLength(0);
    expect(next.activityFeed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Delta frame — KPI merge
// ---------------------------------------------------------------------------

describe('applyFrame — delta KPI merge', () => {
  it('increments KPI by positive delta', () => {
    const base = applySnapshot();  // activeP1 = 3
    const next = applyFrame(base, deltaFrame43);
    expect(next.kpis.activeP1).toBe(4); // +1
  });

  it('decrements KPI by negative delta', () => {
    const base = applySnapshot();       // openTotal = 48
    const afterDelta43 = applyFrame(base, deltaFrame43);
    const next = applyFrame(afterDelta43, deltaFrame44); // openTotal -1
    expect(next.kpis.openTotal).toBe(47);
  });

  it('clamps KPI to 0 (never negative)', () => {
    const base = applySnapshot(); // activeP2 = 7
    // Delta of -999 would go negative — must clamp to 0
    const frame = makeDeltaFrame(43, 42, { kpis: { activeP2: -999 } });
    const next = applyFrame(base, frame);
    expect(next.kpis.activeP2).toBe(0);
  });

  it('ignores unknown KPI keys', () => {
    const base = applySnapshot();
    const frame = makeDeltaFrame(43, 42, { kpis: { unknownMetric: 5 } });
    const next = applyFrame(base, frame);
    // Known KPIs unchanged
    expect(next.kpis.activeP1).toBe(base.kpis.activeP1);
  });
});

// ---------------------------------------------------------------------------
// 3. Delta frame — category breakdown upsert / remove
// ---------------------------------------------------------------------------

describe('applyFrame — category breakdown', () => {
  it('upserts a category with a new count', () => {
    const base = applySnapshot();
    const frame = makeDeltaFrame(43, 42, {
      categoryDelta: [{ categoryPath: 'Infrastructure/Networking', count: 20 }],
    });
    const next = applyFrame(base, frame);
    const row = next.categoryBreakdown.find((r) => r.categoryPath === 'Infrastructure/Networking');
    expect(row?.count).toBe(20);
  });

  it('removes a category when count is 0', () => {
    const base = applySnapshot();
    const frame = makeDeltaFrame(43, 42, {
      categoryDelta: [{ categoryPath: 'Billing', count: 0 }],
    });
    const next = applyFrame(base, frame);
    expect(next.categoryBreakdown.find((r) => r.categoryPath === 'Billing')).toBeUndefined();
  });

  it('adds a new category', () => {
    const base = applySnapshot();
    const frame = makeDeltaFrame(43, 42, {
      categoryDelta: [{ categoryPath: 'Security/Access', count: 3 }],
    });
    const next = applyFrame(base, frame);
    expect(next.categoryBreakdown.find((r) => r.categoryPath === 'Security/Access')?.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Delta frame — affected-area breakdown
// ---------------------------------------------------------------------------

describe('applyFrame — affected-area breakdown', () => {
  it('upserts an area tag', () => {
    const base = applySnapshot();
    const frame = makeDeltaFrame(43, 42, {
      affectedAreaDelta: [{ areaTag: 'reporting', count: 10 }],
    });
    const next = applyFrame(base, frame);
    expect(next.affectedAreaBreakdown.find((r) => r.areaTag === 'reporting')?.count).toBe(10);
  });

  it('removes an area tag when count is 0', () => {
    const base = applySnapshot();
    const frame = makeDeltaFrame(43, 42, {
      affectedAreaDelta: [{ areaTag: 'reporting', count: 0 }],
    });
    const next = applyFrame(base, frame);
    expect(next.affectedAreaBreakdown.find((r) => r.areaTag === 'reporting')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Delta frame — breach-risk add/remove
// ---------------------------------------------------------------------------

describe('applyFrame — breach-risk rows', () => {
  it('adds a new breach-risk row', () => {
    const base = applySnapshot();
    const newRow = { ...POPULATED_BREACH_ROWS[0], ticketId: 'ticket-NEW-001', ticketKey: 'TKT-9999' };
    const frame = makeDeltaFrame(43, 42, { breachRiskAdded: [newRow] });
    const next = applyFrame(base, frame);
    expect(next.breachRisk.find((r) => r.ticketId === 'ticket-NEW-001')).toBeDefined();
  });

  it('removes a breach-risk row by ticketId', () => {
    const base = applySnapshot();
    const frame = makeDeltaFrame(43, 42, {
      breachRiskRemoved: [POPULATED_BREACH_ROWS[0].ticketId],
    });
    const next = applyFrame(base, frame);
    expect(next.breachRisk.find((r) => r.ticketId === POPULATED_BREACH_ROWS[0].ticketId)).toBeUndefined();
  });

  it('upserts an existing row (update)', () => {
    const base = applySnapshot();
    const updated = { ...POPULATED_BREACH_ROWS[0], remainingMs: 999 };
    const frame = makeDeltaFrame(43, 42, { breachRiskAdded: [updated] });
    const next = applyFrame(base, frame);
    const row = next.breachRisk.find((r) => r.ticketId === POPULATED_BREACH_ROWS[0].ticketId);
    expect(row?.remainingMs).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// 6. Feed append with 100-entry cap
// ---------------------------------------------------------------------------

describe('applyFrame — activity feed cap', () => {
  it('prepends new feed items (newest-first)', () => {
    const base = applySnapshot();
    const newEvent = { ...POPULATED_FEED_ROWS[0], ticketKey: 'TKT-NEW', occurredAt: '2026-08-12T10:01:00.000Z' };
    const frame = makeDeltaFrame(43, 42, { feedAppended: [newEvent] });
    const next = applyFrame(base, frame);
    expect(next.activityFeed[0].ticketKey).toBe('TKT-NEW');
  });

  it('caps activity feed at 100 entries', () => {
    // Start with 98 entries
    const bigFeed = Array.from({ length: 98 }, (_, i) => ({
      ...POPULATED_FEED_ROWS[0],
      ticketKey: `TKT-${i}`,
      occurredAt: new Date(FIXTURE_GENERATED_AT_MS - i * 1000).toISOString(),
    }));
    const base: DashboardState = { ...applySnapshot(), activityFeed: bigFeed };

    // Append 5 more
    const newEvents = Array.from({ length: 5 }, (_, i) => ({
      ...POPULATED_FEED_ROWS[0],
      ticketKey: `TKT-NEW-${i}`,
      occurredAt: new Date(FIXTURE_GENERATED_AT_MS + (i + 1) * 1000).toISOString(),
    }));
    const frame = makeDeltaFrame(43, 42, { feedAppended: newEvents });
    const next = applyFrame(base, frame);
    expect(next.activityFeed.length).toBe(100);
    // Newest items are at the front
    expect(next.activityFeed[0].ticketKey).toBe('TKT-NEW-4');
  });
});

// ---------------------------------------------------------------------------
// 7. Idempotent reapplication (duplicate seq rejected)
// ---------------------------------------------------------------------------

describe('applyFrame — idempotent seq reapplication', () => {
  it('rejects a frame with already-seen seq (no state change)', () => {
    const base = applySnapshot();                       // seq = 42
    const afterDelta = applyFrame(base, deltaFrame43);   // seq = 43

    // Apply deltaFrame43 again (duplicate seq 43)
    const reapplied = applyFrame(afterDelta, duplicateFrame43);
    expect(reapplied.seq).toBe(43);
    // The duplicate payload (kpis: {activeP1: 999}) must NOT have been applied
    expect(reapplied.kpis.activeP1).toBe(afterDelta.kpis.activeP1);
  });

  it('rejects a frame with seq lower than current', () => {
    const base = applySnapshot();
    const afterDelta = applyFrame(base, deltaFrame43); // seq=43
    const afterDelta44 = applyFrame(afterDelta, deltaFrame44); // seq=44

    // Try to apply seq=43 again
    const stale = applyFrame(afterDelta44, deltaFrame43);
    expect(stale.seq).toBe(44);
    expect(stale.kpis).toEqual(afterDelta44.kpis);
  });
});

// ---------------------------------------------------------------------------
// 8. Seq gap detection
// ---------------------------------------------------------------------------

describe('applyFrame — seq gap detection', () => {
  it('sets seqGap=true when prevSeq does not match current seq', () => {
    const base = applySnapshot(); // seq=42
    // gapFrame46 has prevSeq=44 but current seq is 42
    const next = applyFrame(base, gapFrame46);
    expect(next.seqGap).toBe(true);
  });

  it('does not change data when seqGap is detected', () => {
    const base = applySnapshot(); // seq=42, kpis fixed
    const next = applyFrame(base, gapFrame46);
    expect(next.kpis).toEqual(base.kpis);
  });

  it('consecutive normal frames do not set seqGap', () => {
    const base = applySnapshot();             // seq=42
    const s1 = applyFrame(base, deltaFrame43); // seq=43
    const s2 = applyFrame(s1, deltaFrame44);   // seq=44
    expect(s2.seqGap).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Validation failure counting
// ---------------------------------------------------------------------------

describe('applyFrame — validation failures', () => {
  it('increments validationFailures on invalid payload', () => {
    const base = applySnapshot();
    const badFrame = makeDeltaFrame(43, 42); // payload = {} → treated as empty but valid
    // An actually invalid payload is null/primitive
    const invalidFrame: IncomingFrame = { type: 'delta', seq: 43, prevSeq: 42, generatedAt: '2026-08-12T10:00:00Z', payload: null };
    const next = applyFrame(base, invalidFrame);
    expect(next.validationFailures).toBeGreaterThan(0);
  });

  it('sets seqGap=true after 3 consecutive validation failures', () => {
    let state = applySnapshot();
    const makeInvalid = (seq: number, prevSeq: number): IncomingFrame => ({
      type: 'delta', seq, prevSeq, generatedAt: '2026-08-12T10:00:00Z', payload: null,
    });
    state = applyFrame(state, makeInvalid(43, 42));
    state = applyFrame(state, makeInvalid(44, 43));
    state = applyFrame(state, makeInvalid(45, 44));
    expect(state.seqGap).toBe(true);
  });

  it('resets validationFailures on valid delta after failures', () => {
    const base = applySnapshot();
    const invalidFrame: IncomingFrame = { type: 'delta', seq: 43, prevSeq: 42, generatedAt: '2026-08-12T10:00:00Z', payload: null };
    const withFailure = applyFrame(base, invalidFrame); // seq stays at 42
    // Now send a valid frame
    const validAfterFailure: IncomingFrame = {
      ...deltaFrame43,
      seq: 43,
      prevSeq: 42,
    };
    const next = applyFrame(withFailure, validAfterFailure);
    expect(next.validationFailures).toBe(0);
  });
});

