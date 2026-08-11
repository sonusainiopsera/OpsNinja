/**
 * Org-scope filter for outbound delta frames.
 *
 * Agent-scoped principals may only see counters for organisations in their
 * assigned scope set. This function strips entries from orgBreakdown whose
 * organizationId is outside the socket's scope set.
 *
 * Rules:
 * - Empty scope set (admin/manager): all entries pass through unchanged.
 * - Non-empty scope set (scoped agent): only entries whose organizationId
 *   is in the set are returned; others are stripped.
 * - globalCounters always pass through unchanged.
 *
 * This is a pure function to enable exhaustive unit testing.
 */

import type { DeltaPayload, OrgBreakdownItem } from './frame.types';

/**
 * Apply org-scope filtering to a delta payload.
 *
 * @param payload     The raw delta payload from Redis.
 * @param scopeIds    The principal's org scope set. Empty = unrestricted.
 * @returns A new payload object with filtered orgBreakdown. Does not mutate input.
 */
export function applyOrgScopeFilter(
  payload: DeltaPayload,
  scopeIds: ReadonlySet<string>,
): DeltaPayload {
  if (scopeIds.size === 0) {
    // Unrestricted: pass through unchanged (no copy needed for read-only delivery).
    return payload;
  }

  const filteredBreakdown: OrgBreakdownItem[] = payload.orgBreakdown.filter(
    (item) => scopeIds.has(item.organizationId),
  );

  return {
    globalCounters: payload.globalCounters,
    orgBreakdown: filteredBreakdown,
  };
}
