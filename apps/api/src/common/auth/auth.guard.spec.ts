/**
 * Unit tests for AuthGuard.
 *
 * All external dependencies (TokenService, PermissionResolverService, AuditService,
 * Reflector) are mocked so the tests exercise only the guard's own logic.
 *
 * Covered paths:
 *   1. @Public() → returns true, no token needed
 *   2. Missing Authorization header → 401 AUTH_TOKEN_MISSING
 *   3. Malformed / invalid token → 401 AUTH_TOKEN_INVALID
 *   4. Expired token → 401 AUTH_TOKEN_EXPIRED
 *   5. No @RequirePermission and no @Public (deny-by-default) → 403 AUTHZ_PERMISSION_DENIED
 *   6. @RequirePermission present, user has permission → true
 *   7. @RequirePermission present, user lacks permission → 403 AUTHZ_PERMISSION_DENIED
 *   8. Machine token on staff route → 403 AUTHZ_AUDIENCE_MISMATCH
 *   9. Staff token on machine-only route → 403 AUTHZ_AUDIENCE_MISMATCH
 *  10. PermissionResolverService throws → deny (never fail open)
 *  11. Successful auth attaches principal to request.user
 */

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuthGuard } from './auth.guard';
import { PermissionResolverService } from './permission-resolver.service';
import { AuditService } from './audit.service';
import { TokenService } from '../../modules/identity/services/token.service';
import { PUBLIC_KEY } from './public.decorator';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';
import { PORTAL_ROUTE_KEY } from './portal-route.decorator';
import type { Permission } from './permission.catalog';
import type { AccessTokenClaims } from '../../modules/identity/interfaces/token-claims.interface';
import { TENANT_A_ID, TENANT_A_STAFF_USER_ID } from '../../../test/factories/principal-context.factory';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const AGENT_CLAIMS: AccessTokenClaims = {
  sub: TENANT_A_STAFF_USER_ID,
  tenant_id: TENANT_A_ID,
  roles: ['agent'],
  org_scope_version: 1,
  user_type: 'staff',
  jti: 'test-jti',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
  iss: 'https://api.test.opsninja.io',
  aud: 'opsninja-test',
};

const MACHINE_CLAIMS: AccessTokenClaims = {
  ...AGENT_CLAIMS,
  user_type: 'machine',
  roles: ['machine'],
};

const PORTAL_CLAIMS: AccessTokenClaims = {
  ...AGENT_CLAIMS,
  user_type: 'portal',
  roles: ['portal_user'],
  bound_org_id: '00000000-0000-0000-0001-000000000010',
};

