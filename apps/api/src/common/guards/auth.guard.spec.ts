/**
 * Unit tests for AuthGuard.
 *
 * Uses fake token service, permission resolver and audit service so the suite
 * runs offline with no Redis or Postgres dependency.
 */

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { TokenService } from '../../modules/identity/token.service';
import { AuthGuard } from './auth.guard';
import {
  mintTestToken,
  makeFakeAuditService,
  makeFakePermissionResolver,
  TEST_KEY_PAIR,
  TEST_ISSUER,
  STAFF_AUDIENCE,
  PORTAL_AUDIENCE,
  MACHINE_AUDIENCE,
  EXPIRED_TOKEN,
  INVALID_SIGNATURE_TOKEN,
  TENANT_A_ID,
} from '../../../test/fixtures/rbac.fixtures';
import { REQUIRE_PERMISSION_KEY, IS_PUBLIC_KEY } from '../auth/require-permission.decorator';
import { NO_TENANT_CONTEXT_KEY } from '../tenant/no-tenant-context.decorator';
import { Permission } from '../auth/permissions';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  return {
    get: jest.fn().mockImplementation((key: string, def?: unknown) => {
      const m: Record<string, unknown> = {
        JWT_PUBLIC_KEY:      TEST_KEY_PAIR.publicKey,
        JWT_KID:             TEST_KEY_PAIR.kid,
        JWT_ISSUER:          TEST_ISSUER,
        JWT_AUDIENCE:        STAFF_AUDIENCE,
        JWT_AUDIENCE_PORTAL: PORTAL_AUDIENCE,
        JWT_AUDIENCE_MACHINE: MACHINE_AUDIENCE,
        ...overrides,
      };
      return m[key] ?? def;
    }),
  } as unknown as ConfigService;
}

function makeFakeRedis() {
  const store = new Map<string, number>();
  return {
    incr: jest.fn().mockImplementation((key: string) => {
      const v = (store.get(key) ?? 0) + 1;
      store.set(key, v);
      return Promise.resolve(v);
    }),
    expire: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    _store: store,
  };
}

interface ContextOpts {
  authHeader?: string;
  handlerMetadata?: Record<string, unknown>;
  classMetadata?: Record<string, unknown>;
}

function makeContext(opts: ContextOpts = {}): ExecutionContext {
  const req: Record<string, unknown> = {};
  if (opts.authHeader !== undefined) {
    req['headers'] = { authorization: opts.authHeader };
  } else {
    req['headers'] = {};
  }
  req['url'] = '/api/v1/test';

  const handlerMeta = opts.handlerMetadata ?? {};
  const classMeta = opts.classMetadata ?? {};

  const reflector = new Reflector();
  const ctx: ExecutionContext = {
    getType: () => 'http',
    getHandler: () => (() => {}) as unknown as ReturnType<ExecutionContext['getHandler']>,
    getClass: () => (class {}) as unknown as ReturnType<ExecutionContext['getClass']>,
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    switchToRpc: jest.fn(),
    switchToWs: jest.fn(),
    getArgByIndex: jest.fn(),
    getArgs: jest.fn(),
  } as unknown as ExecutionContext;

  // Patch reflector to return handler/class metadata
  jest.spyOn(reflector as unknown as { getAllAndOverride: jest.Mock }, 'getAllAndOverride' as never).mockImplementation(
    (key: string) => {
      if (key in handlerMeta) return handlerMeta[key];
      if (key in classMeta) return classMeta[key];
      return undefined;
    },
  );

  (ctx as unknown as { _reflector: Reflector })['_reflector'] = reflector;
  (ctx as unknown as { _req: Record<string, unknown> })['_req'] = req;
  return ctx;
}

