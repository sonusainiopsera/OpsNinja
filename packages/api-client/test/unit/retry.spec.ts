import { describe, it, expect, vi } from 'vitest';
import { requestWithRetry } from '../../src/transport/retry';
import { ApiError } from '../../src/errors/ApiError';
import type { ClientConfig } from '../../src/transport/request';

const BASE_CONFIG: ClientConfig = { baseUrl: 'http://api.test', timeoutMs: 5_000 };

function makeJsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('requestWithRetry', () => {
  it('retries 5xx up to maxRetries times for GET', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(makeJsonResponse(500, { error: { code: 'E', message: 'err', traceId: 't' } }))
      .mockResolvedValueOnce(makeJsonResponse(500, { error: { code: 'E', message: 'err', traceId: 't' } }))
      .mockResolvedValue(makeJsonResponse(200, { ok: true }));

    const sleep = vi.fn().mockResolvedValue(undefined);
    const result = await requestWithRetry<{ ok: boolean }>(
      { ...BASE_CONFIG, fetch: fetchFn },
      { path: '/api/v1/test' },
      { maxRetries: 3, sleep },
    );
    expect(result.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry non-idempotent POST on 5xx', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse(500, { error: { code: 'E', message: 'err', traceId: 't' } }),
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(requestWithRetry(
      { ...BASE_CONFIG, fetch: fetchFn },
      { method: 'POST', path: '/api/v1/tickets', body: {} },
      { maxRetries: 3, sleep },
    )).rejects.toMatchObject({ status: 500 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does NOT retry 400', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse(400, { error: { code: 'V', message: 'v', traceId: 't' } }),
    );
    await expect(requestWithRetry(
      { ...BASE_CONFIG, fetch: fetchFn },
      { path: '/api/v1/test' },
      { maxRetries: 3 },
    )).rejects.toMatchObject({ status: 400 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry 401', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      makeJsonResponse(401, { error: { code: 'A', message: 'a', traceId: 't' } }),
    );
    await expect(requestWithRetry(
      { ...BASE_CONFIG, fetch: fetchFn },
      { path: '/api/v1/test' },
      { maxRetries: 3 },
    )).rejects.toMatchObject({ status: 401 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry 403, 404, 409, 422', async () => {
    for (const status of [403, 404, 409, 422]) {
      const fetchFn = vi.fn().mockResolvedValue(
        makeJsonResponse(status, { error: { code: 'X', message: 'x', traceId: 't' } }),
      );
      await expect(requestWithRetry(
        { ...BASE_CONFIG, fetch: fetchFn },
        { path: '/api/v1/test' },
        { maxRetries: 3 },
      )).rejects.toMatchObject({ status });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it('honours Retry-After for idempotent 429', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'RATE_LIMIT', message: 'slow', traceId: 't' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '10' },
        }),
      )
      .mockResolvedValue(makeJsonResponse(200, { data: [] }));

    const sleep = vi.fn().mockResolvedValue(undefined);
    await requestWithRetry(
      { ...BASE_CONFIG, fetch: fetchFn },
      { path: '/api/v1/test' },
      { maxRetries: 2, sleep },
    );
    expect(sleep).toHaveBeenCalledTimes(1);
    // sleep delay should be near 10_000ms (with ±25% jitter: 7_500 to 12_500)
    const delay = sleep.mock.calls[0][0] as number;
    expect(delay).toBeGreaterThanOrEqual(7_500);
    expect(delay).toBeLessThanOrEqual(12_500);
  });
});
