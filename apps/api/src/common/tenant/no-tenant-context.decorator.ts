/**
 * @NoTenantContext — allow-list decorator for routes that must run without
 * a tenant-bound database transaction.
 *
 * Apply to controllers or individual route handlers that are exempt from the
 * TenantContextInterceptor. The interceptor reads this metadata via Reflector
 * before opening a transaction, so exempt routes skip the tenant setup entirely.
 *
 * Allowed exemptions (the interceptor performs a positive allow-list check,
 * so ANY controller not decorated with @NoTenantContext will be wrapped):
 *  - Health-check endpoints (no database access needed)
 *  - Auth callback endpoints (tenant not yet resolved; JWT issued here)
 *  - Jira webhook receiver (uses machine principal + manual context)
 *
 * Usage:
 *
 * @example Controller-level (all routes in this controller are exempt):
 * ```typescript
 * @NoTenantContext()
 * @Controller('health')
 * export class HealthController { ... }
 * ```
 *
 * @example Method-level (only this route is exempt):
 * ```typescript
 * @Controller('auth')
 * export class AuthController {
 *   @NoTenantContext()
 *   @Post('callback')
 *   async callback() { ... }
 * }
 * ```
 */

import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key used by TenantContextInterceptor to detect exempt routes.
 * Exported so that custom interceptors built on top of this one can also
 * check the same allow-list without hard-coding strings.
 */
export const NO_TENANT_CONTEXT_KEY = 'no_tenant_context';

/**
 * Decorator that marks a controller or route handler as exempt from the
 * tenant-context interceptor.
 */
export const NoTenantContext = (): MethodDecorator & ClassDecorator =>
  SetMetadata(NO_TENANT_CONTEXT_KEY, true);
