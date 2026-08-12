/**
 * applyDelta — pure reducer for dashboard frame application (WO-070, AC3).
 *
 * Accepts the current DashboardState and an incoming server frame, returns the
 * next state. Free of framework / network concerns — fully unit-testable and
 * provably idempotent by seq.
 *
 * Rules:
 *   - Out-of-order or already-seen seq is rejected (state unchanged).
 *   - A seq gap (frame.seq !== state.seq + 1) is flagged via seqGap=true so
 *     the stream hook knows to trigger a snapshot refetch.
 *   - Snapshot frames replace all data fields and reset seqGap.
 *   - Delta frames merge KPIs, upsert/remove category & affected-area rows,
 *     upsert/remove breach-risk rows, and append feed items capped at 100.
 */

import type {
  SnapshotResponse,
  BreachRiskRow,
  CategoryRow,
  AffectedAreaRow,
  OrgLoadRow,
  ActivityFeedRow,
  DashboardKpis,
} from '../../../lib/api/dashboard';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface DashboardState {
  /** null until first snapshot received. */
  snapshot: SnapshotResponse | null;
  /** Last successfully applied seq. */
  seq: number | null;
  /** ISO-8601 of when the last frame was generated server-side. */
  generatedAt: string | null;
  /** True when a seq gap was detected — hook must refetch snapshot. */
  seqGap: boolean;
  /** Count of consecutive frame-validation failures. */
  validationFailures: number;
  /** KPI counters. */
  kpis: DashboardKpis;
  /** Breach-risk rows keyed by ticketId. */
  breachRisk: BreachRiskRow[];
  /** Category breakdown. */
  categoryBreakdown: CategoryRow[];
  /** Affected-area breakdown. */
  affectedAreaBreakdown: AffectedAreaRow[];
  /** Org-load rows. */
  orgLoad: OrgLoadRow[];
  /** Activity feed, newest-first, capped at 100 entries. */
  activityFeed: ActivityFeedRow[];
}

export const INITIAL_DASHBOARD_STATE: DashboardState = {
  snapshot: null,
  seq: null,
  generatedAt: null,
  seqGap: false,
  validationFailures: 0,
  kpis: {
    activeP1: 0,
    activeP2: 0,
    openTotal: 0,
    runningSlas: 0,
    approachingBreach: 0,
    csat7d: 0,
  },
  breachRisk: [],
  categoryBreakdown: [],
  affectedAreaBreakdown: [],
  orgLoad: [],
  activityFeed: [],
};

// Maximum feed entries retained client-side.
const FEED_CAP = 100;

// ---------------------------------------------------------------------------
// Wire frame types (subset needed here — avoid importing from realtime-gateway)
// ---------------------------------------------------------------------------

export interface WireDeltaPayload {
  kpis?: Record<string, number>;
  categoryDelta?: Array<{ categoryPath: string; count: number }>;
  affectedAreaDelta?: Array<{ areaTag: string; count: number }>;
  breachRiskAdded?: BreachRiskRow[];
  breachRiskRemoved?: string[];
  feedAppended?: ActivityFeedRow[];
}

export interface WireSnapshotPayload extends SnapshotResponse {}

export type IncomingFrame =
  | { type: 'delta'; seq: number; prevSeq: number; generatedAt: string; payload: unknown }
  | { type: 'snapshot'; seq: number; prevSeq: number; generatedAt: string; payload: unknown };

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateDeltaPayload(raw: unknown): WireDeltaPayload | null {
  if (!isObject(raw)) return null;
  return raw as WireDeltaPayload;
}

