/**
 * Unit tests for TenantContextInterceptor.
 *
 * Uses a fake withTenantTransaction implementation so no database connection
 * is needed. Tests cover:
 *  - Exempt routes skip transaction entirely
 *  - Unauthenticated requests are rejected with 401
 *  - Authenticated but tenant-less principals are rejected with 500 TENANT_CONTEXT_MISSING
 *  - Happy path passes the correct PrincipalContext to withTenantTransaction
 *  - Handler errors trigger rollback (observable from fake unit-of-work)
 *  - Error codes are mapped to correct HTTP exceptions
 */

import { ExecutionContext, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of, throwError } from 'rxjs';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { NO_TENANT_CONTEXT_KEY } from './no-tenant-context.decorator';
import { PrincipalContext, requestContextStore } from '../../observability/request-context';
import * as unitOfWork from '../../data/unit-of-work';
import {
  tenantAStaffPrincipal,
  buildMockRequest,
  TENANT_A_ID,
  TENANT_A_STAFF_USER_ID,
} from '../../../test/factories/principal-context.factory';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal NestJS ExecutionContext mock. */
function createMockContext(
  requestOverrides: Partial<{ user: unknown; url: string; method: string; headers: Record<string, string> }> = {},
  metadataMap: Map<string, unknown> = new Map(),
): ExecutionContext {
  const request = {
    url: '/api/v1/tickets',
    method: 'GET',
    headers: {},
    ...requestOverrides,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => ({ name: 'testHandler' }),
    getClass: () => ({ name: 'TestController' }),
  } as unknown as ExecutionContext;
}

/** Creates a mock CallHandler that emits a single value. */
function createMockHandler(value: unknown = { result: 'ok' }) {
  return {
    handle: () => of(value),
  };
}

