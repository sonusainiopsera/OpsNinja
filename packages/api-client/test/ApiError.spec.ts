import { describe, it, expect } from 'vitest';
import { ApiError, EXPIRED_TOKEN_CODES, SCOPE_CHANGED_CODES, isApiError } from '../src/errors/ApiError';

function makeError(overrides: Partial<Parameters<typeof ApiError.prototype.constructor>[0]> & { status: number; code: string }) {
  return new ApiError({
    status: overrides.status,
    code: overrides.code,
    message: overrides.message ?? 'test error',
    details: overrides.details ?? [],
    traceId: overrides.traceId ?? 'trace-test',
    retryAfterMs: overrides.retryAfterMs,
    currentVersion: overrides.currentVersion,
  });
}

describe('ApiError type guards', () => {
  it('isValidationError: true for 400', () => {
    expect(makeError({ status: 400, code: 'VALIDATION_ERROR' }).isValidationError()).toBe(true);
  });

  it('isUnauthenticated: true for 401', () => {
    expect(makeError({ status: 401, code: 'UNAUTHENTICATED' }).isUnauthenticated()).toBe(true);
  });

  it('isExpiredToken: true for AUTH_TOKEN_EXPIRED', () => {
    expect(makeError({ status: 401, code: 'AUTH_TOKEN_EXPIRED' }).isExpiredToken()).toBe(true);
  });

  it('isExpiredToken: false for scope-changed code', () => {
    expect(makeError({ status: 401, code: 'AUTH_REAUTHORIZE_REQUIRED' }).isExpiredToken()).toBe(false);
  });

  it('isScopeChanged: true for AUTH_REAUTHORIZE_REQUIRED', () => {
    expect(makeError({ status: 401, code: 'AUTH_REAUTHORIZE_REQUIRED' }).isScopeChanged()).toBe(true);
  });

  it('isScopeChanged: false for expired token code', () => {
    expect(makeError({ status: 401, code: 'AUTH_TOKEN_EXPIRED' }).isScopeChanged()).toBe(false);
  });

  it('isForbidden: true for 403', () => {
    expect(makeError({ status: 403, code: 'FORBIDDEN' }).isForbidden()).toBe(true);
  });

  it('isNotFound: true for 404', () => {
    expect(makeError({ status: 404, code: 'NOT_FOUND' }).isNotFound()).toBe(true);
  });

  it('isConflict: true for 409', () => {
    expect(makeError({ status: 409, code: 'CONFLICT' }).isConflict()).toBe(true);
  });

  it('isBusinessRule: true for 422', () => {
    expect(makeError({ status: 422, code: 'BUSINESS_RULE' }).isBusinessRule()).toBe(true);
  });

  it('isRateLimited: true for 429', () => {
    expect(makeError({ status: 429, code: 'RATE_LIMITED' }).isRateLimited()).toBe(true);
  });

  it('isServerError: true for 500', () => {
    expect(makeError({ status: 500, code: 'SERVER_ERROR' }).isServerError()).toBe(true);
  });

  it('isServerError: false for 429', () => {
    expect(makeError({ status: 429, code: 'RATE_LIMITED' }).isServerError()).toBe(false);
  });

  it('carries traceId', () => {
    const err = makeError({ status: 400, code: 'X', traceId: 'my-trace' });
    expect(err.traceId).toBe('my-trace');
  });

  it('carries retryAfterMs', () => {
    const err = makeError({ status: 429, code: 'RATE_LIMITED', retryAfterMs: 5000 });
    expect(err.retryAfterMs).toBe(5000);
  });

  it('carries currentVersion for 409', () => {
    const err = makeError({ status: 409, code: 'CONFLICT', currentVersion: 'v5' });
    expect(err.currentVersion).toBe('v5');
  });

  it('isApiError: true for ApiError instance', () => {
    expect(isApiError(makeError({ status: 400, code: 'X' }))).toBe(true);
  });

  it('isApiError: false for plain Error', () => {
    expect(isApiError(new Error('oops'))).toBe(false);
  });

  it('isApiError: false for null', () => {
    expect(isApiError(null)).toBe(false);
  });

  it('maintains prototype chain after transpilation', () => {
    const err = makeError({ status: 400, code: 'X' });
    expect(err instanceof ApiError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('EXPIRED_TOKEN_CODES contains expected codes', () => {
    expect(EXPIRED_TOKEN_CODES.has('AUTH_TOKEN_EXPIRED')).toBe(true);
  });

  it('SCOPE_CHANGED_CODES contains AUTH_REAUTHORIZE_REQUIRED', () => {
    expect(SCOPE_CHANGED_CODES.has('AUTH_REAUTHORIZE_REQUIRED')).toBe(true);
  });
});