function validateSnapshotPayload(raw: unknown): WireSnapshotPayload | null {
  if (!isObject(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!isObject(r['kpis'])) return null;
  if (!Array.isArray(r['breachRisk'])) return null;
  return raw as WireSnapshotPayload;
}

// ---------------------------------------------------------------------------
// Pure reducer
// ---------------------------------------------------------------------------

/**
 * Apply an incoming server frame to the current dashboard state.
 * Always returns a new state object (no mutation).
 */
export function applyFrame(state: DashboardState, frame: IncomingFrame): DashboardState {
  if (frame.type === 'snapshot') {
    return applySnapshotFrame(state, frame);
  }
  if (frame.type === 'delta') {
    return applyDeltaFrame(state, frame);
  }
  return state;
}

function applySnapshotFrame(
  state: DashboardState,
  frame: { seq: number; generatedAt: string; payload: unknown },
): DashboardState {
  const payload = validateSnapshotPayload(frame.payload);
  if (!payload) {
    return { ...state, validationFailures: state.validationFailures + 1 };
  }

  const snap = payload as SnapshotResponse;
  return {
    ...state,
    snapshot: snap,
    seq: frame.seq,
    generatedAt: frame.generatedAt,
    seqGap: false,
    validationFailures: 0,
    kpis: snap.kpis,
    breachRisk: snap.breachRisk,
    categoryBreakdown: snap.categoryBreakdown,
    affectedAreaBreakdown: snap.affectedAreaBreakdown,
    orgLoad: snap.orgLoad,
    activityFeed: snap.activityFeed,
  };
}

function applyDeltaFrame(
  state: DashboardState,
  frame: { seq: number; prevSeq: number; generatedAt: string; payload: unknown },
): DashboardState {
  // Idempotency: already applied
  if (state.seq !== null && frame.seq <= state.seq) {
    return state;
  }

  // Seq gap: expected prevSeq doesn't match current seq
  const expectedPrev = state.seq ?? 0;
  if (frame.prevSeq !== expectedPrev) {
    return { ...state, seqGap: true };
  }

  const payload = validateDeltaPayload(frame.payload);
  if (!payload) {
    const failures = state.validationFailures + 1;
    return { ...state, validationFailures: failures, seqGap: failures >= 3 };
  }

  let { kpis, categoryBreakdown, affectedAreaBreakdown, breachRisk, activityFeed } = state;

  // Apply KPI deltas
  if (payload.kpis && Object.keys(payload.kpis).length > 0) {
    kpis = { ...kpis };
    for (const [k, v] of Object.entries(payload.kpis)) {
      const key = k as keyof DashboardKpis;
      if (key in kpis) {
        kpis[key] = Math.max(0, (kpis[key] ?? 0) + v);
      }
    }
  }

  // Apply category delta (upsert by categoryPath)
  if (payload.categoryDelta) {
    const map = new Map(categoryBreakdown.map((r) => [r.categoryPath, r]));
    for (const d of payload.categoryDelta) {
      if (d.count === 0) {
        map.delete(d.categoryPath);
      } else {
        map.set(d.categoryPath, { categoryPath: d.categoryPath, count: d.count });
      }
    }
    categoryBreakdown = Array.from(map.values());
  }

  // Apply affected-area delta (upsert by areaTag)
  if (payload.affectedAreaDelta) {
    const map = new Map(affectedAreaBreakdown.map((r) => [r.areaTag, r]));
    for (const d of payload.affectedAreaDelta) {
      if (d.count === 0) {
        map.delete(d.areaTag);
      } else {
        map.set(d.areaTag, { areaTag: d.areaTag, count: d.count });
      }
    }
    affectedAreaBreakdown = Array.from(map.values());
  }

  // Apply breach-risk changes
  if (payload.breachRiskAdded || payload.breachRiskRemoved) {
    const map = new Map(breachRisk.map((r) => [r.ticketId, r]));
    if (payload.breachRiskRemoved) {
      for (const id of payload.breachRiskRemoved) map.delete(id);
    }
    if (payload.breachRiskAdded) {
      for (const row of payload.breachRiskAdded) map.set(row.ticketId, row);
    }
    breachRisk = Array.from(map.values());
  }

  // Append feed entries (newest first, cap at FEED_CAP)
  if (payload.feedAppended && payload.feedAppended.length > 0) {
    activityFeed = [...payload.feedAppended, ...activityFeed].slice(0, FEED_CAP);
  }

  return {
    ...state,
    seq: frame.seq,
    generatedAt: frame.generatedAt,
    seqGap: false,
    validationFailures: 0,
    kpis,
    categoryBreakdown,
    affectedAreaBreakdown,
    breachRisk,
    activityFeed,
  };
}
