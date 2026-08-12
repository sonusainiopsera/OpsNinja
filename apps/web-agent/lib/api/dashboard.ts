/**
 * Dashboard API client — snapshot fetch for the live dashboard (WO-070).
 *
 * GET /api/v1/dashboard/snapshot
 * Returns SnapshotResponse from the dashboard module (WO-068).
 */

import { request } from './client';

// ---------------------------------------------------------------------------
// Snapshot response types (mirrors apps/api snapshot-response.dto.ts)
// ---------------------------------------------------------------------------

export interface DashboardKpis {
  activeP1: number;
  activeP2: number;
  openTotal: number;
  runningSlas: number;
  approachingBreach: number;
  csat7d: number;
}

export interface BreachRiskRow {
  ticketId: string;
  ticketKey: string;
  priority: string;
  organizationId: string;
  organizationName: string;
  timerState: string;
  /** ISO-8601 UTC — the deadline the SLA must be met by. */
  targetAt: string;
  /** Accumulated paused milliseconds. */
  pausedMs: number;
  /** Remaining milliseconds at generatedAt. Negative means already breached. */
  remainingMs: number;
}

export interface CategoryRow {
  categoryPath: string;
  count: number;
}

export interface AffectedAreaRow {
  areaTag: string;
  count: number;
  /** true when at least one ticket in the window has ai_status pending/failed */
  aiIncomplete?: boolean;
}

export interface OrgLoadRow {
  organizationId: string;
  organizationName: string;
  openCount: number;
}

export interface ActivityFeedRow {
  eventType: string;
  ticketId: string;
  ticketKey: string;
  priority: string;
  organizationId: string;
  actorRole: string;
  occurredAt: string;
}

export interface SnapshotResponse {
  /**
   * Aggregate sequence number. null when served from Postgres (degraded) —
   * the client must skip WebSocket join and enter polling mode.
   */
  seq: number | null;
  /** ISO-8601 UTC when the snapshot was generated. */
  generatedAt: string;
  /** 'cache' = from Redis aggregates; 'database' = Postgres fallback. */
  source: 'cache' | 'database';
  /** true when Redis was unavailable and data was recomputed from Postgres. */
  degraded: boolean;
  /** Reason text when degraded, displayed in the delayed-data banner. */
  degradedReason?: string;
  /** true when some tickets have ai_status pending or failed in the window. */
  aiCoverageIncomplete?: boolean;
  kpis: DashboardKpis;
  breachRisk: BreachRiskRow[];
  categoryBreakdown: CategoryRow[];
  affectedAreaBreakdown: AffectedAreaRow[];
  orgLoad: OrgLoadRow[];
  activityFeed: ActivityFeedRow[];
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

export async function fetchDashboardSnapshot(): Promise<SnapshotResponse> {
  const res = await request<SnapshotResponse>('GET', '/dashboard/snapshot');
  return res;
}
