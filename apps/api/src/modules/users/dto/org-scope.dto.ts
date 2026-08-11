/**
 * DTOs for the WO-013 user org-scope endpoints.
 *
 * GET  /api/v1/users/:userId/org-scope
 * PUT  /api/v1/users/:userId/org-scope
 */

export interface GetUserOrgScopeResponse {
  userId: string;
  /** true when the user has no org restrictions (tenant-wide access within their role). */
  tenantWide: boolean;
  organizationIds: string[];
  scopeVersion: number;
}

export interface ReplaceUserOrgScopeRequest {
  /**
   * When true, clears all org restrictions — user sees all tenant data within their role.
   * Mutually exclusive with a non-empty organizationIds list.
   */
  tenantWide?: boolean;
  /** Replacement list of organization IDs. Must all belong to the caller's tenant. */
  organizationIds: string[];
}

export interface ReplaceUserOrgScopeResponse {
  scopeVersion: number;
  /** Organization IDs that were added relative to the previous scope set. */
  added: string[];
  /** Organization IDs that were removed relative to the previous scope set. */
  removed: string[];
}
