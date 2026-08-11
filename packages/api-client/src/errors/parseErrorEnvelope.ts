/**
 * parseErrorEnvelope — parse a non-2xx response into a typed ApiError.
 *
 * Handles:
 *   - Well-formed { error: { code, message, details, traceId } } envelopes
 *   - Empty bodies (e.g. 204 used incorrectly, network-level 502)
 *   - Non-JSON bodies (HTML error pages from CDN/load-balancer)
 *   - Malformed JSON (truncated responses)
 *   - Missing fields in otherwise-valid JSON
 *
 * Never throws — always returns an ApiError.
 */

import { ApiError } from './ApiError';

interface RawEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    traceId?: unknown;
    currentVersion?: unknown;
  };
}

export async function parseErrorEnvelope(
  response: Response,
  syntheticTraceId: string,
): Promise<ApiError> {
  const status = response.status;
  let raw: RawEnvelope | null = null;

  try {
    const text = await response.text();
    if (text.length > 0) {
      raw = JSON.parse(text) as RawEnvelope;
    }
  } catch {
    // Non-JSON body (HTML page, truncated response) — fall through with raw = null.
  }

  const envelope = raw?.error;
  const code = typeof envelope?.code === 'string' ? envelope.code : syntheticCodeFor(status);
  const message = typeof envelope?.message === 'string' ? envelope.message : httpMessageFor(status);
  const details = Array.isArray(envelope?.details) ? (envelope.details as unknown[]) : [];
  const traceId = typeof envelope?.traceId === 'string' ? envelope.traceId : syntheticTraceId;
  const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
  const currentVersion =
    typeof envelope?.currentVersion === 'string' ? envelope.currentVersion : null;

  return new ApiError({ status, code, message, details, traceId, retryAfterMs, currentVersion });
}

/**
 * Parse Retry-After header.
 * Handles both delta-seconds ("120") and HTTP-date ("Wed, 21 Oct 2025 07:28:00 GMT").
 * Returns milliseconds, capped at MAX_RETRY_AFTER_MS. Clock-skew-safe for past dates (min 0).
 */
export const MAX_RETRY_AFTER_MS = 60_000; // 60 second cap to avoid excessive waits

export function parseRetryAfter(headerValue: string | null, nowMs = Date.now()): number {
  if (!headerValue) return 0;
  const trimmed = headerValue.trim();

  // Delta-seconds form: a numeric string
  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds) && trimmed.match(/^\d+(\.\d+)?$/)) {
    return Math.min(Math.max(seconds * 1000, 0), MAX_RETRY_AFTER_MS);
  }

  // HTTP-date form
  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    const delta = date.getTime() - nowMs;
    return Math.min(Math.max(delta, 0), MAX_RETRY_AFTER_MS);
  }

  return 0;
}

function syntheticCodeFor(status: number): string {
  if (status === 400) return 'VALIDATION_ERROR';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 422) return 'BUSINESS_RULE_VIOLATION';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UNKNOWN_ERROR';
}

function httpMessageFor(status: number): string {
  if (status === 400) return 'Bad request';
  if (status === 401) return 'Authentication required';
  if (status === 403) return 'Access denied';
  if (status === 404) return 'Resource not found';
  if (status === 409) return 'Conflict — please reload and try again';
  if (status === 422) return 'Request could not be processed';
  if (status === 429) return 'Too many requests — please try again later';
  if (status >= 500) return 'Server error — please try again';
  return 'An unexpected error occurred';
}
