/**
 * Typed error hierarchy for LLM provider failures.
 *
 * RetryableLlmError   — transient failures; callers should retry with backoff.
 * NonRetryableLlmError — permanent failures; retrying will not help.
 * InvalidModelOutputError — subclass of NonRetryableLlmError for Zod failures.
 *
 * All errors carry:
 *  - code: stable string identifier for programmatic handling.
 *  - message: safe human-readable description with no thread content.
 *  - traceId?: propagated from the calling context for log correlation.
 */

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

export type RetryableCode =
  | 'THROTTLED'
  | 'MODEL_TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'REQUEST_TIMEOUT';

export type NonRetryableCode =
  | 'INVALID_MODEL_OUTPUT'
  | 'CONTENT_POLICY_VIOLATION'
  | 'UNSUPPORTED_MODEL'
  | 'MALFORMED_OUTPUT'
  | 'VALIDATION_FAILED';

export type LlmErrorCode = RetryableCode | NonRetryableCode;

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

export abstract class LlmError extends Error {
  abstract readonly retryable: boolean;

  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly traceId?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// ---------------------------------------------------------------------------
// Retryable
// ---------------------------------------------------------------------------

/**
 * Transient provider error. The caller may retry after appropriate backoff.
 * If the original response included a Retry-After hint, it is preserved.
 */
export class RetryableLlmError extends LlmError {
  override readonly retryable = true as const;

  constructor(
    code: RetryableCode,
    message: string,
    public readonly retryAfterMs?: number,
    traceId?: string,
  ) {
    super(code, message, traceId);
  }
}

// ---------------------------------------------------------------------------
// Non-retryable
// ---------------------------------------------------------------------------

/**
 * Permanent provider failure. Retrying will not succeed.
 */
export class NonRetryableLlmError extends LlmError {
  override readonly retryable = false as const;

  constructor(
    code: NonRetryableCode,
    message: string,
    traceId?: string,
  ) {
    super(code, message, traceId);
  }
}

/**
 * Zod validation failure after JSON extraction.
 * Carries the raw (unlogged) validation issue count for metrics.
 */
export class InvalidModelOutputError extends NonRetryableLlmError {
  constructor(
    public readonly issueCount: number,
    traceId?: string,
  ) {
    super(
      'INVALID_MODEL_OUTPUT',
      `Model output failed schema validation (${issueCount} issue(s)).`,
      traceId,
    );
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Maps AWS SDK error names and network error codes to typed LlmErrors.
 * Unrecognised errors are classified as NonRetryableLlmError with code MALFORMED_OUTPUT.
 */
export function classifyProviderError(err: unknown, traceId?: string): LlmError {
  if (err instanceof LlmError) return err;

  const name = err instanceof Error ? err.name : String(err);
  const message = err instanceof Error ? err.message : String(err);

  // Retryable: throttling
  if (
    name === 'ThrottlingException' ||
    name === 'TooManyRequestsException' ||
    message.includes('429')
  ) {
    const retryAfterMs = extractRetryAfter(err);
    return new RetryableLlmError('THROTTLED', 'LLM provider is throttling requests.', retryAfterMs, traceId);
  }

  // Retryable: model-side timeout
  if (name === 'ModelTimeoutException') {
    return new RetryableLlmError('MODEL_TIMEOUT', 'Model inference timed out on the provider side.', undefined, traceId);
  }

  // Retryable: service unavailable / 5xx
  if (
    name === 'ServiceUnavailableException' ||
    name === 'InternalServerException' ||
    message.includes('503') ||
    message.includes('500')
  ) {
    return new RetryableLlmError('SERVICE_UNAVAILABLE', 'LLM provider returned a server error.', undefined, traceId);
  }

  // Retryable: network / AbortController timeout
  if (
    name === 'AbortError' ||
    name === 'FetchError' ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('network') ||
    message.includes('timeout')
  ) {
    return new RetryableLlmError('NETWORK_ERROR', 'Network error communicating with LLM provider.', undefined, traceId);
  }

  // Non-retryable: content policy
  if (name === 'AccessDeniedException' && message.toLowerCase().includes('content')) {
    return new NonRetryableLlmError('CONTENT_POLICY_VIOLATION', 'Request was blocked by content policy.', traceId);
  }

  // Non-retryable: unsupported model
  if (name === 'ValidationException' && message.toLowerCase().includes('model')) {
    return new NonRetryableLlmError('UNSUPPORTED_MODEL', 'The requested model ID is not supported.', traceId);
  }

  // Default: treat unknown errors as non-retryable malformed output
  return new NonRetryableLlmError('MALFORMED_OUTPUT', 'Unexpected provider error.', traceId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractRetryAfter(err: unknown): number | undefined {
  if (err instanceof Error) {
    const match = /retry.?after[: ]+(\d+)/i.exec(err.message);
    if (match) {
      const secs = parseInt(match[1] ?? '0', 10);
      if (!isNaN(secs)) return secs * 1_000;
    }
  }
  return undefined;
}
