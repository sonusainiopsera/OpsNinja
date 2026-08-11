import { ApiError, isRateLimited } from '../errors/ApiError';
import type { ClientConfig, RequestOptions } from './request';
import { request } from './request';

export interface RetryConfig {
  /** Max number of retry attempts for idempotent 429s and 5xx */
  maxRetries?: number;
  /** Max delay cap in ms (default: 30 000) */
  maxDelayMs?: number;
  /** Injectable clock for testing */
  sleep?: (ms: number) => Promise<void>;
}

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_MAX_DELAY_MS = 30_000;

function jitter(baseMs: number): number {
  // ±25% jitter to avoid synchronised retry storms
  const factor = 0.75 + Math.random() * 0.5;
  return Math.round(baseMs * factor);
}

function exponentialDelay(attempt: number, baseMs = 1_000): number {
  return Math.min(baseMs * 2 ** attempt, DEFAULT_MAX_DELAY_MS);
}

function isRetryableStatus(status: number): boolean {
  // Only retry 429 (idempotent only) and 5xx
  return status === 429 || status >= 500;
}

function isNonRetryableStatus(status: number): boolean {
  return [400, 401, 403, 404, 409, 422].includes(status);
}

export async function requestWithRetry<T>(
  config: ClientConfig,
  options: RequestOptions,
  retryConfig: RetryConfig = {},
): Promise<T> {
  const { maxRetries = DEFAULT_MAX_RETRIES, maxDelayMs = DEFAULT_MAX_DELAY_MS } = retryConfig;
  const sleepFn = retryConfig.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));
  const method = options.method ?? 'GET';
  const isIdempotent = IDEMPOTENT_METHODS.has(method);

  let lastError: ApiError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await request<T>(config, options);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      lastError = err;

      // Non-retryable status codes — bail immediately
      if (isNonRetryableStatus(err.status)) throw err;

      // Transport errors (network / abort) — do not retry
      if (err.status === 0) throw err;

      // Non-idempotent mutations are never auto-retried
      if (!isIdempotent && isRetryableStatus(err.status)) throw err;

      // Last attempt — throw
      if (attempt >= maxRetries) throw err;

      if (isRateLimited(err)) {
        // Honour Retry-After (with jitter), capped at maxDelayMs
        const retryAfterMs = err.retryAfterMs ?? exponentialDelay(attempt);
        const delay = jitter(Math.min(retryAfterMs, maxDelayMs));
        await sleepFn(delay);
      } else if (err.status >= 500) {
        const delay = jitter(exponentialDelay(attempt));
        await sleepFn(delay);
      } else {
        throw err;
      }
    }
  }

  throw lastError ?? new ApiError({ status: 0, code: 'RETRY_EXHAUSTED', message: 'Max retries exceeded' });
}
