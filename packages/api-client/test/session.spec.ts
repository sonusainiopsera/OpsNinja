/**
 * SessionManager unit tests — the priority test suite for WO-021.
 *
 * Covers:
 *   AC7  — expired 401 triggers exactly one refresh then replay
 *   AC8  — N concurrent 401s produce exactly one refresh call
 *   AC8  — single-flight: 5 concurrent 401s → 1 refresh call
 *   AC9  — scope-changed 401 → zero refreshes, zero replays, reauthorization-required event
 *   AC10 — replay that 401s again → loop guard prevents second refresh
 *   AC7  — refresh failure clears session and emits unauthenticated
 *   AC9  — unknown 401 code → reauthorization-required (fail closed)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../src/session/SessionManager';
import { ApiError } from '../src/errors/ApiError';

function make401(code: string) {
  return new ApiError({
    status: 401,
    code,
    message: 'Unauthorized',
    details: [],
    traceId: 'tr-401',
  });
}

function make200<T>(data: T) {
  return data;
}

describe('SessionManager — expired 401 single refresh + replay (AC7)', () => {
  it('triggers refresh and replays on AUTH_TOKEN_EXPIRED', async () => {
    let callCount = 0;
    const request = vi.fn().mockImplementation(async (opts: { path: string; _isReplay?: boolean }) => {
      if (opts.path === '/api/v1/auth/refresh') return make200({ ok: true });
      callCount++;
      if (!opts._isReplay) throw make401('AUTH_TOKEN_EXPIRED');
      return make200({ data: 'ok' });
    });

    const sm = new SessionManager({ request });
    const result = await sm.execute({ path: '/api/v1/tickets' });

    expect(result).toEqual({ data: 'ok' });
    // refresh + two calls to /tickets (original + replay)
    const refreshCalls = request.mock.calls.filter(([o]) => o.path === '/api/v1/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
  });

  it('emits unauthenticated when refresh fails', async () => {
    const refreshError = new ApiError({ status: 401, code: 'AUTH_TOKEN_EXPIRED', message: 'still', details: [], traceId: 'tr' });
    const request = vi.fn().mockImplementation(async (opts: { path: string }) => {
      if (opts.path === '/api/v1/auth/refresh') throw refreshError;
      throw make401('AUTH_TOKEN_EXPIRED');
    });

    const sm = new SessionManager({ request });
    const events: string[] = [];
    sm.on((e) => events.push(e));

    await expect(sm.execute({ path: '/api/v1/tickets' })).rejects.toBeInstanceOf(ApiError);
    expect(events).toContain('unauthenticated');
  });
});

describe('SessionManager — single-flight refresh (AC8)', () => {
  it('5 concurrent 401s produce exactly one refresh call', async () => {
    let refreshCalls = 0;
    let requestCount = 0;

    const request = vi.fn().mockImplementation(async (opts: { path: string; _isReplay?: boolean }) => {
      if (opts.path === '/api/v1/auth/refresh') {
        refreshCalls++;
        await Promise.resolve(); // allow other calls to queue
        return make200({ ok: true });
      }
      requestCount++;
      if (!opts._isReplay) throw make401('AUTH_TOKEN_EXPIRED');
      return make200({ data: 'ok', id: requestCount });
    });

    const sm = new SessionManager({ request });

    const promises = Array.from({ length: 5 }, () => sm.execute({ path: '/api/v1/tickets' }));
    const results = await Promise.all(promises);

    expect(refreshCalls).toBe(1);
    expect(results).toHaveLength(5);
    // All 5 should succeed (replayed after single refresh)
    for (const r of results) {
      expect(r).toMatchObject({ data: 'ok' });
    }
  });
});

describe('SessionManager — scope-changed 401 (AC9)', () => {
  it('scope-changed 401 emits reauthorization-required with zero refreshes', async () => {
    let refreshCalls = 0;
    const request = vi.fn().mockImplementation(async (opts: { path: string }) => {
      if (opts.path === '/api/v1/auth/refresh') { refreshCalls++; return make200({ ok: true }); }
      throw make401('AUTH_REAUTHORIZE_REQUIRED');
    });

    const sm = new SessionManager({ request });
    const events: string[] = [];
    sm.on((e) => events.push(e));

    await expect(sm.execute({ path: '/api/v1/tickets' })).rejects.toBeInstanceOf(ApiError);

    expect(refreshCalls).toBe(0);
    expect(events).toContain('reauthorization-required');
  });

  it('scope-changed: no replay occurs', async () => {
    let ticketCalls = 0;
    const request = vi.fn().mockImplementation(async (opts: { path: string }) => {
      if (opts.path === '/api/v1/tickets') {
        ticketCalls++;
        throw make401('org_scope_changed');
      }
      return make200({ ok: true });
    });

    const sm = new SessionManager({ request });
    await expect(sm.execute({ path: '/api/v1/tickets' })).rejects.toBeInstanceOf(ApiError);
    // Only 1 call — original, no replay
    expect(ticketCalls).toBe(1);
  });
});

describe('SessionManager — loop guard (AC10)', () => {
  it('replayed request that 401s again does not trigger second refresh', async () => {
    let refreshCalls = 0;

    const request = vi.fn().mockImplementation(async (opts: { path: string; _isReplay?: boolean }) => {
      if (opts.path === '/api/v1/auth/refresh') { refreshCalls++; return make200({ ok: true }); }
      // Always 401 — even on replay
      throw make401('AUTH_TOKEN_EXPIRED');
    });

    const sm = new SessionManager({ request });
    const events: string[] = [];
    sm.on((e) => events.push(e));

    await expect(sm.execute({ path: '/api/v1/tickets' })).rejects.toBeInstanceOf(ApiError);

    // Exactly one refresh — the loop guard prevented recursion
    expect(refreshCalls).toBe(1);
    expect(events).toContain('reauthorization-required');
  });
});

describe('SessionManager — unknown 401 code (fail closed, AC9)', () => {
  it('unrecognised 401 code emits reauthorization-required with no refresh', async () => {
    let refreshCalls = 0;
    const request = vi.fn().mockImplementation(async (opts: { path: string }) => {
      if (opts.path === '/api/v1/auth/refresh') { refreshCalls++; return make200({ ok: true }); }
      throw make401('SOME_UNKNOWN_401_CODE');
    });

    const sm = new SessionManager({ request });
    const events: string[] = [];
    sm.on((e) => events.push(e));

    await expect(sm.execute({ path: '/api/v1/tickets' })).rejects.toBeInstanceOf(ApiError);
    expect(refreshCalls).toBe(0);
    expect(events).toContain('reauthorization-required');
  });
});

describe('SessionManager — non-401 errors pass through', () => {
  it('403 is not intercepted', async () => {
    const err403 = new ApiError({ status: 403, code: 'FORBIDDEN', message: 'no', details: [], traceId: 'tr' });
    const request = vi.fn().mockRejectedValue(err403);
    const sm = new SessionManager({ request });
    const events: string[] = [];
    sm.on((e) => events.push(e));

    await expect(sm.execute({ path: '/api/v1/tickets' })).rejects.toThrow(err403);
    expect(events).toHaveLength(0);
  });

  it('network error is not intercepted', async () => {
    const networkErr = new ApiError({ status: 0, code: 'TRANSPORT_ERROR', message: 'offline', details: [], traceId: 'tr' });
    const request = vi.fn().mockRejectedValue(networkErr);
    const sm = new SessionManager({ request });

    await expect(sm.execute({ path: '/api/v1/tickets' })).rejects.toThrow(networkErr);
  });
});
