import { PrincipalContext } from '../../../observability/request-context';

/**
 * Discriminated variant of PrincipalContext for portal (customer-facing) principals.
 *
 * boundOrganizationId is derived from orgScopeIds[0] and is non-optional: portal
 * principals without an org binding must be rejected at the guard layer so nothing
 * in the system ever sees a PortalPrincipal with an empty organisation.
 */
export interface PortalPrincipal extends PrincipalContext {
  readonly principalKind: 'portal';
  readonly boundOrganizationId: string;
}

/**
 * Type guard: returns true only when the principal is a portal type with a valid
 * bound organisation.  Used by PortalVisibilityGuard before calling asPortalPrincipal.
 */
export function isPortalPrincipal(p: PrincipalContext): p is PortalPrincipal {
  return p.principalKind === 'portal' && p.orgScopeIds.length > 0;
}

/**
 * Narrows a PrincipalContext to PortalPrincipal, setting boundOrganizationId from
 * orgScopeIds[0].  Throws if the precondition is not met — call isPortalPrincipal
 * first or use inside code paths already guarded by PortalVisibilityGuard.
 */
export function asPortalPrincipal(p: PrincipalContext): PortalPrincipal {
  if (!isPortalPrincipal(p)) {
    throw new Error(
      'Principal is not a portal principal with a bound organisation. ' +
        `Got principalKind=${p.principalKind}, orgScopeIds.length=${p.orgScopeIds.length}`,
    );
  }
  return { ...p, principalKind: 'portal', boundOrganizationId: p.orgScopeIds[0] };
}
