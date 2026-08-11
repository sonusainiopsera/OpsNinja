/**
 * OrgScopeFilter – strips organisation breakdown entries that are outside
 * the socket principal's assigned org scope set.
 *
 * Frame shape (inbound from Redis):
 * {
 *   type: 'delta' | 'snapshot_required',
 *   tenantId: string,
 *   seq: number,
 *   sentAt: string,
 *   payload: {
 *     orgBreakdown?: Array<{ organization_id: string; [key: string]: unknown }>;
 *     [key: string]: unknown;
 *   }
 * }
 *
 * Agent-scoped principals (non-empty orgScopeIds) receive only entries whose
 * organization_id is in their set.  Tenant-wide principals (empty set) receive
 * all entries unchanged.
 *
 * An empty orgScopeIds set → deliver tenant totals only, empty breakdowns.
 * This is intentional: empty scope means "no orgs assigned yet", not "all orgs".
 */

export interface DashboardFrame {
  type: string;
  tenantId: string;
  seq: number;
  sentAt: string;
  payload: {
    orgBreakdown?: Array<{ organization_id: string } & Record<string, unknown>>;
    [key: string]: unknown;
  };
}

export function filterFrameForSocket(
  frame: DashboardFrame,
  orgScopeIds: Set<string>,
  isTenantWide: boolean,
): DashboardFrame {
  // Tenant-wide principals (admin/manager etc.) receive full frame unmodified
  if (isTenantWide) return frame;

  const breakdown = frame.payload.orgBreakdown;
  if (!breakdown || breakdown.length === 0) return frame;

  const filtered = breakdown.filter((entry) => orgScopeIds.has(entry.organization_id));

  return {
    ...frame,
    payload: {
      ...frame.payload,
      orgBreakdown: filtered,
    },
  };
}

/** Roles that receive all org data without scope filtering. */
const TENANT_WIDE_ROLES = new Set([
  'admin',
  'supervisor',
  'manager',
  'lead',
  'analyst',
  'readonly',
  'worker',
  'integration_admin',
]);

export function isTenantWideRole(roles: string[]): boolean {
  return roles.some((r) => TENANT_WIDE_ROLES.has(r));
}
