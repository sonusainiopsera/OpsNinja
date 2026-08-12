/**
 * Frame-sequence fixtures — WO-069 AC11, AC12
 *
 * Provides pre-built sequences of aggregate states and their expected frames,
 * used by:
 *  - Replay/idempotence tests (applying the same delta twice = same state)
 *  - Reconnect integration tests (backfill restores continuous-client state)
 *  - Snapshot_required tests (out-of-window seq triggers snapshot_required)
 */

import type { AggregateSnapshot } from '../../src/publish/aggregate-diff';

// ---------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------

export const FIXTURE_TENANT_ID = 'fixture-tenant-00000000-0000-0000-0000';

// ---------------------------------------------------------------------------
// Scripted timeline of aggregate states (t=0..4, one state per 5s interval)
// ---------------------------------------------------------------------------

/** State at t=0 (initial publish — triggers full snapshot frame) */
export const STATE_T0: AggregateSnapshot = {
  kpis:         { open_total: 10, active_p1: 2, running_slas: 4 },
  category:     [{ category: 'billing', count: 5 }, { category: 'tech', count: 5 }],
  affectedArea: [{ area: 'payments', count: 3 }],
  breachRisk:   [{ ticketId: 'TK-001', nextFireAt: 1_700_000_000 }],
  feed:         ['ev-001'],
};

/** State at t=1 — KPI changes + new feed entry */
export const STATE_T1: AggregateSnapshot = {
  kpis:         { open_total: 11, active_p1: 3, running_slas: 4 },
  category:     [{ category: 'billing', count: 6 }, { category: 'tech', count: 5 }],
  affectedArea: [{ area: 'payments', count: 3 }],
  breachRisk:   [{ ticketId: 'TK-001', nextFireAt: 1_700_000_000 }],
  feed:         ['ev-002', 'ev-001'],
};

/** State at t=2 — breach risk added + category change */
export const STATE_T2: AggregateSnapshot = {
  kpis:         { open_total: 12, active_p1: 3, running_slas: 5 },
  category:     [{ category: 'billing', count: 6 }, { category: 'tech', count: 6 }],
  affectedArea: [{ area: 'payments', count: 4 }],
  breachRisk:   [
    { ticketId: 'TK-001', nextFireAt: 1_700_000_000 },
    { ticketId: 'TK-002', nextFireAt: 1_700_001_000 },
  ],
  feed:         ['ev-003', 'ev-002', 'ev-001'],
};

/** State at t=3 — client disconnects before this; breach risk removed */
export const STATE_T3: AggregateSnapshot = {
  kpis:         { open_total: 11, active_p1: 2, running_slas: 5 },
  category:     [{ category: 'billing', count: 6 }, { category: 'tech', count: 5 }],
  affectedArea: [{ area: 'payments', count: 4 }],
  breachRisk:   [{ ticketId: 'TK-001', nextFireAt: 1_700_000_000 }],
  feed:         ['ev-004', 'ev-003', 'ev-002', 'ev-001'],
};

/** State at t=4 — final state for integration assertions */
export const STATE_T4: AggregateSnapshot = {
  kpis:         { open_total: 11, active_p1: 2, running_slas: 6 },
  category:     [{ category: 'billing', count: 6 }, { category: 'tech', count: 5 }],
  affectedArea: [{ area: 'payments', count: 4 }, { area: 'auth', count: 1 }],
  breachRisk:   [{ ticketId: 'TK-001', nextFireAt: 1_700_000_000 }],
  feed:         ['ev-005', 'ev-004', 'ev-003', 'ev-002', 'ev-001'],
};

/** All states in timeline order */
export const STATES = [STATE_T0, STATE_T1, STATE_T2, STATE_T3, STATE_T4] as const;

// ---------------------------------------------------------------------------
// Pre-built frame sequence for replay/idempotence testing
//
// Each entry is the expected frame JSON that the publisher would emit when
// transitioning from the previous state to the current one.
// seq values start at 1 (t=0 = full snapshot, seq=1).
// ---------------------------------------------------------------------------

export interface FixtureFrame {
  seq: number;
  prevSeq: number;
  type: 'delta' | 'snapshot';
  tenantId: string;
  generatedAt: string;
  payload: unknown;
}