function buildContext(opts: {
  bearerToken?: string;
  publicMeta?: boolean;
  requiredPerms?: Permission[];
  method?: string;
  path?: string;
}): ExecutionContext {
  const headers: Record<string, string | undefined> = {};
  if (opts.bearerToken !== undefined) {
    headers['authorization'] = `Bearer ${opts.bearerToken}`;
  }

  const handlerFn = jest.fn();
  const controllerClass = jest.fn();

  return {
    getHandler: () => handlerFn,
    getClass: () => controllerClass,
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        method: opts.method ?? 'GET',
        path: opts.path ?? '/api/v1/tickets',
        socket: { remoteAddress: '127.0.0.1' },
        user: undefined,
      }),
    }),
    _handlerFn: handlerFn,
    _controllerClass: controllerClass,
    _publicMeta: opts.publicMeta,
    _requiredPerms: opts.requiredPerms,
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let reflector: jest.Mocked<Reflector>;
  let tokenService: jest.Mocked<Pick<TokenService, 'verifyAccessToken'>>;
  let permissionResolver: jest.Mocked<Pick<PermissionResolverService, 'resolve'>>;
  let auditService: jest.Mocked<Pick<AuditService, 'writeAuthEvent'>>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;

    tokenService = { verifyAccessToken: jest.fn() };
    permissionResolver = { resolve: jest.fn() };
    auditService = { writeAuthEvent: jest.fn().mockResolvedValue(undefined) };

    guard = new AuthGuard(
      reflector as Reflector,
      tokenService as unknown as TokenService,
      permissionResolver as unknown as PermissionResolverService,
      auditService as unknown as AuditService,
    );
  });

  // ── Case 1: @Public() ─────────────────────────────────────────────────────

  it('allows a @Public route without any token', async () => {
    reflector.getAllAndOverride.mockImplementation((key) =>
      key === PUBLIC_KEY ? true : undefined,
    );
    const ctx = buildContext({});
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  // ── Case 2: Missing token ─────────────────────────────────────────────────

  it('throws 401 AUTH_TOKEN_MISSING when no Authorization header', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = buildContext({ bearerToken: undefined });

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    try {
      await guard.canActivate(ctx);
    } catch (err) {
      expect((err as UnauthorizedException).getResponse()).toMatchObject({ code: 'AUTH_TOKEN_MISSING' });
    }
  });

  // ── Case 3: Invalid token ─────────────────────────────────────────────────

  it('throws 401 AUTH_TOKEN_INVALID when token is malformed', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const invalidErr = new Error('invalid signature');
    invalidErr.name = 'JsonWebTokenError';
    tokenService.verifyAccessToken.mockImplementation(() => { throw invalidErr; });

    const ctx = buildContext({ bearerToken: 'bad.token.here' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    const caught = await guard.canActivate(ctx).catch((e: UnauthorizedException) => e);
    expect((caught as UnauthorizedException).getResponse()).toMatchObject({ code: 'AUTH_TOKEN_INVALID' });
  });

  // ── Case 4: Expired token ─────────────────────────────────────────────────

  it('throws 401 AUTH_TOKEN_EXPIRED when token is expired', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const expiredErr = new Error('jwt expired');
    expiredErr.name = 'TokenExpiredError';
    tokenService.verifyAccessToken.mockImplementation(() => { throw expiredErr; });

    const ctx = buildContext({ bearerToken: 'expired.token.here' });
    const caught = await guard.canActivate(ctx).catch((e: UnauthorizedException) => e);
    expect((caught as UnauthorizedException).getResponse()).toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });
  });

  // ── Case 5: Deny by default (no declaration) ──────────────────────────────

  it('throws 403 AUTHZ_PERMISSION_DENIED for undeclared route', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === PUBLIC_KEY) return false;
      if (key === REQUIRE_PERMISSION_KEY) return undefined;
      return undefined;
    });
    tokenService.verifyAccessToken.mockReturnValue(AGENT_CLAIMS);

    const ctx = buildContext({ bearerToken: 'valid.token' });
    const caught = await guard.canActivate(ctx).catch((e: ForbiddenException) => e);
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toMatchObject({ code: 'AUTHZ_PERMISSION_DENIED' });
  });

  // ── Case 6: User has permission ───────────────────────────────────────────

  it('allows request when user has required permission', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === PUBLIC_KEY) return false;
      if (key === REQUIRE_PERMISSION_KEY) return ['ticket:read'] as Permission[];
      return undefined;
    });
    tokenService.verifyAccessToken.mockReturnValue(AGENT_CLAIMS);
    permissionResolver.resolve.mockResolvedValue(new Set<Permission>(['ticket:read', 'ticket:create']));

    const ctx = buildContext({ bearerToken: 'valid.token' });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
  });

  // ── Case 7: Permission denied ─────────────────────────────────────────────

  it('throws 403 AUTHZ_PERMISSION_DENIED when user lacks permission', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === PUBLIC_KEY) return false;
      if (key === REQUIRE_PERMISSION_KEY) return ['admin:manage_tenant'] as Permission[];
      return undefined;
    });
    tokenService.verifyAccessToken.mockReturnValue(AGENT_CLAIMS);
    permissionResolver.resolve.mockResolvedValue(new Set<Permission>(['ticket:read']));

    const ctx = buildContext({ bearerToken: 'valid.token' });
    const caught = await guard.canActivate(ctx).catch((e: ForbiddenException) => e);
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toMatchObject({ code: 'AUTHZ_PERMISSION_DENIED' });
  });

  // ── Case 8: Machine token on staff route ──────────────────────────────────

  it('throws 403 AUTHZ_AUDIENCE_MISMATCH for machine token on staff route', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === PUBLIC_KEY) return false;
      if (key === REQUIRE_PERMISSION_KEY) return ['ticket:read'] as Permission[];
      return undefined;
    });
    tokenService.verifyAccessToken.mockReturnValue(MACHINE_CLAIMS);

    const ctx = buildContext({ bearerToken: 'machine.token' });
    const caught = await guard.canActivate(ctx).catch((e: ForbiddenException) => e);
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toMatchObject({ code: 'AUTHZ_AUDIENCE_MISMATCH' });
  });

  // ── Case 9: Staff token on machine-only route ─────────────────────────────

  it('throws 403 AUTHZ_AUDIENCE_MISMATCH for staff token on machine-only route', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === PUBLIC_KEY) return false;
      if (key === REQUIRE_PERMISSION_KEY) return ['machine:jira_sync'] as Permission[];
      return undefined;
    });
    tokenService.verifyAccessToken.mockReturnValue(AGENT_CLAIMS);

    const ctx = buildContext({ bearerToken: 'staff.token' });
    const caught = await guard.canActivate(ctx).catch((e: ForbiddenException) => e);
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toMatchObject({ code: 'AUTHZ_AUDIENCE_MISMATCH' });
  });

  // ── Case 10: Permission resolver throws → deny (never fail open) ──────────

  it('denies when PermissionResolverService throws unexpectedly', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === PUBLIC_KEY) return false;
      if (key === REQUIRE_PERMISSION_KEY) return ['ticket:read'] as Permission[];
      return undefined;
    });
    tokenService.verifyAccessToken.mockReturnValue(AGENT_CLAIMS);
    permissionResolver.resolve.mockRejectedValue(new Error('Redis connection lost'));

    const ctx = buildContext({ bearerToken: 'valid.token' });
    const caught = await guard.canActivate(ctx).catch((e: ForbiddenException) => e);
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toMatchObject({ code: 'AUTHZ_PERMISSION_DENIED' });
  });

  // ── Case 11: Principal attached to request.user ───────────────────────────

  it('attaches principal to request.user on successful auth', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === PUBLIC_KEY) return false;
      if (key === REQUIRE_PERMISSION_KEY) return ['ticket:read'] as Permission[];
      return undefined;
    });
    tokenService.verifyAccessToken.mockReturnValue(AGENT_CLAIMS);
    permissionResolver.resolve.mockResolvedValue(new Set<Permission>(['ticket:read']));

    const mockRequest = {
      headers: { authorization: 'Bearer valid.token', 'x-trace-id': 'trace-001' },
      method: 'GET',
      path: '/api/v1/tickets',
      socket: { remoteAddress: '127.0.0.1' },
      user: undefined as unknown,
    };

    const ctx = {
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
      switchToHttp: () => ({ getRequest: () => mockRequest }),
    } as unknown as ExecutionContext;

    await guard.canActivate(ctx);

    expect(mockRequest.user).toMatchObject({
      sub: TENANT_A_STAFF_USER_ID,
      tenantId: TENANT_A_ID,
      principalKind: 'staff',
      roles: ['agent'],
      orgScopeIds: [],
    });
  });

  // ── Case 12: Portal token on non-portal route ─────────────────────────────

  it('throws 403 AUTHZ_AUDIENCE_MISMATCH for portal token on non-portal route', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === PUBLIC_KEY) return false;
      if (key === REQUIRE_PERMISSION_KEY) return ['ticket:read'] as Permission[];
      if (key === PORTAL_ROUTE_KEY) return false; // non-portal route
      return undefined;
    });
    tokenService.verifyAccessToken.mockReturnValue(PORTAL_CLAIMS);

    const ctx = buildContext({ bearerToken: 'portal.token' });
    const caught = await guard.canActivate(ctx).catch((e: ForbiddenException) => e);
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toMatchObject({ code: 'AUTHZ_AUDIENCE_MISMATCH' });
  });

  // ── Case 13: Staff token on portal route ──────────────────────────────────

  it('throws 403 AUTHZ_AUDIENCE_MISMATCH for staff token on portal route', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === PUBLIC_KEY) return false;
      if (key === REQUIRE_PERMISSION_KEY) return ['ticket:read'] as Permission[];
      if (key === PORTAL_ROUTE_KEY) return true; // portal route
      return undefined;
    });
    tokenService.verifyAccessToken.mockReturnValue(AGENT_CLAIMS);

    const ctx = buildContext({ bearerToken: 'staff.token' });
    const caught = await guard.canActivate(ctx).catch((e: ForbiddenException) => e);
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toMatchObject({ code: 'AUTHZ_AUDIENCE_MISMATCH' });
  });

  // ── Audit events written on denial ───────────────────────────────────────

  it('writes an audit event for every denial', async () => {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === PUBLIC_KEY) return false;
      if (key === REQUIRE_PERMISSION_KEY) return ['admin:manage_tenant'] as Permission[];
      return undefined;
    });
    tokenService.verifyAccessToken.mockReturnValue(AGENT_CLAIMS);
    permissionResolver.resolve.mockResolvedValue(new Set<Permission>(['ticket:read']));

    const ctx = buildContext({ bearerToken: 'valid.token' });
    await guard.canActivate(ctx).catch(() => {});

    expect(auditService.writeAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'authz.permission_denied',
        outcome: 'denied',
        actorId: TENANT_A_STAFF_USER_ID,
        tenantId: TENANT_A_ID,
      }),
    );
  });
});
