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
} as const;

export const FEED_MAX = 100;
export const DEDUP_TTL_SECONDS = 7 * 24 * 3600; // 7 days
