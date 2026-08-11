/**
 * Declarative route authorization decorators.
 *
 * Usage:
 *   @RequirePermission(Permission.TICKETS_READ)
 *   @Get(':id')
 *   getTicket() { ... }
 *
 *   @Public()
 *   @Get('health')
 *   health() { ... }
 */

import { SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions';

export const REQUIRE_PERMISSION_KEY = 'opsninja:require_permission';
export const IS_PUBLIC_KEY = 'opsninja:is_public';

/**
 * Declares that the handler requires the caller to hold all listed permissions.
 * The AuthGuard reads this metadata and denies access if the principal's
 * effective permission set does not contain every listed permission.
 */
export const RequirePermission = (...permissions: Permission[]): ClassDecorator & MethodDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);

/**
 * Marks a handler or controller as publicly accessible (no authentication or
 * authorization required).  The AuthGuard skips all checks for routes decorated
 * with @Public().
 *
 * NOTE: @NoTenantContext() already implies auth bypass and should continue to
 * be used for auth routes that must not open a tenant transaction.
 */
export const Public = (): ClassDecorator & MethodDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
