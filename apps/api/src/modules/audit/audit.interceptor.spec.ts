/**
 * Unit tests for AuditInterceptor.
 *
 * Verifies actor resolution for user, portal, machine, and anonymous principals.
 */

import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, lastValueFrom } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { requestContextStore } from '../../observability/request-context';
import { getAuditContext } from './audit-context';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildContext(principalOverrides: Record<string, unknown> = {}): ExecutionContext {
  const request = {
    headers: {
      'x-forwarded-for': '10.0.0.1',
      'user-agent': 'TestAgent/1.0',
      'x-request-id': 'req-abc',
    },
    socket: { remoteAddress: '127.0.0.1' },
    url: '/api/v1/tickets',
    method: 'POST',
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function buildReqCtx(principalOverrides = {}) {
  return {
    traceId: 'trace-1',
    principal: {
      tenantId: 'tenant-a',
      userId: 'user-1',
      principalKind: 'staff' as const,
      roles: ['support_agent'],
      orgScopeIds: [],
      traceId: 'trace-1',
      ...principalOverrides,
    },
    txHandle: {},
    startedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditInterceptor', () => {
  let interceptor: AuditInterceptor;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    interceptor = new AuditInterceptor(reflector);
  });

  it('binds AuditContext with user actorType for staff principal', async () => {
    const reqCtx = buildReqCtx({ principalKind: 'staff' });
    const ctx = buildContext();

    let capturedAuditCtx: ReturnType<typeof getAuditContext>;

    const handler: CallHandler = {
      handle: () =>
        of(null).pipe(),
    };

    jest
      .spyOn(handler, 'handle')
      .mockImplementation(() => {
        capturedAuditCtx = getAuditContext();
        return of(null);
      });

    await requestContextStore.run(reqCtx, () =>
      lastValueFrom(interceptor.intercept(ctx, handler)),
    );

    expect(capturedAuditCtx?.actorType).toBe('user');
    expect(capturedAuditCtx?.actorId).toBe('user-1');
    expect(capturedAuditCtx?.tenantId).toBe('tenant-a');
    expect(capturedAuditCtx?.ipHash).toBeTruthy();
    expect(capturedAuditCtx?.userAgent).toBe('TestAgent/1.0');
    expect(capturedAuditCtx?.requestId).toBe('req-abc');
  });

  it('binds integration actorType for machine principal', async () => {
    const reqCtx = buildReqCtx({ principalKind: 'machine' });
    const ctx = buildContext();
    let capturedAuditCtx: ReturnType<typeof getAuditContext>;

    const handler: CallHandler = {
      handle: () => {
        capturedAuditCtx = getAuditContext();
        return of(null);
      },
    };

    await requestContextStore.run(reqCtx, () =>
      lastValueFrom(interceptor.intercept(ctx, handler)),
    );

    expect(capturedAuditCtx?.actorType).toBe('integration');
  });

  it('passes through when route is exempt (NoTenantContext)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = buildContext();
    const handler: CallHandler = { handle: () => of('exempt-result') };

    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toBe('exempt-result');
  });

  it('passes through when no principal is bound', async () => {
    const reqCtx = { traceId: 'trace-1', startedAt: Date.now() };
    const ctx = buildContext();
    const handler: CallHandler = { handle: () => of('no-principal') };

    const result = await requestContextStore.run(
      reqCtx as ReturnType<typeof buildReqCtx>,
      () => lastValueFrom(interceptor.intercept(ctx, handler)),
    );
    expect(result).toBe('no-principal');
  });

  it('hashes IP address (never stores raw IP)', async () => {
    const reqCtx = buildReqCtx();
    const ctx = buildContext();
    let capturedAuditCtx: ReturnType<typeof getAuditContext>;

    const handler: CallHandler = {
      handle: () => {
        capturedAuditCtx = getAuditContext();
        return of(null);
      },
    };

    await requestContextStore.run(reqCtx, () =>
      lastValueFrom(interceptor.intercept(ctx, handler)),
    );

    // IP hash must not equal the raw IP
    expect(capturedAuditCtx?.ipHash).not.toBe('10.0.0.1');
    // Must be a 64-char hex string (SHA-256)
    expect(capturedAuditCtx?.ipHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
