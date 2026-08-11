/**
 * Retry classifier tests — covers all outcome/attempt combinations.
 *
 * Verifies backoff schedule adherence, DLQ routing after max attempts,
 * and immediate drop/fail-permanent routing.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyRetry,
  isExhausted,
  MAX_ATTEMPTS,
  BACKOFF_DELAYS_SECONDS,
} from './retry-classifier';

describe('classifyRetry — delivered outcome', () => {
  it('returns succeed at attempt 1', () => {
    expect(classifyRetry('delivered', 1)).toEqual({ action: 'succeed' });
  });

  it('returns succeed at max attempt', () => {
    expect(classifyRetry('delivered', MAX_ATTEMPTS)).toEqual({ action: 'succeed' });
  });
});

describe('classifyRetry — failed_retryable outcome', () => {
  it.each([1, 2, 3, 4, 5])('returns retry with correct backoff at attempt %i', (attempt) => {
    const result = classifyRetry('failed_retryable', attempt);
    expect(result.action).toBe('retry');
    if (result.action === 'retry') {
      expect(result.delaySeconds).toBe(BACKOFF_DELAYS_SECONDS[attempt - 1]);
      expect(result.nextAttempt).toBe(attempt + 1);
    }
  });

  it('routes to DLQ at MAX_ATTEMPTS (attempt 6)', () => {
    const result = classifyRetry('failed_retryable', MAX_ATTEMPTS);
    expect(result).toEqual({ action: 'dlq', reason: 'max_attempts_exceeded' });
  });

  it('backoff schedule is [1,2,4,8,60,900]', () => {
    expect([...BACKOFF_DELAYS_SECONDS]).toEqual([1, 2, 4, 8, 60, 900]);
  });
});

describe('classifyRetry — failed_permanent outcome', () => {
  it('routes to DLQ immediately at attempt 1', () => {
    expect(classifyRetry('failed_permanent', 1)).toEqual({ action: 'dlq', reason: 'permanent_failure' });
  });

  it('routes to DLQ even at attempt 6 (no retry attempt)', () => {
    expect(classifyRetry('failed_permanent', 6)).toEqual({ action: 'dlq', reason: 'permanent_failure' });
  });
});

describe('classifyRetry — blocked (SSRF)', () => {
  it('drops with SSRF_BLOCKED reason at attempt 1', () => {
    expect(classifyRetry('blocked', 1)).toEqual({ action: 'drop', reason: 'SSRF_BLOCKED' });
  });

  it('drops regardless of attempt count', () => {
    expect(classifyRetry('blocked', 6)).toEqual({ action: 'drop', reason: 'SSRF_BLOCKED' });
  });
});

describe('classifyRetry — dropped (endpoint inactive)', () => {
  it('drops with endpoint_inactive reason', () => {
    expect(classifyRetry('dropped', 1)).toEqual({ action: 'drop', reason: 'endpoint_inactive' });
  });
});

describe('isExhausted', () => {
  it('returns false for attempt < MAX_ATTEMPTS', () => {
    expect(isExhausted(MAX_ATTEMPTS - 1)).toBe(false);
  });

  it('returns true at exactly MAX_ATTEMPTS', () => {
    expect(isExhausted(MAX_ATTEMPTS)).toBe(true);
  });

  it('returns true beyond MAX_ATTEMPTS', () => {
    expect(isExhausted(MAX_ATTEMPTS + 1)).toBe(true);
  });
});

describe('MAX_ATTEMPTS constant', () => {
  it('is 6', () => {
    expect(MAX_ATTEMPTS).toBe(6);
  });
});
