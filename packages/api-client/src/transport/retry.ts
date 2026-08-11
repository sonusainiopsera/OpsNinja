/**
 * Retry logic for idempotent requests.
 *
 * Rules:
 *   - NEVER retry: 400, 401, 403, 404, 409, 422 — deterministic client/auth errors.
 *   - RETRY with backoff: 429 (honour Retry-After), 5xx transient errors.
 *   - NEVER retry non-idempotent methods (POST, PATCH, DELETE) automatically.
 *   - Jitter on all delays to avoid synchronised retry storms.
 *   - Retry-After cap: MAX_RETRY_AFTER_MS from parseErrorEnvelope.
 */

import { ApiError } from '../errors/ApiError';

export interface RetryConfig {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injected clock for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 30_000;

const IDEMPOTENT_METHODS = new Set(['GET', 'PUT', 'HEAD', 'OPTIONS', 'DELETE']);

/** HTTP methods where we NEVER auto-retry regardless of status. */
const NON_RETRYABLE_METHODS = new Set(['POST', 'PATCH', 'DELETE']);

/** Statuses that are never worth retrying. */
function isNeverRetryStatus(status: number): boolean {
  return [400, 401, 403, 404, 409, 422].includes(status);
}

export function shouldRetry(
  err: unknown,
  attempt: number,
  method: string,
  maxAttempts: number,
): boolean {
  if (attempt >= maxAttempts) return false;
  if (NON_RETRYABLE_METHODS.has(method.toUpperCase())) return false;
  if (!(err instanceof ApiError)) return false;
  if (isNeverRetryStatus(err.status)) return false;
  // 429 or 5xx are retryable for idempotent methods
  return err.status === 429 || err.status >= 500;
}

export function computeBackoffMs(
  attempt: number,
  retryAfterMs: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  // Honour server-supplied Retry-After if present (already capped in parseRetryAfter).
  if (retryAfterMs > 0) {
    return retryAfterMs + jitter(retryAfterMs * 0.1);
  }
  // Exponential backoff with jitter.
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxDelayMs);
  return capped + jitter(capped * 0.2);
}

function jitter(maxMs: number): number {
  return Math.random() * maxMs;
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap a request function with retry logic.
 * The caller is responsible for ensuring the wrapped fn is idempotent.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  method: string,
  config: RetryConfig = {},
): Promise<T> {
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = config.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = config.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const sleep = config.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!shouldRetry(err, attempt + 1, method, maxAttempts)) {
        throw err;
      }
      const retryAfterMs = err instanceof ApiError ? err.retryAfterMs : 0;
      const delay = computeBackoffMs(attempt, retryAfterMs, baseDelayMs, maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}
