import { describe, it, expect, vi } from 'vitest';
import { shouldRetry, computeBackoffMs, withRetry } from '../src/transport/retry';
import { ApiError } from '../src/errors/ApiError';

function apiErr(status: number) {
  return new ApiError({ status, code: 'ERR', message: 'err', details: [], traceId: 'tr' });
}

describe('shouldRetry', () => {
  it('retries 429 for GET', () => {
    expect(shouldRetry(apiErr(429), 1, 'GET', 3)).toBe(true);
  });

  it('retries 500 for GET', () => {
    expect(shouldRetry(apiErr(500), 1, 'GET', 3)).toBe(true);
  });

  it('never retries 400', () => {
    expect(shouldRetry(apiErr(400), 1, 'GET', 3)).toBe(false);
  });

  it('never retries 401', () => {
    expect(shouldRetry(apiErr(401), 1, 'GET', 3)).toBe(false);
  });

  it('never retries 403', () => {
    expect(shouldRetry(apiErr(403), 1, 'GET', 3)).toBe(false);
  });

  it('never retries 404', () => {
    expect(shouldRetry(apiErr(404), 1, 'GET', 3)).toBe(false);
  });

  it('never retries 409', () => {
    expect(shouldRetry(apiErr(409), 1, 'GET', 3)).toBe(false);
  });

  it('never retries 422', () => {
    expect(shouldRetry(apiErr(422), 1, 'GET', 3)).toBe(false);
  });

  it('never retries POST (non-idempotent)', () => {
    expect(shouldRetry(apiErr(500), 1, 'POST', 3)).toBe(false);
  });

  it('never retries PATCH', () => {
    expect(shouldRetry(apiErr(500), 1, 'PATCH', 3)).toBe(false);
  });

  it('stops retrying at maxAttempts', () => {
    expect(shouldRetry(apiErr(500), 3, 'GET', 3)).toBe(false);
  });

  it('non-ApiError: returns false', () => {
    expect(shouldRetry(new Error('network'), 1, 'GET', 3)).toBe(false);
  });
});

describe('computeBackoffMs', () => {
  it('honours server Retry-After when present', () => {
    const ms = computeBackoffMs(0, 5000, 500, 30000);
    expect(ms).toBeGreaterThanOrEqual(5000);
    expect(ms).toBeLessThan(5000 + 5000 * 0.1 + 1); // retryAfterMs + up to 10% jitter
  });

  it('uses exponential backoff when no Retry-After', () => {
    const ms = computeBackoffMs(1, 0, 500, 30000);
    // base * 2^1 = 1000, plus jitter up to 20%
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThan(1000 * 1.2 + 1);
  });

  it('caps at maxDelayMs', () => {
    const ms = computeBackoffMs(20, 0, 500, 2000);
    expect(ms).toBeLessThanOrEqual(2000 * 1.2 + 1);
  });
});

describe('withRetry', () => {
  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 'GET', { sleep: async () => {} });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries 500 and succeeds', async () => {
    let attempt = 0;
    const fn = vi.fn().mockImplementation(async () => {
      if (++attempt < 3) throw apiErr(500);
      return 'ok';
    });
    const result = await withRetry(fn, 'GET', { maxAttempts: 3, sleep: async () => {} });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws immediately on 401 (never-retry status)', async () => {
    const fn = vi.fn().mockRejectedValue(apiErr(401));
    await expect(withRetry(fn, 'GET', { sleep: async () => {} })).rejects.toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry POST even on 500', async () => {
    const fn = vi.fn().mockRejectedValue(apiErr(500));
    await expect(withRetry(fn, 'POST', { sleep: async () => {} })).rejects.toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
