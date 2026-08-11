import { SetMetadata } from '@nestjs/common';

/**
 * Marks a controller or route handler as a portal-surface endpoint.
 *
 * The AuthGuard reads this metadata to enforce audience separation:
 *   - A portal token (@PortalRoute) on a non-portal route → 403 AUTHZ_AUDIENCE_MISMATCH
 *   - A non-portal token on a @PortalRoute → 403 AUTHZ_AUDIENCE_MISMATCH
 *
 * Apply at class level on portal controllers so all methods inherit the marker.
 */
export const PORTAL_ROUTE_KEY = 'portal_route';
export const PortalRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PORTAL_ROUTE_KEY, true);
