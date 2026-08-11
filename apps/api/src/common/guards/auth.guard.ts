/**
 * AuthGuard – validates the JWT access token on every request and attaches the
 * resolved PrincipalContext to request.user.
 *
 * This guard runs BEFORE the TenantContextInterceptor in the NestJS pipeline.
 * It is responsible for:
 *   1. Extracting the Bearer token from the Authorization header or httpOnly cookie.
 *   2. Validating the JWT signature against the cached JWKS endpoint.
 *   3. Checking the org_scope_version claim against the Redis counter.
 *   4. Resolving roles, orgScopeIds and tenantId from the validated claims.
 *   5. Attaching the fully resolved PrincipalContext to request.user.
 *
 * NOTE: The full OIDC integration is implemented in a later WO.  This file
 * contains the guard's interface contract so that TenantContextInterceptor and
 * app.module.ts can depend on it today.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { NO_TENANT_CONTEXT_KEY } from '../tenant/no-tenant-context.decorator';
import { PrincipalContext } from '../../observability/request-context';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Honour @NoTenantContext exemptions – exempt routes skip JWT validation.
    const isExempt = this.reflector.getAllAndOverride<boolean>(NO_TENANT_CONTEXT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isExempt) {
      return true;
    }

    if (context.getType() !== 'http') {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: PrincipalContext }>();

    // Extract token (full OIDC validation in future WO; stub validates presence only).
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ message: 'Missing Bearer token.', code: 'UNAUTHENTICATED' });
    }

    // TODO (future WO): validate JWT signature, expiry, scope version vs Redis.
    // For now, attach a stub principal from x-test-principal header (test use only).
    const rawPrincipal = req.headers['x-test-principal'];
    if (rawPrincipal && typeof rawPrincipal === 'string') {
      try {
        req.user = JSON.parse(rawPrincipal) as PrincipalContext;
        return true;
      } catch {
        this.logger.warn('Failed to parse x-test-principal header');
      }
    }

    throw new UnauthorizedException({ message: 'Token validation not yet implemented.', code: 'UNAUTHENTICATED' });
  }
}