/** Creates a mock CallHandler that throws an error. */
function createMockErrorHandler(err: Error) {
  return {
    handle: () => throwError(() => err),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor;
  let reflector: Reflector;
  let withTxSpy: jest.SpyInstance;
  let capturedPrincipal: PrincipalContext | undefined;
  let shouldRollback: boolean;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new TenantContextInterceptor(reflector);
    capturedPrincipal = undefined;
    shouldRollback = false;

    // Fake withTenantTransaction: captures principal, runs fn synchronously.
    withTxSpy = jest
      .spyOn(unitOfWork, 'withTenantTransaction')
      .mockImplementation(async (principal, fn) => {
        capturedPrincipal = principal;
        if (shouldRollback) {
          const err = new Error('simulated rollback');
          throw err;
        }
        return fn({} as any);
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Allow-list
  // -------------------------------------------------------------------------

  describe('allow-list (@NoTenantContext)', () => {
    it('skips transaction for exempt routes', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      const ctx = createMockContext();
      const handler = createMockHandler();

      const result = await lastValueFrom(interceptor.intercept(ctx, handler));

      expect(withTxSpy).not.toHaveBeenCalled();
      expect(result).toEqual({ result: 'ok' });
    });

    it('proceeds with transaction for non-exempt routes', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const principal = tenantAStaffPrincipal();
      const request = buildMockRequest(principal);
      const ctx = createMockContext(request);
      const handler = createMockHandler();

      await lastValueFrom(interceptor.intercept(ctx, handler));

      expect(withTxSpy).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Authentication checks
  // -------------------------------------------------------------------------

  describe('authentication validation', () => {
    it('throws 401 when request.user is absent', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({ user: undefined });

      expect(() => {
        interceptor.intercept(ctx, createMockHandler());
      }).toThrow(UnauthorizedException);

      expect(withTxSpy).not.toHaveBeenCalled();
    });

    it('throws 401 when request.user.sub is missing', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({ user: { tenantId: TENANT_A_ID } });

      expect(() => {
        interceptor.intercept(ctx, createMockHandler());
      }).toThrow(UnauthorizedException);
    });

    it('throws 500 TENANT_CONTEXT_MISSING when tenantId is absent', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({
        user: { sub: TENANT_A_STAFF_USER_ID },
      });

      expect(() => {
        interceptor.intercept(ctx, createMockHandler());
      }).toThrow(InternalServerErrorException);

      expect(withTxSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Principal context derivation
  // -------------------------------------------------------------------------

  describe('PrincipalContext construction', () => {
    it('passes correct tenantId, userId, principalKind, roles, orgScopeIds to withTenantTransaction', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const principal = tenantAStaffPrincipal({
        roles: ['admin', 'agent'],
        orgScopeIds: ['org-1', 'org-2'],
      });
      const request = buildMockRequest(principal);
      const ctx = createMockContext(request);

      await lastValueFrom(interceptor.intercept(ctx, createMockHandler()));

      expect(capturedPrincipal).toMatchObject({
        tenantId: TENANT_A_ID,
        userId: TENANT_A_STAFF_USER_ID,
        principalKind: 'staff',
        roles: ['admin', 'agent'],
        orgScopeIds: ['org-1', 'org-2'],
      });
    });

    it('uses x-trace-id header as traceId when present', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const principal = tenantAStaffPrincipal({ traceId: 'test-trace-123' });
      const request = buildMockRequest(principal, { headers: { 'x-trace-id': 'test-trace-123' } });
      const ctx = createMockContext(request);

      await lastValueFrom(interceptor.intercept(ctx, createMockHandler()));

      expect(capturedPrincipal?.traceId).toBe('test-trace-123');
    });

    it('generates a traceId when x-trace-id header is absent', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const principal = tenantAStaffPrincipal();
      const request = buildMockRequest(principal, { headers: {} });
      const ctx = createMockContext(request);

      await lastValueFrom(interceptor.intercept(ctx, createMockHandler()));

      expect(capturedPrincipal?.traceId).toBeTruthy();
      expect(typeof capturedPrincipal?.traceId).toBe('string');
    });

    it('defaults principalKind to staff when not in JWT', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const ctx = createMockContext({
        user: {
          sub: TENANT_A_STAFF_USER_ID,
          tenantId: TENANT_A_ID,
          // principalKind omitted
        },
        headers: {},
      });

      await lastValueFrom(interceptor.intercept(ctx, createMockHandler()));

      expect(capturedPrincipal?.principalKind).toBe('staff');
    });
  });

  // -------------------------------------------------------------------------
  // Rollback on error
  // -------------------------------------------------------------------------

  describe('rollback on handler error', () => {
    it('propagates handler errors and allows withTenantTransaction to rollback', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);

      // withTenantTransaction runs fn and throws if fn throws
      withTxSpy.mockImplementation(async (_principal: PrincipalContext, fn: (tx: any) => Promise<unknown>) => {
        try {
          return await fn({} as any);
        } catch (err) {
          // Simulate rollback happening inside withTenantTransaction
          throw err;
        }
      });

      const principal = tenantAStaffPrincipal();
      const request = buildMockRequest(principal);
      const ctx = createMockContext(request);
      const handlerErr = new Error('handler blew up');
      const handler = createMockErrorHandler(handlerErr);

      await expect(
        lastValueFrom(interceptor.intercept(ctx, handler)),
      ).rejects.toThrow('handler blew up');
    });
  });

  // -------------------------------------------------------------------------
  // Error code mapping
  // -------------------------------------------------------------------------

  describe('error code mapping', () => {
    it('maps QUERY_TIMEOUT to 503 ServiceUnavailableException', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const principal = tenantAStaffPrincipal();
      const request = buildMockRequest(principal);
      const ctx = createMockContext(request);

      const timeoutErr = Object.assign(new Error('Query timed out'), { code: 'QUERY_TIMEOUT' });
      withTxSpy.mockRejectedValue(timeoutErr);

      const obs = interceptor.intercept(ctx, createMockHandler());
      await expect(lastValueFrom(obs)).rejects.toMatchObject({ status: 503 });
    });

    it('maps TENANT_POLICY_VIOLATION to 403 ForbiddenException', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const principal = tenantAStaffPrincipal();
      const request = buildMockRequest(principal);
      const ctx = createMockContext(request);

      const policyErr = Object.assign(new Error('RLS violation'), { code: 'TENANT_POLICY_VIOLATION' });
      withTxSpy.mockRejectedValue(policyErr);

      const obs = interceptor.intercept(ctx, createMockHandler());
      await expect(lastValueFrom(obs)).rejects.toMatchObject({ status: 403 });
    });

    it('maps SERIALIZATION_ERROR to 409 ConflictException', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const principal = tenantAStaffPrincipal();
      const request = buildMockRequest(principal);
      const ctx = createMockContext(request);

      const serErr = Object.assign(new Error('Serialization failure'), { code: 'SERIALIZATION_ERROR' });
      withTxSpy.mockRejectedValue(serErr);

      const obs = interceptor.intercept(ctx, createMockHandler());
      await expect(lastValueFrom(obs)).rejects.toMatchObject({ status: 409 });
    });

    it('re-throws unknown errors unchanged', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      const principal = tenantAStaffPrincipal();
      const request = buildMockRequest(principal);
      const ctx = createMockContext(request);

      const randomErr = new Error('Unexpected database error');
      withTxSpy.mockRejectedValue(randomErr);

      const obs = interceptor.intercept(ctx, createMockHandler());
      await expect(lastValueFrom(obs)).rejects.toThrow('Unexpected database error');
    });
  });
});
