/**
 * @Public — marks a route or controller as publicly accessible.
 *
 * Routes decorated with @Public bypass the AuthGuard entirely:
 * no bearer token is required and no permission check is performed.
 *
 * Use for:
 *   - Health-check endpoints (load balancer probes)
 *   - Auth endpoints (refresh/logout — use httpOnly cookie, not bearer)
 *   - Jira webhook receiver (HMAC-authenticated separately)
 *
 * @example Controller-level (all routes in this controller are public):
 * ```typescript
 * @Public()
 * @Controller('health')
 * export class HealthController { ... }
 * ```
 *
 * @example Method-level:
 * ```typescript
 * @Controller('auth')
 * export class AuthController {
 *   @Public()
 *   @Post('refresh')
 *   async refresh() { ... }
 * }
 * ```
 */

import { SetMetadata } from '@nestjs/common';

export const PUBLIC_KEY = 'is_public';

/**
 * Decorator that marks a controller or route handler as exempt from auth.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_KEY, true);
