/**
 * Snapshot response DTO shapes — WO-068.
 *
 * These interfaces describe the JSON sent to the client. They are not Zod
 * schemas because we control the production path end-to-end.
 */

// ---------------------------------------------------------------------------
// Sub-shapes
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
  /** ISO-8601 UTC instant by which the SLA must be met. */
  targetAt: string;
  /** Accumulated paused milliseconds. */
  pausedMs: number;
  /**
   * Remaining milliseconds at generatedAt.
   * Negative means the SLA has already breached.
   */
  remainingMs: number;
}

export interface CategoryRow {
  categoryPath: string;
  count: number;
}

export interface AffectedAreaRow {
  areaTag: string;
  count: number;
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

// ---------------------------------------------------------------------------
// Top-level response
// ---------------------------------------------------------------------------

export interface SnapshotResponse {
  /**
   * Aggregate sequence number from Redis meta. null when served from Postgres
   * (degraded path) — the client must enter polling mode.
   */
  seq: number | null;
  /** ISO-8601 UTC timestamp of when this snapshot was generated. */
  generatedAt: string;
  /** 'cache' when served from Redis aggregates; 'database' on fallback. */
  source: 'cache' | 'database';
  /** true when Redis was unavailable and data was recomputed from Postgres. */
  degraded: boolean;
  kpis: DashboardKpis;
  breachRisk: BreachRiskRow[];
  categoryBreakdown: CategoryRow[];
  affectedAreaBreakdown: AffectedAreaRow[];
  orgLoad: OrgLoadRow[];
  activityFeed: ActivityFeedRow[];
}
