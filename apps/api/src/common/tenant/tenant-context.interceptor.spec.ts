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
 *   - Registration order in app.module.ts (AC1)
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
import { PrincipalContext, RequestContextStore } from '../../observability/request-context';
import {
  PrincipalFactory,
  TENANT_A_ID,
} from '../../../test/factories/principal.factory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockContext(
  principal?: Partial<PrincipalContext> | null,
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
    getHandler: () => 'handler',
    getClass: () => 'RegularClass',
  } as unknown as ExecutionContext;
}

function makeCallHandler(valueOrError?: unknown, isError = false): CallHandler {
  return {
    handle: () => (isError ? throwError(() => valueOrError) : of(valueOrError ?? 'ok')),
  } as CallHandler;
}

/**
 * Builds a mock UnitOfWork whose withTenantTransaction correctly wraps the
 * callback in a RequestContextStore.run() so that RequestContextStore._set()
 * (called inside the interceptor's fn) finds an active context.
 */
function makeMockUnitOfWork() {
  let capturedPrincipal: PrincipalContext | undefined;
  const fakeTx = {};

  const uow = {
    withTenantTransaction: jest.fn().mockImplementation(
      async (principal: PrincipalContext, fn: (tx: unknown) => Promise<unknown>) => {
        capturedPrincipal = principal;
        // Mirror the real implementation: run fn inside an active context so
        // RequestContextStore._set() in the interceptor's callback works.
        return RequestContextStore.run(
          { principal, tx: fakeTx as never },
          () => fn(fakeTx),
        );
      },
    ),
  } as unknown as jest.Mocked<UnitOfWork>;

  return { uow, getCaptured: () => capturedPrincipal };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('TenantContextInterceptor', () => {
  let interceptor: TenantContextInterceptor;
  let reflector: Reflector;
  let uow: jest.Mocked<UnitOfWork>;
  let getCaptured: () => PrincipalContext | undefined;

  beforeEach(async () => {
    ({ uow, getCaptured } = makeMockUnitOfWork());

    const moduleRef = await Test.createTestingModule({
      providers: [
        TenantContextInterceptor,
        { provide: Reflector, useClass: Reflector },
        { provide: UnitOfWork, useValue: uow },
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
    const ctx = makeMockContext();
    const handler = makeCallHandler('exempt-response');

    const result = await firstValueFrom(interceptor.intercept(ctx, handler));

    expect(result).toBe('exempt-response');
    expect(uow.withTenantTransaction).not.toHaveBeenCalled();
  });

  // ── Unauthenticated ────────────────────────────────────────────────────────
  it('throws 401 when request.user is not set (unauthenticated)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeMockContext(null);

    await expect(
      firstValueFrom(interceptor.intercept(ctx, makeCallHandler())),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(uow.withTenantTransaction).not.toHaveBeenCalled();
  });

  // ── Tenant-less principal ──────────────────────────────────────────────────
  it('throws 500 TENANT_CONTEXT_MISSING when principal.tenantId is empty', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeMockContext({ tenantId: '' });

    await expect(
      firstValueFrom(interceptor.intercept(ctx, makeCallHandler())),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(uow.withTenantTransaction).not.toHaveBeenCalled();
  });

  // ── SET LOCAL values derived from principal (AC1) ─────────────────────────
  it('passes the full principal to withTenantTransaction', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const principal = PrincipalFactory.staff({ tenantId: TENANT_A_ID });
    const ctx = makeMockContext(principal);

    await firstValueFrom(interceptor.intercept(ctx, makeCallHandler('response')));

    expect(getCaptured()).toMatchObject({
      tenantId: TENANT_A_ID,
      userId: principal.userId,
      principalKind: 'staff',
    });
  });

  // ── Rollback on handler throw (AC6) ───────────────────────────────────────
  it('propagates handler errors so the transaction rolls back', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeMockContext();
    const handlerError = new Error('handler exploded');

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
    expect(uow.withTenantTransaction).not.toHaveBeenCalled();
  });

  // ── Query-count assertion (AC7) ────────────────────────────────────────────
  it('calls withTenantTransaction exactly once per request', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = makeMockContext();

    await firstValueFrom(interceptor.intercept(ctx, makeCallHandler()));

    expect(uow.withTenantTransaction).toHaveBeenCalledTimes(1);
  });

  // ── request metadata written into context (AC2) ────────────────────────────
  it('writes requestId into the context store inside the transaction', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const principal = PrincipalFactory.staff({ tenantId: TENANT_A_ID });

    // Override mock to inspect context state inside fn
    let requestIdInsideFn: string | undefined;
    uow.withTenantTransaction.mockImplementation(
      async (p: PrincipalContext, fn: (tx: unknown) => Promise<unknown>) => {
        return RequestContextStore.run({ principal: p, tx: {} as never }, async () => {
          await fn({});
          requestIdInsideFn = RequestContextStore.get()?.requestId;
          return undefined;
        });
      },
    );

    const ctx = makeMockContext(principal);
    await firstValueFrom(interceptor.intercept(ctx, makeCallHandler()));

    expect(requestIdInsideFn).toBeDefined();
  });
});

// ── app.module.ts registration order (AC1) ─────────────────────────────────
describe('AppModule provider registration order', () => {
  it('registers APP_GUARD before APP_INTERCEPTOR', async () => {
    const { AppModule } = await import('../../app.module');
    const { APP_GUARD, APP_INTERCEPTOR } = await import('@nestjs/core');

    const metadata = Reflect.getMetadata('providers', AppModule) as { provide: unknown }[];
    expect(Array.isArray(metadata)).toBe(true);

    const guardIndex = metadata.findIndex((p) => p.provide === APP_GUARD);
    const interceptorIndex = metadata.findIndex((p) => p.provide === APP_INTERCEPTOR);

    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(interceptorIndex).toBeGreaterThan(guardIndex);
  });
});
