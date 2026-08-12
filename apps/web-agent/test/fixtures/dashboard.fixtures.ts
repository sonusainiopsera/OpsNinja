/**
 * Dashboard test fixtures (WO-070, AC13).
 *
 * Committed fixtures for:
 *   1. populatedSnapshot — realistic snapshot with all data populated
 *   2. emptyTenantSnapshot — zeroed KPIs, empty arrays (empty-tenant state)
 *   3. degradedSnapshot — degraded=true, seq=null, no WS join
 *   4. frameSequence — delta frame sequence including a gap and snapshot_required
 */

import type { SnapshotResponse, BreachRiskRow, ActivityFeedRow } from '../../lib/api/dashboard';
import type { IncomingFrame } from '../../features/dashboard/state/apply-delta';

// ---------------------------------------------------------------------------
// Deterministic timestamps (no Date.now() in fixtures for reproducibility)
// ---------------------------------------------------------------------------

export const FIXTURE_GENERATED_AT = '2026-08-12T10:00:00.000Z';
export const FIXTURE_GENERATED_AT_MS = new Date(FIXTURE_GENERATED_AT).getTime();

// ---------------------------------------------------------------------------
// 1. Populated snapshot (AC13)
// ---------------------------------------------------------------------------

export const POPULATED_BREACH_ROWS: BreachRiskRow[] = [
  {
    ticketId: 'ticket-0000-0000-0000-000000000001',
    ticketKey: 'TKT-0001',
    priority: 'P1',
    organizationId: 'org-00000-0000-0000-000000000001',
    organizationName: 'Acme Corp',
    timerState: 'running',
    targetAt: '2026-08-12T11:00:00.000Z',
    pausedMs: 0,
    remainingMs: 45 * 60 * 1000, // 45 minutes
  },
  {
    ticketId: 'ticket-0000-0000-0000-000000000002',
    ticketKey: 'TKT-0002',
    priority: 'P2',
    organizationId: 'org-00000-0000-0000-000000000002',
    organizationName: 'Beta Ltd',
    timerState: 'running',
    targetAt: '2026-08-12T12:00:00.000Z',
    pausedMs: 0,
    remainingMs: 5 * 60 * 1000, // 5 minutes — approaching breach
  },
  {
    ticketId: 'ticket-0000-0000-0000-000000000003',
    ticketKey: 'TKT-0003',
    priority: 'P1',
    organizationId: 'org-00000-0000-0000-000000000001',
    organizationName: 'Acme Corp',
    timerState: 'paused',
    targetAt: '2026-08-12T13:00:00.000Z',
    pausedMs: 10 * 60 * 1000,
    remainingMs: 120 * 60 * 1000, // 2 hours but paused
  },
];

export const POPULATED_FEED_ROWS: ActivityFeedRow[] = [
  {
    eventType: 'ticket.created',
    ticketId: 'ticket-0000-0000-0000-000000000004',
    ticketKey: 'TKT-0004',
    priority: 'P2',
    organizationId: 'org-00000-0000-0000-000000000001',
    actorRole: 'agent',
    occurredAt: '2026-08-12T09:55:00.000Z',
  },
  {
    eventType: 'sla.breached',
    ticketId: 'ticket-0000-0000-0000-000000000005',
    ticketKey: 'TKT-0005',
    priority: 'P1',
    organizationId: 'org-00000-0000-0000-000000000002',
    actorRole: 'system',
    occurredAt: '2026-08-12T09:50:00.000Z',
  },
  {
    eventType: 'comment.created',
    ticketId: 'ticket-0000-0000-0000-000000000001',
    ticketKey: 'TKT-0001',
    priority: 'P1',
    organizationId: 'org-00000-0000-0000-000000000001',
    actorRole: 'agent',
    occurredAt: '2026-08-12T09:45:00.000Z',
  },
];

export const populatedSnapshot: SnapshotResponse = {
  seq: 42,
  generatedAt: FIXTURE_GENERATED_AT,
  source: 'cache',
  degraded: false,
  kpis: {
    activeP1: 3,
    activeP2: 7,
    openTotal: 48,
    runningSlas: 12,
    approachingBreach: 2,
    csat7d: 87.5,
  },
  breachRisk: POPULATED_BREACH_ROWS,
  categoryBreakdown: [
    { categoryPath: 'Infrastructure/Networking', count: 14 },
    { categoryPath: 'Application/Login', count: 9 },
    { categoryPath: 'Application/Performance', count: 7 },
    { categoryPath: 'Infrastructure/Database', count: 5 },
    { categoryPath: 'Billing', count: 4 },
  ],
  affectedAreaBreakdown: [
    { areaTag: 'authentication', count: 12, aiIncomplete: false },
    { areaTag: 'payment-gateway', count: 8, aiIncomplete: true }, // AI incomplete
    { areaTag: 'reporting', count: 5, aiIncomplete: false },
    { areaTag: 'data-import', count: 3, aiIncomplete: false },
  ],
  orgLoad: [
    { organizationId: 'org-00000-0000-0000-000000000001', organizationName: 'Acme Corp', openCount: 22 },
    { organizationId: 'org-00000-0000-0000-000000000002', organizationName: 'Beta Ltd', openCount: 15 },
    { organizationId: 'org-00000-0000-0000-000000000003', organizationName: 'Gamma Inc', openCount: 11 },
  ],
  activityFeed: POPULATED_FEED_ROWS,
};

