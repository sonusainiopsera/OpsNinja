/**
 * Redis key helpers — all dashboard keys are namespaced dash:{tenant}:*
 * so a cross-tenant key is structurally impossible.
 */

export const Keys = {
  kpi:          (t: string) => `dash:${t}:kpi`,
  category:     (t: string) => `dash:${t}:category`,
  affectedArea: (t: string) => `dash:${t}:affected_area`,
  orgLoad:      (t: string) => `dash:${t}:org_load`,
  breachRisk:   (t: string) => `dash:${t}:breach_risk`,
  feed:         (t: string) => `dash:${t}:feed`,
  meta:         (t: string) => `dash:${t}:meta`,
  dedup:        (t: string, eventId: string) => `dash:${t}:evt:${eventId}`,
  activeTenants: () => 'dash:active_tenants',

  // WO-069: delta publisher
  /** Last-published aggregate snapshot (compressed JSON) */
  published:    (t: string) => `dash:${t}:published`,
  /** Bounded ring buffer of recent frames (Redis list) */
  frames:       (t: string) => `dash:${t}:frames`,
  /** Per-interval atomic claim key — prevents multi-pod duplicate publish */
  claimInterval: (t: string, bucket: number) => `dash:${t}:claim:${bucket}`,
  /** Flag set by reconciler to force a snapshot frame on next publication */
  needsSnapshot: (t: string) => `dash:${t}:needs_snapshot`,
} as const;

export const FEED_MAX = 100;
export const DEDUP_TTL_SECONDS = 7 * 24 * 3600; // 7 days

// WO-069 constants
/** Default frame ring-buffer retention length (~10 minutes at 5s intervals) */
export const FRAME_RETENTION = 120;
/** Default ring-buffer TTL in seconds (15 minutes) */
export const FRAME_TTL_SECONDS = 15 * 60;
/** Per-interval claim TTL — slightly longer than the publish interval */
export const CLAIM_TTL_SECONDS = 10;
/** Max frame payload bytes before falling back to a snapshot frame */
export const MAX_FRAME_BYTES = 32 * 1024; // 32 KB
/** Max backfill frame count before responding with snapshot_required */
export const MAX_BACKFILL_FRAMES = 60;
