import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager, classify401 } from '../../src/session/SessionManager';
import { ApiError } from '../../src/errors/ApiError';
import type { ClientConfig } from '../../src/transport/request';

// ── classify401 ────────────────────────────────────────────────────────────────

describe('classify401', () => {
  it('returns refresh-and-replay for AUTH_TOKEN_EXPIRED', () => {
    const err = new ApiError({ status: 401, code: 'AUTH_TOKEN_EXPIRED', message: 'Expired' });
    expect(classify401(err)).toBe('refresh-and-replay');
  });

  it('returns refresh-and-replay for TOKEN_EXPIRED', () => {
    const err = new ApiError({ status: 401, code: 'TOKEN_EXPIRED', message: 'Expired' });
    expect(classify401(err)).toBe('refresh-and-replay');
  });

  it('returns reauthorize for AUTH_REAUTHORIZE_REQUIRED (scope changed)', () => {
    const err = new ApiError({ status: 401, code: 'AUTH_REAUTHORIZE_REQUIRED', message: 'Reauth' });
    expect(classify401(err)).toBe('reauthorize');
  });

  it('returns reauthorize for SCOPE_VERSION_STALE', () => {
    const err = new ApiError({ status: 401, code: 'SCOPE_VERSION_STALE', message: 'Stale' });
    expect(classify401(err)).toBe('reauthorize');
  });

  it('fails closed: unknown 401 code returns reauthorize', () => {
    const err = new ApiError({ status: 401, code: 'UNKNOWN_CODE', message: 'Unknown' });
    expect(classify401(err)).toBe('reauthorize');
  });

  it('fails closed: empty code returns reauthorize', () => {
    const err = new ApiError({ status: 401, code: '', message: 'No code' });
    expect(classify401(err)).toBe('reauthorize');
  });
});

// ── SessionManager helpers ─────────────────────────────────────────────────────

function makeExpired401(): ApiError {
  return new ApiError({ status: 401, code: 'AUTH_TOKEN_EXPIRED', message: 'Token expired' });
}

function makeScopeChanged401(): ApiError {
  return new ApiError({ status: 401, code: 'AUTH_REAUTHORIZE_REQUIRED', message: 'Scope changed' });
}

function makeRefreshConfig(fetchFn: typeof globalThis.fetch): ClientConfig {
  return { baseUrl: 'http://api.test', fetch: fetchFn, timeoutMs: 5_000 };
}