// ---------------------------------------------------------------------------
// 2. Empty-tenant snapshot (AC13)
// ---------------------------------------------------------------------------

export const emptyTenantSnapshot: SnapshotResponse = {
  seq: 1,
  generatedAt: FIXTURE_GENERATED_AT,
  source: 'cache',
  degraded: false,
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

// ---------------------------------------------------------------------------
// 3. Degraded snapshot (AC6, AC13)
// ---------------------------------------------------------------------------

export const degradedSnapshot: SnapshotResponse = {
  seq: null,           // null seq → client must skip WS, enter polling
  generatedAt: FIXTURE_GENERATED_AT,
  source: 'database',  // served from Postgres fallback
  degraded: true,
  degradedReason: 'Redis unavailable — data served from Postgres replica with up to 60 s lag.',
  kpis: {
    activeP1: 2,
    activeP2: 5,
    openTotal: 30,
    runningSlas: 8,
    approachingBreach: 1,
    csat7d: 82.0,
  },
  breachRisk: POPULATED_BREACH_ROWS.slice(0, 1),
  categoryBreakdown: [
    { categoryPath: 'Infrastructure/Networking', count: 10 },
  ],
  affectedAreaBreakdown: [
    { areaTag: 'authentication', count: 8, aiIncomplete: false },
  ],
  orgLoad: [
    { organizationId: 'org-00000-0000-0000-000000000001', organizationName: 'Acme Corp', openCount: 18 },
  ],
  activityFeed: POPULATED_FEED_ROWS.slice(0, 1),
};

// ---------------------------------------------------------------------------
// 4. Frame sequence fixtures (AC13)
//
//    Seq 43 — normal delta after snapshot (seq 42)
//    Seq 44 — another normal delta
//    Seq 46 — GAP (seq 45 missing) — triggers snapshot refetch
//    snapshot_required frame — triggers refetch-and-resubscribe
// ---------------------------------------------------------------------------

/** Normal delta at seq 43, after snapshot at seq 42. */
export const deltaFrame43: IncomingFrame = {
  type: 'delta',
  seq: 43,
  prevSeq: 42,
  generatedAt: '2026-08-12T10:00:05.000Z',
  payload: {
    kpis: { activeP1: 1 },                    // +1 active P1
    breachRiskAdded: [
      {
        ticketId: 'ticket-0000-0000-0000-000000000006',
        ticketKey: 'TKT-0006',
        priority: 'P2',
        organizationId: 'org-00000-0000-0000-000000000002',
        organizationName: 'Beta Ltd',
        timerState: 'running',
        targetAt: '2026-08-12T14:00:00.000Z',
        pausedMs: 0,
        remainingMs: 240 * 60 * 1000,
      } satisfies BreachRiskRow,
    ],
    feedAppended: [
      {
        eventType: 'ticket.created',
        ticketId: 'ticket-0000-0000-0000-000000000006',
        ticketKey: 'TKT-0006',
        priority: 'P2',
        organizationId: 'org-00000-0000-0000-000000000002',
        actorRole: 'portal_user',
        occurredAt: '2026-08-12T10:00:04.000Z',
      } satisfies ActivityFeedRow,
    ],
  },
};

/** Normal delta at seq 44. */
export const deltaFrame44: IncomingFrame = {
  type: 'delta',
  seq: 44,
  prevSeq: 43,
  generatedAt: '2026-08-12T10:00:10.000Z',
  payload: {
    kpis: { openTotal: -1 }, // one ticket resolved
    breachRiskRemoved: ['ticket-0000-0000-0000-000000000003'],
  },
};

/** Gap frame: prevSeq=44 but seq=46 — seq 45 is missing. */
export const gapFrame46: IncomingFrame = {
  type: 'delta',
  seq: 46,
  prevSeq: 44, // should be 45 — intentional gap
  generatedAt: '2026-08-12T10:00:20.000Z',
  payload: {
    kpis: { activeP2: -1 },
  },
};

/** snapshot_required control frame (triggers refetch-and-resubscribe). */
export const snapshotRequiredFrame: IncomingFrame = {
  type: 'snapshot',  // reuses snapshot type to signal that a new snapshot is needed
  seq: 0,
  prevSeq: 0,
  generatedAt: FIXTURE_GENERATED_AT,
  payload: { type: 'snapshot_required' },
};

/** Idempotent reapplication: same seq as deltaFrame43 — must be a no-op. */
export const duplicateFrame43: IncomingFrame = {
  ...deltaFrame43,
  payload: {
    kpis: { activeP1: 999 }, // would corrupt state if applied
  },
};

// ---------------------------------------------------------------------------
// Helper: build a snapshot IncomingFrame from a SnapshotResponse
// ---------------------------------------------------------------------------

export function snapshotToFrame(snap: SnapshotResponse): IncomingFrame {
  return {
    type: 'snapshot',
    seq: snap.seq ?? 0,
    prevSeq: 0,
    generatedAt: snap.generatedAt,
    payload: snap,
  };
}
