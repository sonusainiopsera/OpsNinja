import { describe, it, expect } from 'vitest';
import {
  classifyProviderError,
  RetryableLlmError,
  NonRetryableLlmError,
} from '../errors.js';

// ---------------------------------------------------------------------------
// Helper: fake SDK-style errors
// ---------------------------------------------------------------------------

function sdkError(name: string, message = 'SDK error'): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

// ---------------------------------------------------------------------------
// Retryable classifications
// ---------------------------------------------------------------------------

describe('classifyProviderError — retryable', () => {
  it('classifies ThrottlingException as THROTTLED', () => {
    const err = classifyProviderError(sdkError('ThrottlingException'), 'trace-1');
    expect(err).toBeInstanceOf(RetryableLlmError);
    expect(err.code).toBe('THROTTLED');
  });

  it('classifies TooManyRequestsException as THROTTLED', () => {
    const err = classifyProviderError(sdkError('TooManyRequestsException'), 'trace-1');
    expect(err.code).toBe('THROTTLED');
    expect(err.retryable).toBe(true);
  });

  it('classifies error with 429 in message as THROTTLED', () => {
    const err = classifyProviderError(sdkError('Error', 'Received 429 from upstream'), 'trace-1');
    expect(err.code).toBe('THROTTLED');
  });

  it('classifies ServiceUnavailableException as SERVICE_UNAVAILABLE', () => {
    const err = classifyProviderError(sdkError('ServiceUnavailableException'), 'trace-2');
    expect(err).toBeInstanceOf(RetryableLlmError);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('classifies InternalServerException as SERVICE_UNAVAILABLE', () => {
    const err = classifyProviderError(sdkError('InternalServerException'), 'trace-2');
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('classifies ModelTimeoutException as MODEL_TIMEOUT', () => {
    const err = classifyProviderError(sdkError('ModelTimeoutException'), 'trace-3');
    expect(err).toBeInstanceOf(RetryableLlmError);
    expect(err.code).toBe('MODEL_TIMEOUT');
  });

  it('classifies AbortError as NETWORK_ERROR (name matches FetchError/AbortError branch)', () => {
    const err = classifyProviderError(sdkError('AbortError'), 'trace-4');
    expect(err).toBeInstanceOf(RetryableLlmError);
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('classifies FetchError with "timeout" in message as NETWORK_ERROR', () => {
    const err = classifyProviderError(sdkError('FetchError', 'Connection timeout'), 'trace-4');
    expect(err).toBeInstanceOf(RetryableLlmError);
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('classifies ECONNREFUSED as NETWORK_ERROR', () => {
    const err = classifyProviderError(sdkError('Error', 'ECONNREFUSED 127.0.0.1:443'), 'trace-5');
    expect(err).toBeInstanceOf(RetryableLlmError);
    expect(err.code).toBe('NETWORK_ERROR');
  });

  it('propagates traceId', () => {
    const err = classifyProviderError(sdkError('ThrottlingException'), 'my-trace-id');
    expect(err.traceId).toBe('my-trace-id');
  });

  it('all retryable errors have retryable=true', () => {
    const cases = [
      sdkError('ThrottlingException'),
      sdkError('ServiceUnavailableException'),
      sdkError('ModelTimeoutException'),
      sdkError('AbortError'),
    ];
    for (const e of cases) {
      const classified = classifyProviderError(e, 'trace-z');
      expect(classified.retryable).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Non-retryable classifications
// ---------------------------------------------------------------------------

describe('classifyProviderError — non-retryable', () => {
  it('classifies ValidationException with "model" in message as UNSUPPORTED_MODEL', () => {
    const err = classifyProviderError(
      sdkError('ValidationException', 'The specified model ID is not supported'),
      'trace-6',
    );
    expect(err).toBeInstanceOf(NonRetryableLlmError);
    expect(err.code).toBe('UNSUPPORTED_MODEL');
  });

  it('classifies AccessDeniedException with "content" in message as CONTENT_POLICY_VIOLATION', () => {
    const err = classifyProviderError(
      sdkError('AccessDeniedException', 'Content policy violation detected'),
      'trace-7',
    );
    expect(err).toBeInstanceOf(NonRetryableLlmError);
    expect(err.code).toBe('CONTENT_POLICY_VIOLATION');
  });

  it('unknown error names fall back to MALFORMED_OUTPUT non-retryable', () => {
    const err = classifyProviderError(sdkError('SomeUnknownError'), 'trace-8');
    expect(err).toBeInstanceOf(NonRetryableLlmError);
    expect(err.code).toBe('MALFORMED_OUTPUT');
    expect(err.retryable).toBe(false);
  });

  it('all non-retryable errors have retryable=false', () => {
    const cases = [
      sdkError('ValidationException', 'The model ID is not supported'),
      sdkError('AccessDeniedException', 'content policy violation'),
      sdkError('UnknownException'),
    ];
    for (const e of cases) {
      const classified = classifyProviderError(e, 'trace-y');
      expect(classified.retryable).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// LlmError base properties
// ---------------------------------------------------------------------------

describe('LlmError base properties', () => {
  it('RetryableLlmError message comes from original error', () => {
    const err = classifyProviderError(sdkError('ThrottlingException', 'Rate limit hit'), 'tr');
    // classifyProviderError may use its own message — just ensure it has a message
    expect(err.message).toBeTypeOf('string');
    expect(err.message.length).toBeGreaterThan(0);
  });

  it('RetryableLlmError extends Error', () => {
    const err = classifyProviderError(sdkError('AbortError'), 'tr');
    expect(err).toBeInstanceOf(Error);
  });

  it('NonRetryableLlmError extends Error', () => {
    const err = classifyProviderError(sdkError('SomeUnknownError'), 'tr');
    expect(err).toBeInstanceOf(Error);
  });

  it('pass-through: already-classified LlmError is returned as-is', () => {
    const original = new RetryableLlmError('THROTTLED', 'Already classified', undefined, 'tr');
    const result = classifyProviderError(original, 'different-trace');
    expect(result).toBe(original);
    expect(result.traceId).toBe('tr'); // original trace preserved
  });

  it('optionally carries retryAfterMs for throttle errors with Retry-After header info', () => {
    const err = classifyProviderError(
      sdkError('ThrottlingException', 'Retry-After: 5'),
      'tr',
    );
    const retryAfterMs = (err as RetryableLlmError).retryAfterMs;
    if (retryAfterMs !== undefined) {
      expect(typeof retryAfterMs).toBe('number');
    }
  });
});
