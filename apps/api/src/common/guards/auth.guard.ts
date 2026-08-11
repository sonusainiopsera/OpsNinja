/**
 * AuthGuard – validates the JWT access token, enforces audience and permission
 * requirements, and attaches an immutable PrincipalContext to request.user.
 *
 * Execution order in the NestJS pipeline:
 *   AuthGuard  (this file) → TenantContextInterceptor → Handler
 *
 * Denial behaviour:
 *   - Missing / invalid / expired token  → 401 with AUTH_TOKEN_MISSING |
 *     AUTH_TOKEN_EXPIRED | AUTH_TOKEN_INVALID
 *   - No @RequirePermission metadata and no @Public marker → 403
 *     AUTHZ_PERMISSION_DENIED (deny-by-default)
 *   - Token audience does not match the permission tier → 403
 *     AUTHZ_AUDIENCE_MISMATCH
 *   - Principal lacks the required permission → 403 AUTHZ_PERMISSION_DENIED
 *
 * Every 401 and 403 writes an immutable audit_logs record and increments
 * a Redis deny counter.  More than 20 denials from a single principal in a
 * 5-minute window emits an operator-level alert log.
 *
 * Guard overhead: the hot path (Redis cache hit) adds ~1-2ms.  The guard
 * never fails open: any error in permission resolution results in 403.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import Redis from 'ioredis';

import { NO_TENANT_CONTEXT_KEY } from '../tenant/no-tenant-context.decorator';
import { REQUIRE_PERMISSION_KEY, IS_PUBLIC_KEY } from '../auth/require-permission.decorator';
import { ErrorCode } from '../errors/app-errors';
import { TokenService } from '../../modules/identity/token.service';
import { PermissionResolverService } from '../../modules/identity/services/permission-resolver.service';
import { AuditService } from '../audit/audit.service';
import { PrincipalContext, PrincipalKind } from '../../observability/request-context';
import { REDIS_CLIENT } from '../redis/redis.provider';

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly tokenService: TokenService,
    private readonly permissionResolver: PermissionResolverService,
    private readonly auditService: AuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const handler = context.getHandler();
    const cls = context.getClass();

    // ── Exemption checks ─────────────────────────────────────────────────────
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, cls]);
    const isExempt = this.reflector.getAllAndOverride<boolean>(NO_TENANT_CONTEXT_KEY, [handler, cls]);
    if (isPublic || isExempt) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: PrincipalContext }>();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const route = (req as unknown as { route?: { path?: string } }).route?.path ?? req.url ?? 'unknown';

    // ── Token extraction ─────────────────────────────────────────────────────
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      await this.auditService.recordAccessDenial({
        route,
        outcome: 'denied_401',
        code: ErrorCode.AUTH_TOKEN_MISSING,
        traceId,
      });
      this.incrementCounter('metrics:auth:deny_401');
      throw new UnauthorizedException({
        code: ErrorCode.AUTH_TOKEN_MISSING,
        message: 'Bearer token is missing.',
        traceId,
      });
    }

    const token = authHeader.slice(7);

    // ── Token verification ───────────────────────────────────────────────────
    let claims: Awaited<ReturnType<typeof this.tokenService.verifyAccessToken>>;
    try {
      claims = this.tokenService.verifyAccessToken(token, {
        audiences: this.getValidAudiences(),
      });
    } catch {
      const isExpired = this.tokenService.isTokenExpired(token);
      const code = isExpired ? ErrorCode.AUTH_TOKEN_EXPIRED : ErrorCode.AUTH_TOKEN_INVALID;
      await this.auditService.recordAccessDenial({
        route,
        outcome: 'denied_401',
        code,
        traceId,
      });
      this.incrementCounter('metrics:auth:deny_401');
      throw new UnauthorizedException({
        code,
        message: isExpired ? 'Bearer token has expired.' : 'Bearer token is invalid.',
        traceId,
      });
    }

    const tenantId = claims.tenant_id;
    const actorId = claims.sub;
    const tokenAudience = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;

    // ── Permission declaration check (deny-by-default) ───────────────────────
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_PERMISSION_KEY,
      [handler, cls],
    );

    if (!requiredPermissions?.length) {
      await this.auditService.recordAccessDenial({
        tenantId,
        actorId,
        actorKind: claims.user_type,
        route,
        outcome: 'denied_403',
        code: ErrorCode.AUTHZ_PERMISSION_DENIED,
        traceId,
      });
      this.incrementCounter('metrics:auth:deny_403');
      await this.checkDenialRateLimit(actorId, tenantId, traceId);
      throw new ForbiddenException({
        code: ErrorCode.AUTHZ_PERMISSION_DENIED,
        message: 'Access denied: route has no permission declaration.',
        traceId,
      });
    }

    // ── Audience enforcement ─────────────────────────────────────────────────
    for (const perm of requiredPermissions) {
      if (!this.isAudienceAllowedForPermission(tokenAudience, perm)) {
        await this.auditService.recordAccessDenial({
          tenantId,
          actorId,
          actorKind: claims.user_type,
          route,
          requiredPermission: perm,
          outcome: 'denied_403',
          code: ErrorCode.AUTHZ_AUDIENCE_MISMATCH,
          traceId,
        });
        this.incrementCounter('metrics:auth:deny_403');
        await this.checkDenialRateLimit(actorId, tenantId, traceId);
        throw new ForbiddenException({
          code: ErrorCode.AUTHZ_AUDIENCE_MISMATCH,
          message: `Token audience '${tokenAudience}' cannot satisfy permission '${perm}'.`,
          details: requiredPermissions,
          traceId,
        });
      }
    }

    // ── Permission resolution ────────────────────────────────────────────────
    let effectivePermissions: Set<string>;
    try {
      effectivePermissions = await this.permissionResolver.resolvePermissions(
        tenantId,
        claims.roles,
      );
    } catch (err) {
      // Never fail open: resolution error → deny
      this.logger.error('Permission resolution threw; denying by default', {
        tenantId, actorId, route, traceId,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.auditService.recordAccessDenial({
        tenantId,
        actorId,
        actorKind: claims.user_type,
        route,
        requiredPermission: requiredPermissions.join(','),
        outcome: 'denied_403',
        code: ErrorCode.AUTHZ_PERMISSION_DENIED,
        traceId,
      });
      this.incrementCounter('metrics:auth:deny_403');
      throw new ForbiddenException({
        code: ErrorCode.AUTHZ_PERMISSION_DENIED,
        message: 'Permission resolution failed.',
        traceId,
      });
    }

    // ── Permission check ─────────────────────────────────────────────────────
    for (const perm of requiredPermissions) {
      if (!effectivePermissions.has(perm)) {
        await this.auditService.recordAccessDenial({
          tenantId,
          actorId,
          actorKind: claims.user_type,
          route,
          requiredPermission: perm,
          outcome: 'denied_403',
          code: ErrorCode.AUTHZ_PERMISSION_DENIED,
          traceId,
        });
        this.incrementCounter('metrics:auth:deny_403');
        await this.checkDenialRateLimit(actorId, tenantId, traceId);
        throw new ForbiddenException({
          code: ErrorCode.AUTHZ_PERMISSION_DENIED,
          message: `Missing required permission: ${perm}.`,
          details: requiredPermissions,
          traceId,
        });
      }
    }

    // ── Allow — build and attach PrincipalContext ────────────────────────────
    const principal: PrincipalContext = {
      tenantId,
      userId: actorId,
      principalKind: (claims.user_type as PrincipalKind) ?? 'staff',
      roles: claims.roles,
      orgScopeIds: [],
      orgScopeVersion: claims.org_scope_version,
      permissions: effectivePermissions as ReadonlySet<string>,
      traceId,
    };
    req.user = principal;

    this.incrementCounter('metrics:auth:allow');
    return true;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private getValidAudiences(): string[] {
    return [
      this.config.get<string>('JWT_AUDIENCE', 'opsninja'),
      this.config.get<string>('JWT_AUDIENCE_PORTAL', 'opsninja-portal'),
      this.config.get<string>('JWT_AUDIENCE_MACHINE', 'opsninja-machine'),
    ];
  }

  private isAudienceAllowedForPermission(aud: string, permission: string): boolean {
    const machineAud = this.config.get<string>('JWT_AUDIENCE_MACHINE', 'opsninja-machine');
    const portalAud = this.config.get<string>('JWT_AUDIENCE_PORTAL', 'opsninja-portal');

    if (permission.startsWith('machine:')) return aud === machineAud;
    if (permission.startsWith('portal:')) return aud === portalAud;
    // Staff permissions: any audience that is NOT machine or portal
    return aud !== machineAud && aud !== portalAud;
  }

  /**
   * Increments a Redis counter for the principal's denial rate.
   * Emits an operator-level warning when the threshold is exceeded.
   */
  private async checkDenialRateLimit(
    actorId: string,
    tenantId: string,
    traceId: string,
  ): Promise<void> {
    const key = `metrics:auth:principal:${tenantId}:${actorId}:deny`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, 5 * 60); // 5-minute sliding window
      }
      if (count > 20) {
        this.logger.warn({
          type: 'operator_alert',
          event: 'auth.excessive_denials',
          actorId,
          tenantId,
          count,
          traceId,
          message: `More than 20 authorization failures from principal ${actorId} in 5 minutes`,
        });
      }
    } catch {
      // Redis unavailable — skip rate-limit tracking without blocking the denial
    }
  }

  private incrementCounter(key: string): void {
    this.redis.incr(key).catch(() => {});
  }
}
