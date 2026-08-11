import { describe, it, expect } from 'vitest';
import {
  ApiError,
  isApiError,
  isValidationError,
  isUnauthenticated,
  isForbidden,
  isNotFound,
  isConflict,
  isBusinessRule,
  isRateLimited,
  isTransportError,
} from '../../src/errors/ApiError';

describe('ApiError', () => {
  it('extends Error with correct name', () => {
    const err = new ApiError({ status: 400, code: 'TEST', message: 'test' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('test');
  });

  it('stores all fields', () => {
    const err = new ApiError({
      status: 429,
      code: 'AUTH_RATE_LIMITED',
      message: 'Rate limited',
      details: [{ field: 'email', message: 'invalid' }],
      traceId: 'trace123',
      retryAfterMs: 5000,
    });
    expect(err.status).toBe(429);
    expect(err.code).toBe('AUTH_RATE_LIMITED');
    expect(err.details).toHaveLength(1);
    expect(err.traceId).toBe('trace123');
    expect(err.retryAfterMs).toBe(5000);
  });

  it('defaults details to [] and traceId to empty string', () => {
    const err = new ApiError({ status: 500, code: 'X', message: 'Y' });
    expect(err.details).toEqual([]);
    expect(err.traceId).toBe('');
  });

  it('isApiError type guard', () => {
    expect(isApiError(new ApiError({ status: 400, code: 'X', message: 'Y' }))).toBe(true);
    expect(isApiError(new Error('plain'))).toBe(false);
    expect(isApiError(null)).toBe(false);
    expect(isApiError('string')).toBe(false);
  });
});

describe('Status type-guards', () => {
  const make = (status: number) => new ApiError({ status, code: 'X', message: 'Y' });

  it('isValidationError for 400', () => {
    expect(isValidationError(make(400))).toBe(true);
    expect(isValidationError(make(422))).toBe(false);
  });

  it('isUnauthenticated for 401', () => {
    expect(isUnauthenticated(make(401))).toBe(true);
    expect(isUnauthenticated(make(403))).toBe(false);
  });

  it('isForbidden for 403', () => {
    expect(isForbidden(make(403))).toBe(true);
    expect(isForbidden(make(401))).toBe(false);
  });

  it('isNotFound for 404', () => {
    expect(isNotFound(make(404))).toBe(true);
    expect(isNotFound(make(403))).toBe(false);
  });

  it('isConflict for 409', () => {
    expect(isConflict(make(409))).toBe(true);
    expect(isConflict(make(422))).toBe(false);
  });

  it('isBusinessRule for 422', () => {
    expect(isBusinessRule(make(422))).toBe(true);
    expect(isBusinessRule(make(409))).toBe(false);
  });

  it('isRateLimited for 429', () => {
    expect(isRateLimited(make(429))).toBe(true);
    expect(isRateLimited(make(500))).toBe(false);
  });

  it('isTransportError for 0', () => {
    expect(isTransportError(make(0))).toBe(true);
    expect(isTransportError(make(500))).toBe(false);
  });
});
