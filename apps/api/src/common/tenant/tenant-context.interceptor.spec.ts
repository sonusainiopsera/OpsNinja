/**
 * Unit tests for TenantContextInterceptor.
 *
 * Uses a fake UnitOfWork so no real database connection is required.
 *
 * Coverage targets (AC9):
 *   - SET LOCAL values are derived from the principal
 *   - Exempt routes skip transaction opening
 *   - Tenant-less authenticated principal → TENANT_CONTEXT_MISSING
 *   - Rollback on handler throw
 *   - Registration order in app.module.ts
 */

import {
  CallHandler,
  ExecutionContext,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { UnitOfWork } from '../../data/unit-of-work';
import { PrincipalContext } from '../../observability/request-context';
import { NO_TENANT_CONTEXT_KEY } from './no-tenant-context.decorator';
import { ErrorCode } from '../errors/app-errors';
import {
  PrincipalFactory,
  TENANT_A_ID,
} from '../../../test/factories/principal.factory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockContext(
  principal?: Partial<PrincipalContext> | null,
  exempt?: boolean,
): ExecutionContext {
  const req = {
    user: principal === null ? undefined : { ...PrincipalFactory.staff(), ...principal },
    headers: {},
  };
  const res = {
    once: jest.fn(),
    removeListener: jest.fn(),
    on: jest.fn(),
    headersSent: false,
  };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => (exempt ? 'handler' : 'regularHandler'),
    getClass: () => (exempt ? 'ExemptClass' : 'RegularClass'),
  } as unknown as ExecutionContext;
}

function makeCallHandler(valueOrError?: unknown, isError = false): CallHandler {
  return {
    handle: () => (isError ? throwError(() => valueOrError) : of(valueOrError ?? 'ok')),
  } as CallHandler;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor;
  let reflector: Reflector;
  let unitOfWork: jest.Mocked<UnitOfWork>;
  let capturedPrincipal: PrincipalContext | undefined;

  beforeEach(async () => {
    capturedPrincipal = undefined;
    unitOfWork = {
      withTenantTransaction: jest.fn().mockImplementation(
        async (principal: PrincipalContext, fn: (tx: unknown) => Promise<unknown>) => {
          capturedPrincipal = principal;
          return fn({} /* fake tx handle */);
        },
      ),
    } as unknown as jest.Mocked<UnitOfWork>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantContextInterceptor,
        { provide: Reflector, useClass: Reflector },
        { provide: UnitOfWork, useValue: unitOfWork },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(5_000) },
        },
      ],
    }).compile();

    interceptor = moduleRef.get(TenantContextInterceptor);
    reflector = moduleRef.get(Reflector);
  });

  // ── Exemption ──────────────────────────────────────────────────────────────
  it('skips transaction for exempt (@NoTenantContext) handler', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = makeMockContext(undefined, true);
    const handler = makeCallHandler('exempt-response');

    const result = await firstValueFrom(interceptor.intercept(ctx, handler));

    expect(result).toBe('exempt-response');
    expect(unitOfWork.withTenantTransaction).not.toHaveBeenCalled();
  });

  // ── Unauthenticated ────────────────────────────────────────────────────────
  it('throws 401 when request.user is not set (unauthenticated)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeMockContext(null);

    await expect(
      firstValueFrom(interceptor.intercept(ctx, makeCallHandler())),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(unitOfWork.withTenantTransaction).not.toHaveBeenCalled();
  });

  // ── Tenant-less principal ──────────────────────────────────────────────────
  it('throws 500 TENANT_CONTEXT_MISSING when principal.tenantId is empty', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeMockContext({ tenantId: '' });

    await expect(
      firstValueFrom(interceptor.intercept(ctx, makeCallHandler())),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(unitOfWork.withTenantTransaction).not.toHaveBeenCalled();
  });

  // ── SET LOCAL values derived from principal ────────────────────────────────
  it('passes the full principal to withTenantTransaction', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const principal = PrincipalFactory.staff({ tenantId: TENANT_A_ID });
    const ctx = makeMockContext(principal);

    await firstValueFrom(interceptor.intercept(ctx, makeCallHandler('response')));

    expect(capturedPrincipal).toMatchObject({
      tenantId: TENANT_A_ID,
      userId: principal.userId,
      principalKind: 'staff',
    });
  });

  // ── Rollback on handler throw ──────────────────────────────────────────────
  it('propagates handler errors so the transaction rolls back', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeMockContext();
    const handlerError = new Error('handler exploded');

    // UnitOfWork re-throws when fn throws (real behaviour).
    unitOfWork.withTenantTransaction.mockImplementation(
      async (_principal, fn) => fn({} /* fake tx */),
    );

    await expect(
      firstValueFrom(interceptor.intercept(ctx, makeCallHandler(handlerError, true))),
    ).rejects.toThrow('handler exploded');
  });

  // ── Non-HTTP context ───────────────────────────────────────────────────────
  it('passes through non-HTTP contexts without touching the transaction', async () => {
    const wsCtx = {
      getType: () => 'ws',
      switchToHttp: () => ({ getRequest: () => ({}), getResponse: () => ({}) }),
      getHandler: () => 'handler',
      getClass: () => 'Class',
    } as unknown as ExecutionContext;

    const result = await firstValueFrom(interceptor.intercept(wsCtx, makeCallHandler('ws-result')));

    expect(result).toBe('ws-result');
    expect(unitOfWork.withTenantTransaction).not.toHaveBeenCalled();
  });

  // ── Query-count assertion (AC7) ────────────────────────────────────────────
  it('calls withTenantTransaction exactly once per request', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeMockContext();

    await firstValueFrom(interceptor.intercept(ctx, makeCallHandler()));

    expect(unitOfWork.withTenantTransaction).toHaveBeenCalledTimes(1);
  });
});

// ── app.module.ts registration order ─────────────────────────────────────────
describe('AppModule provider registration order (AC1)', () => {
  it('registers APP_GUARD before APP_INTERCEPTOR', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = await import('../../app.module');
    const { APP_GUARD, APP_INTERCEPTOR } = await import('@nestjs/core');

    const providers = (AppModule as unknown as { _providers?: { provide: unknown }[] })['_providers'];
    // Reflect over module metadata
    const metadata = Reflect.getMetadata('providers', AppModule) as { provide: unknown }[];
    expect(Array.isArray(metadata)).toBe(true);

    const guardIndex = metadata.findIndex((p) => p.provide === APP_GUARD);
    const interceptorIndex = metadata.findIndex((p) => p.provide === APP_INTERCEPTOR);

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(interceptorIndex).toBeGreaterThan(guardIndex);
  });
});
