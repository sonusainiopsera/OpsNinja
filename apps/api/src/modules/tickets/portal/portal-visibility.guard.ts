/**
 * PortalVisibilityGuard — defence-in-depth guard for portal route handlers.
 *
 * Runs after the global AuthGuard but before TenantContextInterceptor. Validates:
 *   1. The request principal is a portal principal (principalKind === 'portal').
 *   2. A boundOrganizationId is present on the principal.
 *
 * This guard is a second layer of defence; the primary enforcement is in the
 * global AuthGuard's audience-mismatch check (@PortalRoute decorator). If the
 * global guard somehow fails to reject a non-portal token, this guard catches it.
 *
 * Data-level enforcement (organisation_id + visibility predicates) is applied
 * separately inside repositories via the ScopedQueryHelper — see scoped-query.helper.ts.
 */

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import type { AuthenticatedPrincipal } from '../../../common/auth/auth.guard';
import { AuditService } from '../../../common/auth/audit.service';

@Injectable()
export class PortalVisibilityGuard implements CanActivate {
  constructor(private readonly auditService: AuditService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedPrincipal }>();
    const principal = request.user;
    const traceId = (request.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const route = `${request.method} ${request.path}`;

    if (!principal || principal.principalKind !== 'portal' || !principal.boundOrganizationId) {
      await this.auditService.writeAuthEvent({
        tenantId: principal?.tenantId ?? null,
        actorId: principal?.sub ?? null,
        actorKind: (principal?.principalKind ?? null) as 'portal' | null,
        eventType: 'authz.portal_principal_required',
        outcome: 'denied',
        route,
        traceId,
        metadata: { principalKind: principal?.principalKind ?? 'none' },
      });
      throw new ForbiddenException({
        code: 'AUTHZ_AUDIENCE_MISMATCH',
        message: 'This endpoint requires a portal principal with a bound organisation',
        traceId,
      });
    }

    return true;
  }
}
