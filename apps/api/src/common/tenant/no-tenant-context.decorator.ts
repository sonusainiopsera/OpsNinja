/**
 * @NoTenantContext – marks a controller or handler as exempt from the
 * TenantContextInterceptor.
 *
 * Apply this decorator to controllers or individual route handlers that must
 * run without an open tenant transaction.  The interceptor checks Reflector
 * metadata rather than hard-coding paths, so the allow-list is explicit,
 * version-controlled and visible at the call site.
 *
 * Exempt surfaces:
 *   - Health-check endpoints (no user auth, no db required)
 *   - Auth callback / token-exchange endpoints (no tenant resolved yet)
 *   - Jira webhook receiver (machine trust, no session token)
 *
 * @example
 * ```typescript
 * @NoTenantContext()
 * @Controller('health')
 * export class HealthController { ... }
 * ```
 */

import { SetMetadata } from '@nestjs/common';

export const NO_TENANT_CONTEXT_KEY = 'opsninja:no_tenant_context';

/**
 * Decorator factory that marks the annotated controller or handler as exempt
 * from the global tenant-context interceptor.
 */
export const NoTenantContext = (): ClassDecorator & MethodDecorator =>
  SetMetadata(NO_TENANT_CONTEXT_KEY, true);
