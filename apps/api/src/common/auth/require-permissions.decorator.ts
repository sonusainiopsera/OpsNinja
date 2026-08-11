/**
 * @RequirePermissions — plural alias for @RequirePermission.
 *
 * Uses the same metadata key so the existing AuthGuard reads it without
 * modification. Prefer this decorator on new route handlers; both forms
 * remain supported.
 *
 * @example
 * @RequirePermissions('org:manage_scopes')
 * @Put('agent-scopes/:userId')
 * replaceAgentScopes() { ... }
 */

import { SetMetadata } from '@nestjs/common';

import type { Permission } from './permission.catalog';

export { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';

/**
 * Declares one or more permissions required to invoke this route (any-of).
 * Identical semantics to @RequirePermission — uses the same metadata key.
 */
export const RequirePermissions = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata('require_permission', permissions);
