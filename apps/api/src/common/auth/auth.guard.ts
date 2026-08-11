/**
 * AuthGuard — global NestJS guard for authentication and RBAC authorization.
 *
 * Execution order in the NestJS pipeline:
 *   Guard → Interceptor (TenantContextInterceptor) → Handler
 *
 * This guard runs BEFORE TenantContextInterceptor. It:
 *   1. Bypasses routes decorated with @Public().
 *   2. Extracts and verifies the Bearer access token from the Authorization header.
 *      Returns 401 with code AUTH_TOKEN_MISSING | AUTH_TOKEN_EXPIRED | AUTH_TOKEN_INVALID.
 *   3. Reads @RequirePermission metadata. Routes without a declaration and without
 *      @Public are denied by default (AUTHZ_PERMISSION_DENIED), satisfying OWASP A01.
 *   4. Enforces audience: machine tokens can only satisfy machine:* permissions;
 *      mismatches return 403 AUTHZ_AUDIENCE_MISMATCH.
 *   5. Resolves the caller's effective permissions via PermissionResolverService
 *      (Redis cache with in-memory fallback; never fail open).
 *   6. On denial: writes an immutable audit record via AuditService and throws 403.
 *   7. On success: attaches a typed principal to request.user for the interceptor.
 *
 * Guards never fail open: any unhandled exception inside the guard results in denial.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { Request } from 'express';

import { TokenService } from '../../modules/identity/services/token.service';
import type { AccessTokenClaims } from '../../modules/identity/interfaces/token-claims.interface';
import { PUBLIC_KEY } from './public.decorator';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';
import { PermissionResolverService } from './permission-resolver.service';
import { AuditService } from './audit.service';
import { type Permission, MACHINE_PERMISSIONS } from './permission.catalog';

// ---------------------------------------------------------------------------
// Shape of request.user after the guard succeeds.
// Consumed by TenantContextInterceptor to build PrincipalContext.
// ---------------------------------------------------------------------------
export interface AuthenticatedPrincipal {
  sub: string;
  tenantId: string;
  principalKind: 'staff' | 'portal' | 'machine';
  roles: string[];
  /** Populated with [] here; org-scope WO fills this from Redis cache. */
  orgScopeIds: string[];
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedPrincipal;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    // ── 1. @Public() bypass ─────────────────────────────────────────────────
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [handler, controller]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const traceId = (request.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const route = `${request.method} ${request.path}`;
    const ipAddress = (request.headers['x-forwarded-for'] as string | undefined)
      ?? request.socket.remoteAddress
      ?? null;

    // ── 2. Extract bearer token ───────────────────────────────────────────────
    const token = this.extractBearer(request);
    if (!token) {
      await this.auditService.writeAuthEvent({
        eventType: 'auth.token_missing',
        outcome: 'denied',
        route,
        ipAddress,
        traceId,
      });
      this.logger.warn('AUTH_TOKEN_MISSING', { route, traceId });
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_MISSING',
        message: 'Authorization header with Bearer token is required',
        traceId,
      });
    }

    // ── 3. Verify token ─────────────────────────────────────────────────────
    let claims: AccessTokenClaims;
    try {
      claims = this.tokenService.verifyAccessToken(token);
    } catch (err) {
      const isExpired = (err as Error).name === 'TokenExpiredError';
      const code = isExpired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID';
      const message = isExpired ? 'Access token has expired' : 'Access token is invalid';

      await this.auditService.writeAuthEvent({
        eventType: isExpired ? 'auth.token_expired' : 'auth.token_invalid',
        outcome: 'denied',
        route,
        ipAddress,
        traceId,
      });
      this.logger.warn(code, { route, traceId });
      throw new UnauthorizedException({ code, message, traceId });
    }

    // ── 4. Required permissions from metadata ─────────────────────────────────
    const requiredPermissions =
      this.reflector.getAllAndOverride<Permission[]>(REQUIRE_PERMISSION_KEY, [
        handler,
        controller,
      ]) ?? [];

    // ── 5. Deny by default (no declaration, not @Public) ──────────────────────
    if (requiredPermissions.length === 0) {
      await this.auditService.writeAuthEvent({
        tenantId: claims.tenant_id,
        actorId: claims.sub,
        actorKind: claims.user_type as AuthenticatedPrincipal['principalKind'],
        eventType: 'authz.no_permission_declared',
        outcome: 'denied',
        route,
        ipAddress,
        traceId,
        metadata: { reason: 'deny_by_default' },
      });
      this.logger.warn('AUTHZ_PERMISSION_DENIED (deny-by-default — no declaration on route)', {
        route, traceId, sub: claims.sub, tenantId: claims.tenant_id,
      });
      throw new ForbiddenException({
        code: 'AUTHZ_PERMISSION_DENIED',
        message: 'This route has no permission declaration; access is denied by default',
        details: [],
        traceId,
      });
    }

    // ── 6. Audience / user-type mismatch check ─────────────────────────────────
    const userType = claims.user_type;
    const audienceMismatch = this.checkAudienceMismatch(userType, requiredPermissions);
    if (audienceMismatch) {
      await this.auditService.writeAuthEvent({
        tenantId: claims.tenant_id,
        actorId: claims.sub,
        actorKind: userType as AuthenticatedPrincipal['principalKind'],
        eventType: 'authz.audience_mismatch',
        outcome: 'denied',
        requiredPermission: requiredPermissions.join(','),
        route,
        ipAddress,
        traceId,
        metadata: { userType, requiredPermissions },
      });
      this.logger.warn('AUTHZ_AUDIENCE_MISMATCH', {
        route, traceId, sub: claims.sub, userType, requiredPermissions,
      });
      throw new ForbiddenException({
        code: 'AUTHZ_AUDIENCE_MISMATCH',
        message: `Token audience (${userType}) is not permitted on this route`,
        details: requiredPermissions,
        traceId,
      });
    }

    // ── 7. Resolve permissions ───────────────────────────────────────────────
    let resolvedPermissions: Set<Permission>;
    try {
      resolvedPermissions = await this.permissionResolver.resolve(
        claims.tenant_id,
        claims.roles,
      );
    } catch (err) {
      // Guard must never fail open — resolve to empty set on unexpected error.
      this.logger.error('Permission resolution threw unexpectedly; denying request', {
        error: (err as Error).message,
        route,
        traceId,
      });
      resolvedPermissions = new Set<Permission>();
    }

    // ── 8. Check required permissions (any-of semantics) ──────────────────────
    const hasPermission = requiredPermissions.some((p) => resolvedPermissions.has(p));
    if (!hasPermission) {
      await this.auditService.writeAuthEvent({
        tenantId: claims.tenant_id,
        actorId: claims.sub,
        actorKind: userType as AuthenticatedPrincipal['principalKind'],
        eventType: 'authz.permission_denied',
        outcome: 'denied',
        requiredPermission: requiredPermissions.join(','),
        route,
        ipAddress,
        traceId,
        metadata: { roles: claims.roles, requiredPermissions },
      });
      this.logger.warn('AUTHZ_PERMISSION_DENIED', {
        route, traceId, sub: claims.sub, tenantId: claims.tenant_id,
        roles: claims.roles, requiredPermissions,
      });
      throw new ForbiddenException({
        code: 'AUTHZ_PERMISSION_DENIED',
        message: 'You do not have the required permission for this action',
        details: requiredPermissions,
        traceId,
      });
    }

    // ── 9. Attach principal to request.user for TenantContextInterceptor ───────
    request.user = {
      sub: claims.sub,
      tenantId: claims.tenant_id,
      principalKind: userType as AuthenticatedPrincipal['principalKind'],
      roles: claims.roles,
      orgScopeIds: [],
    };

    this.logger.debug('AUTHZ_ALLOWED', {
      route,
      traceId,
      sub: claims.sub,
      tenantId: claims.tenant_id,
      resolvedCount: resolvedPermissions.size,
    });

    return true;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractBearer(request: Request): string | null {
    const auth = request.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice('Bearer '.length).trim();
    return token.length > 0 ? token : null;
  }

  /**
   * Returns true if the principal's user_type is incompatible with the
   * required permissions. Examples:
   *   - A machine token accessing a staff-only ticket route → mismatch
   *   - A portal token accessing a machine:jira_sync route → mismatch
   */
  private checkAudienceMismatch(
    userType: string,
    requiredPermissions: Permission[],
  ): boolean {
    if (userType === 'machine') {
      // Machine tokens may ONLY satisfy machine:* permissions
      return requiredPermissions.some((p) => !MACHINE_PERMISSIONS.has(p));
    }
    if (userType === 'portal' || userType === 'staff') {
      // Non-machine tokens must NOT satisfy machine:* permissions
      return requiredPermissions.every((p) => MACHINE_PERMISSIONS.has(p));
    }
    return false;
  }
}