function makeGuard(permissionsToReturn: string[] = [Permission.TICKETS_READ]) {
  const tokenSvc = new TokenService({
    get: (key: string, def?: unknown) => {
      const m: Record<string, unknown> = {
        JWT_PRIVATE_KEY:     TEST_KEY_PAIR.privateKey,
        JWT_PUBLIC_KEY:      TEST_KEY_PAIR.publicKey,
        JWT_KID:             TEST_KEY_PAIR.kid,
        JWT_ISSUER:          TEST_ISSUER,
        JWT_AUDIENCE:        STAFF_AUDIENCE,
      };
      return m[key] ?? def;
    },
  } as never);

  const permResolver = makeFakePermissionResolver(permissionsToReturn);
  const auditSvc = makeFakeAuditService();
  const redis = makeFakeRedis();
  const config = makeConfig();
  const reflector = new Reflector();

  const guard = new AuthGuard(reflector, config, tokenSvc, permResolver as never, auditSvc as never, redis as never);
  return { guard, auditSvc, permResolver, redis, reflector };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthGuard', () => {
  // ── Exempt routes ──────────────────────────────────────────────────────────

  it('passes through for non-HTTP context types', async () => {
    const { guard } = makeGuard();
    const ctx = { getType: () => 'rpc' } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('passes through when @Public() is set on handler', async () => {
    const { guard, reflector } = makeGuard();
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return true;
      return undefined;
    });
    const ctx = { getType: () => 'http', getHandler: jest.fn(), getClass: jest.fn() } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('passes through when @NoTenantContext() is set', async () => {
    const { guard, reflector } = makeGuard();
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === NO_TENANT_CONTEXT_KEY) return true;
      return undefined;
    });
    const ctx = { getType: () => 'http', getHandler: jest.fn(), getClass: jest.fn() } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // ── Missing token ──────────────────────────────────────────────────────────

  it('throws UnauthorizedException AUTH_TOKEN_MISSING when no Bearer header', async () => {
    const { guard, reflector } = makeGuard();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const req: Record<string, unknown> = { headers: {}, url: '/test' };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTH_TOKEN_MISSING' }),
    });
  });

  // ── Expired token ──────────────────────────────────────────────────────────

  it('throws UnauthorizedException AUTH_TOKEN_EXPIRED for expired token', async () => {
    const { guard, reflector } = makeGuard();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${EXPIRED_TOKEN}` },
      url: '/test',
    };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTH_TOKEN_EXPIRED' }),
    });
  });

  // ── Invalid signature ──────────────────────────────────────────────────────

  it('throws UnauthorizedException AUTH_TOKEN_INVALID for unknown key', async () => {
    const { guard, reflector } = makeGuard();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${INVALID_SIGNATURE_TOKEN}` },
      url: '/test',
    };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTH_TOKEN_INVALID' }),
    });
  });

  // ── Deny by default ────────────────────────────────────────────────────────

  it('throws ForbiddenException AUTHZ_PERMISSION_DENIED when no RequirePermission metadata', async () => {
    const { guard, reflector } = makeGuard();
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === REQUIRE_PERMISSION_KEY) return undefined;
      return undefined;
    });

    const token = mintTestToken({ roles: ['agent'], audience: STAFF_AUDIENCE });
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
      url: '/test',
    };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTHZ_PERMISSION_DENIED' }),
    });
  });

  // ── Audience mismatch ──────────────────────────────────────────────────────

  it('throws ForbiddenException AUTHZ_AUDIENCE_MISMATCH when portal token hits staff route', async () => {
    const { guard, reflector } = makeGuard([Permission.TICKETS_READ]);
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === REQUIRE_PERMISSION_KEY) return [Permission.TICKETS_READ];
      return undefined;
    });

    const token = mintTestToken({ roles: ['portal_user'], audience: PORTAL_AUDIENCE });
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
      url: '/api/v1/tickets',
    };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTHZ_AUDIENCE_MISMATCH' }),
    });
  });

  it('throws ForbiddenException AUTHZ_AUDIENCE_MISMATCH when machine token hits staff route', async () => {
    const { guard, reflector } = makeGuard([Permission.TICKETS_READ]);
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === REQUIRE_PERMISSION_KEY) return [Permission.TICKETS_READ];
      return undefined;
    });

    const token = mintTestToken({ roles: ['worker'], audience: MACHINE_AUDIENCE });
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
      url: '/api/v1/tickets',
    };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTHZ_AUDIENCE_MISMATCH' }),
    });
  });

  // ── Permission denied ──────────────────────────────────────────────────────

  it('throws ForbiddenException when principal lacks required permission', async () => {
    const { guard, permResolver, reflector } = makeGuard([]);
    // resolver returns empty set → no permissions
    (permResolver.resolvePermissions as jest.Mock).mockResolvedValue(new Set([]));
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === REQUIRE_PERMISSION_KEY) return [Permission.ADMIN_WRITE];
      return undefined;
    });

    const token = mintTestToken({ roles: ['agent'], audience: STAFF_AUDIENCE });
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
      url: '/api/v1/admin',
    };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'AUTHZ_PERMISSION_DENIED' }),
    });
  });

  // ── Permission resolution failure → deny ───────────────────────────────────

  it('denies (never fails open) when permission resolver throws', async () => {
    const { guard, permResolver, reflector } = makeGuard();
    (permResolver.resolvePermissions as jest.Mock).mockRejectedValue(new Error('Redis down'));
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === REQUIRE_PERMISSION_KEY) return [Permission.TICKETS_READ];
      return undefined;
    });

    const token = mintTestToken({ roles: ['agent'], audience: STAFF_AUDIENCE });
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
      url: '/test',
    };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ── Successful allow ───────────────────────────────────────────────────────

  it('returns true and attaches PrincipalContext when all checks pass', async () => {
    const { guard, reflector } = makeGuard([Permission.TICKETS_READ]);
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === REQUIRE_PERMISSION_KEY) return [Permission.TICKETS_READ];
      return undefined;
    });

    const token = mintTestToken({ roles: ['agent'], audience: STAFF_AUDIENCE, tenantId: TENANT_A_ID });
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
      url: '/api/v1/tickets',
    };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    const principal = (req as Record<string, unknown>)['user'] as { tenantId: string; roles: string[] };
    expect(principal).toBeDefined();
    expect(principal.tenantId).toBe(TENANT_A_ID);
    expect(principal.roles).toContain('agent');
  });

  // ── Audit recording ────────────────────────────────────────────────────────

  it('records audit denial for 401', async () => {
    const { guard, auditSvc, reflector } = makeGuard();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const req: Record<string, unknown> = { headers: {}, url: '/test' };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await guard.canActivate(ctx).catch(() => {});
    expect(auditSvc.recordAccessDenial).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'denied_401', code: 'AUTH_TOKEN_MISSING' }),
    );
  });

  // ── Multiple roles → union of permissions ──────────────────────────────────

  it('grants access when one of the principals roles satisfies the permission', async () => {
    const { guard, permResolver, reflector } = makeGuard();
    // agent has TICKETS_READ, readonly has TICKETS_READ too; union gives both
    (permResolver.resolvePermissions as jest.Mock).mockResolvedValue(
      new Set([Permission.TICKETS_READ, Permission.USERS_READ]),
    );
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === REQUIRE_PERMISSION_KEY) return [Permission.TICKETS_READ];
      return undefined;
    });

    const token = mintTestToken({ roles: ['agent', 'readonly'], audience: STAFF_AUDIENCE });
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` }, url: '/test' };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // ── Machine token → machine route ─────────────────────────────────────────

  it('allows machine token to access machine route', async () => {
    const { guard, permResolver, reflector } = makeGuard([Permission.MACHINE_SYNC]);
    (permResolver.resolvePermissions as jest.Mock).mockResolvedValue(
      new Set([Permission.MACHINE_SYNC]),
    );
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === REQUIRE_PERMISSION_KEY) return [Permission.MACHINE_SYNC];
      return undefined;
    });

    const token = mintTestToken({ roles: ['worker'], audience: MACHINE_AUDIENCE });
    const req: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
      url: '/api/v1/machine/sync',
    };
    const ctx = {
      getType: () => 'http',
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