function makeSuccessRefreshFetch(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ accessToken: 'new_token' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function makeFailedRefreshFetch(code = 'AUTH_TOKEN_EXPIRED'): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ error: { code, message: 'Refresh failed', traceId: 't' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

// ── handle401 ─────────────────────────────────────────────────────────────────

describe('SessionManager.handle401', () => {
  it('returns false and emits reauthorization-required for scope-changed 401', async () => {
    const events: string[] = [];
    const sm = new SessionManager({
      config: makeRefreshConfig(makeSuccessRefreshFetch()),
      onSessionEvent: e => events.push(e),
    });

    const shouldReplay = await sm.handle401(makeScopeChanged401(), false);
    expect(shouldReplay).toBe(false);
    expect(events).toContain('reauthorization-required');
  });

  it('does NOT call refresh for scope-changed 401', async () => {
    const fetchFn = makeSuccessRefreshFetch();
    const sm = new SessionManager({ config: makeRefreshConfig(fetchFn) });
    await sm.handle401(makeScopeChanged401(), false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns true (replay) for expired-token 401 when refresh succeeds', async () => {
    const fetchFn = makeSuccessRefreshFetch();
    const sm = new SessionManager({ config: makeRefreshConfig(fetchFn) });
    const shouldReplay = await sm.handle401(makeExpired401(), false);
    expect(shouldReplay).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('returns false and emits unauthenticated when refresh fails', async () => {
    const events: string[] = [];
    const sm = new SessionManager({
      config: makeRefreshConfig(makeFailedRefreshFetch()),
      onSessionEvent: e => events.push(e),
    });

    const shouldReplay = await sm.handle401(makeExpired401(), false);
    expect(shouldReplay).toBe(false);
    expect(events).toContain('unauthenticated');
  });

  it('loop guard: replayed request 401 prevents second refresh', async () => {
    const fetchFn = makeSuccessRefreshFetch();
    const events: string[] = [];
    const sm = new SessionManager({
      config: makeRefreshConfig(fetchFn),
      onSessionEvent: e => events.push(e),
    });

    // isReplay=true simulates: this request already got refreshed once
    const shouldReplay = await sm.handle401(makeExpired401(), true);
    expect(shouldReplay).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(events).toContain('reauthorization-required');
  });
});

// ── Single-flight refresh ──────────────────────────────────────────────────────

describe('SessionManager single-flight refresh', () => {
  it('N concurrent 401s produce exactly one refresh call', async () => {
    const fetchFn = makeSuccessRefreshFetch();
    const sm = new SessionManager({ config: makeRefreshConfig(fetchFn) });

    // Fire 5 concurrent refreshes
    const promises = Array.from({ length: 5 }, () => sm.refresh());
    await Promise.all(promises);

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('second refresh after first completes is a new call', async () => {
    const fetchFn = makeSuccessRefreshFetch();
    const sm = new SessionManager({ config: makeRefreshConfig(fetchFn) });

    await sm.refresh();
    await sm.refresh();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

// ── executeWithRefresh ─────────────────────────────────────────────────────────

describe('SessionManager.executeWithRefresh', () => {
  it('returns original result when no 401', async () => {
    const sm = new SessionManager({ config: makeRefreshConfig(makeSuccessRefreshFetch()) });
    const result = await sm.executeWithRefresh(() => Promise.resolve('data'));
    expect(result).toBe('data');
  });

  it('refreshes and replays on expired-token 401', async () => {
    const fetchFn = makeSuccessRefreshFetch();
    const sm = new SessionManager({ config: makeRefreshConfig(fetchFn) });

    let callCount = 0;
    const result = await sm.executeWithRefresh((isReplay) => {
      callCount++;
      if (!isReplay) throw makeExpired401();
      return Promise.resolve('replayed');
    });

    expect(result).toBe('replayed');
    expect(callCount).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(1); // one refresh call
  });

  it('does not replay for scope-changed 401', async () => {
    const events: string[] = [];
    const sm = new SessionManager({
      config: makeRefreshConfig(makeSuccessRefreshFetch()),
      onSessionEvent: e => events.push(e),
    });

    let callCount = 0;
    await expect(sm.executeWithRefresh(() => {
      callCount++;
      throw makeScopeChanged401();
    })).rejects.toMatchObject({ code: 'AUTH_REAUTHORIZE_REQUIRED' });

    expect(callCount).toBe(1); // no replay
    expect(events).toContain('reauthorization-required');
  });

  it('loop guard inside executeWithRefresh: replay 401 does not recurse', async () => {
    const fetchFn = makeSuccessRefreshFetch();
    const events: string[] = [];
    const sm = new SessionManager({
      config: makeRefreshConfig(fetchFn),
      onSessionEvent: e => events.push(e),
    });

    // Both attempts throw expired-token 401
    await expect(sm.executeWithRefresh(() => {
      throw makeExpired401();
    })).rejects.toMatchObject({ code: 'AUTH_TOKEN_EXPIRED' });

    expect(fetchFn).toHaveBeenCalledTimes(1); // only one refresh, not two
    expect(events).toContain('reauthorization-required');
  });
});

// ── Event emitter ──────────────────────────────────────────────────────────────

describe('SessionManager event emitter', () => {
  it('addEventListener / removeEventListener works', async () => {
    const fetchFn = makeSuccessRefreshFetch();
    const sm = new SessionManager({ config: makeRefreshConfig(fetchFn) });

    const events: string[] = [];
    const listener = (e: string) => events.push(e);
    sm.addEventListener(listener);
    sm.removeEventListener(listener);

    await sm.handle401(makeScopeChanged401(), false);
    expect(events).toHaveLength(0); // listener removed
  });

  it('does not throw if listener throws', async () => {
    const fetchFn = makeFailedRefreshFetch();
    const sm = new SessionManager({
      config: makeRefreshConfig(fetchFn),
      onSessionEvent: () => { throw new Error('listener error'); },
    });

    // Should not propagate listener error
    await expect(sm.handle401(makeExpired401(), false)).resolves.toBeDefined();
  });
});
