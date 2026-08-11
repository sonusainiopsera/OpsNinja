/**
 * PortalPrincipal — discriminated variant of PrincipalContext for portal users.
 *
 * Portal users are the least-trusted principal population: they are external
 * customer contacts bound to exactly one organisation at token mint time.
 * This type narrows PrincipalContext so the compiler forces handling of the
 * portal case wherever org-scope or visibility predicates are applied.
 *
 * Usage:
 *   const principal = getPrincipalContext();
 *   if (isPortalPrincipal(principal)) {
 *     // principal.boundOrganizationId is guaranteed non-null here
 *   }
 */

import type { PrincipalContext } from '../../../observability/request-context';

/**
 * Narrowed principal type for portal (customer portal) callers.
 * boundOrganizationId is required and non-nullable — it is set at token mint
 * time and carried through the auth guard into the request context.
 */
export interface PortalPrincipal extends PrincipalContext {
  principalKind: 'portal';
  /** The single organisation this portal user is scoped to. Never null. */
  boundOrganizationId: string;
}

/**
 * Type-guard: returns true when p is a portal principal with a bound org.
 * Repositories and services use this to branch on the portal case.
 */
export function isPortalPrincipal(p: PrincipalContext): p is PortalPrincipal {
  return (
    p.principalKind === 'portal' &&
    typeof (p as PortalPrincipal).boundOrganizationId === 'string' &&
    (p as PortalPrincipal).boundOrganizationId.length > 0
  );
}

/**
 * Assertion variant: throws a programming error (TENANT_CONTEXT_MISSING) when
 * the principal is not a portal principal. Called inside portal controller
 * handlers as a second defence layer after the PortalVisibilityGuard.
 */
export function assertPortalPrincipal(p: PrincipalContext): asserts p is PortalPrincipal {
  if (!isPortalPrincipal(p)) {
    const err = new Error(
      `Expected a portal principal but got principalKind=${p.principalKind}. ` +
        'Ensure the PortalVisibilityGuard is applied to this route.',
    );
    (err as NodeJS.ErrnoException).code = 'TENANT_CONTEXT_MISSING';
    throw err;
  }
}
