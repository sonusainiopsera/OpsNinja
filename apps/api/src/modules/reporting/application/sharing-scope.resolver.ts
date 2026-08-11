/**
 * SharingScopeResolver — determines which report definitions a principal may see.
 *
 * Visibility predicate (any-of):
 *   • scope = 'private'  AND created_by = caller               (owner only)
 *   • scope = 'team'     (team-level sharing — visible to all principals
 *                         within the same tenant for now; can be refined when
 *                         a teams table exists)
 *   • scope = 'tenant'   (visible to everyone in the tenant)
 *
 * Out-of-scope definitions return 404, not 403, to avoid existence disclosure.
 *
 * Security: a shared definition is NEVER executed with the stored org scope.
 * The calling service must inject viewerOrgScopeIds from the live PrincipalContext.
 */

import { Injectable } from '@nestjs/common';
import type { ReportDefinition } from '@opsninja/db';

export interface ViewerContext {
  userId: string;
  tenantId: string;
  /** Roles list for future role-based team resolution. */
  roles: string[];
}

@Injectable()
export class SharingScopeResolver {
  /**
   * Returns true when the viewer is permitted to see this definition.
   *
   * Truth table:
   * | scope   | viewer = owner | result |
   * | private | yes            | true   |
   * | private | no             | false  |
   * | team    | any            | true   |
   * | tenant  | any            | true   |
   */
  canView(definition: ReportDefinition, viewer: ViewerContext): boolean {
    // Cross-tenant access is blocked by RLS, but double-check defensively.
    if (definition.tenantId !== viewer.tenantId) return false;

    switch (definition.sharingScope) {
      case 'private':
        return definition.createdBy === viewer.userId;
      case 'team':
      case 'tenant':
        return true;
      default:
        // Unknown scope — treat as private for safety.
        return definition.createdBy === viewer.userId;
    }
  }

  /**
   * Filters a list of definitions to those visible to the viewer.
   */
  filterVisible(
    definitions: ReportDefinition[],
    viewer: ViewerContext,
  ): ReportDefinition[] {
    return definitions.filter((d) => this.canView(d, viewer));
  }
}
