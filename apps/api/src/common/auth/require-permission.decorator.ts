/**
 * @RequirePermission — declares which permissions a route handler requires.
 *
 * The global AuthGuard reads this metadata via Reflector. If the authenticated
 * principal's resolved permission set contains at least one of the listed
 * permissions, the request is allowed. All listed permissions are OR-ed, not
 * AND-ed (any-of semantics).
 *
 * Types are checked at compile time against the Permission catalogue so a typo
 * produces a TypeScript error rather than a runtime authorization hole.
 *
 * @example
 * // Handler requires the caller to have ticket:read OR ticket:create
 * @RequirePermission('ticket:read', 'ticket:create')
 * @Get()
 * listTickets() { ... }
 */

import { SetMetadata } from '@nestjs/common';

import type { Permission } from './permission.catalog';

export const REQUIRE_PERMISSION_KEY = 'require_permission';

/**
 * Decorator that declares one or more permissions required to invoke this route.
 * A handler with no @RequirePermission and no @Public is denied by default.
 */
export const RequirePermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permissions);