/** Frame at seq=1: full snapshot (no previous state) */
export const FRAME_SEQ_1: FixtureFrame = {
  seq:         1,
  prevSeq:     0,
  type:        'snapshot',
  tenantId:    FIXTURE_TENANT_ID,
  generatedAt: '2026-01-01T00:00:00.000Z',
  payload:     STATE_T0,
};

/** Frame at seq=2: delta from t=0 → t=1 */
export const FRAME_SEQ_2: FixtureFrame = {
  seq:         2,
  prevSeq:     1,
  type:        'delta',
  tenantId:    FIXTURE_TENANT_ID,
  generatedAt: '2026-01-01T00:00:05.000Z',
  payload: {
    kpis:          { open_total: 11, active_p1: 3 },
    categoryDelta: [{ categoryPath: 'billing', count: 6 }],
    feedAppended:  ['ev-002'],
  },
};

/** Frame at seq=3: delta from t=1 → t=2 */
export const FRAME_SEQ_3: FixtureFrame = {
  seq:         3,
  prevSeq:     2,
  type:        'delta',
  tenantId:    FIXTURE_TENANT_ID,
  generatedAt: '2026-01-01T00:00:10.000Z',
  payload: {
    kpis:             { open_total: 12, running_slas: 5 },
    categoryDelta:    [{ categoryPath: 'tech', count: 6 }],
    affectedAreaDelta:[{ areaTag: 'payments', count: 4 }],
    breachRiskAdded:  [{ ticketId: 'TK-002', nextFireAt: 1_700_001_000 }],
    feedAppended:     ['ev-003'],
  },
};

/** Frame at seq=4: delta from t=2 → t=3 (disconnected client misses this) */
export const FRAME_SEQ_4: FixtureFrame = {
  seq:         4,
  prevSeq:     3,
  type:        'delta',
  tenantId:    FIXTURE_TENANT_ID,
  generatedAt: '2026-01-01T00:00:15.000Z',
  payload: {
    kpis:            { open_total: 11, active_p1: 2 },
    categoryDelta:   [{ categoryPath: 'tech', count: 5 }],
    breachRiskRemoved: ['TK-002'],
    feedAppended:    ['ev-004'],
  },
};

/** Frame at seq=5: delta from t=3 → t=4 (disconnected client misses this too) */
export const FRAME_SEQ_5: FixtureFrame = {
  seq:         5,
  prevSeq:     4,
  type:        'delta',
  tenantId:    FIXTURE_TENANT_ID,
  generatedAt: '2026-01-01T00:00:20.000Z',
  payload: {
    kpis:             { running_slas: 6 },
    affectedAreaDelta:[{ areaTag: 'auth', count: 1 }],
    feedAppended:     ['ev-005'],
  },
};

export const ALL_FRAMES = [FRAME_SEQ_1, FRAME_SEQ_2, FRAME_SEQ_3, FRAME_SEQ_4, FRAME_SEQ_5] as const;

// ---------------------------------------------------------------------------
// Reconnect scenario helpers
// ---------------------------------------------------------------------------

/**
 * Simulates the ring-buffer content when a client disconnects after seq=3
 * and reconnects at seq=3.  The ring buffer contains seq 1..5.
 * Expected backfill: frames 4 and 5.
 */
export const RECONNECT_SCENARIO = {
  clientLastSeq:   3,
  ringBuffer:      [FRAME_SEQ_1, FRAME_SEQ_2, FRAME_SEQ_3, FRAME_SEQ_4, FRAME_SEQ_5],
  expectedBackfill:[FRAME_SEQ_4, FRAME_SEQ_5],
  /** Final expected state after applying backfill from seq=3 */
  expectedFinalState: STATE_T4,
};

/**
 * Scenario where the client's lastSeq is before the retention window.
 * Ring buffer holds only seq 4..5; client reports lastSeq=1.
 * Expected result: snapshot_required.
 */
export const OUT_OF_WINDOW_SCENARIO = {
  clientLastSeq:  1,
  ringBuffer:     [FRAME_SEQ_4, FRAME_SEQ_5],
  expectedResult: 'snapshot_required' as const,
  reason:         'seq_out_of_window' as const,
};
