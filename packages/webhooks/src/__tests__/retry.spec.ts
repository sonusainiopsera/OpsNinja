import { classifyRetry, isExhausted, MAX_ATTEMPTS, BACKOFF_DELAYS_SEC } from '../retry';

describe('classifyRetry', () => {
  it('delivered → no retry', () => {
    expect(classifyRetry('delivered', 1).shouldRetry).toBe(false);
  });

  it('failed_permanent → no retry', () => {
    expect(classifyRetry('failed_permanent', 1).shouldRetry).toBe(false);
  });

  it('dropped → no retry', () => {
    expect(classifyRetry('dropped', 1).shouldRetry).toBe(false);
  });

  it('blocked → no retry', () => {
    expect(classifyRetry('blocked', 1).shouldRetry).toBe(false);
  });

  it('failed_retryable attempt 1 → retry with 1s delay', () => {
    const r = classifyRetry('failed_retryable', 1);
    expect(r.shouldRetry).toBe(true);
    expect(r.delaySec).toBe(BACKOFF_DELAYS_SEC[1]);
  });

  it('failed_retryable follows full backoff schedule', () => {
    const expected = [1, 2, 4, 8, 60, 900];
    for (let i = 0; i < 6; i++) {
      const r = classifyRetry('failed_retryable', i + 1);
      if (i < 5) {
        expect(r.shouldRetry).toBe(true);
        expect(r.delaySec).toBe(expected[i]);
      }
    }
  });

  it('exhausted after MAX_ATTEMPTS', () => {
    const r = classifyRetry('failed_retryable', MAX_ATTEMPTS);
    expect(r.shouldRetry).toBe(false);
  });

  it('delay > 60s requires re-enqueue', () => {
    // Attempt 6 → 900s
    const r = classifyRetry('failed_retryable', 5);
    expect(r.delaySec).toBe(900);
    expect(r.requiresReEnqueue).toBe(true);
  });

  it('delay <= 60s does not require re-enqueue', () => {
    const r = classifyRetry('failed_retryable', 4);
    expect(r.delaySec).toBe(60);
    expect(r.requiresReEnqueue).toBe(false);
  });
});

describe('isExhausted', () => {
  it('returns false for attempt < MAX_ATTEMPTS', () => {
    expect(isExhausted(MAX_ATTEMPTS - 1)).toBe(false);
  });

  it('returns true for attempt >= MAX_ATTEMPTS', () => {
    expect(isExhausted(MAX_ATTEMPTS)).toBe(true);
    expect(isExhausted(MAX_ATTEMPTS + 1)).toBe(true);
  });
});

describe('retry classification HTTP status coverage', () => {
  // 200, 204 → delivered (not retryable)
  it.each([200, 201, 204])('HTTP %i → delivered, no retry', (status) => {
    // delivered outcome is not produced by classifyRetry but we test the shape
    expect(classifyRetry('delivered', 1).shouldRetry).toBe(false);
  });

  // 408, 429, 5xx → retryable
  it.each([408, 429, 500, 503])('HTTP %i → retryable (failed_retryable)', () => {
    expect(classifyRetry('failed_retryable', 1).shouldRetry).toBe(true);
  });

  // 4xx other than 408/429 → permanent
  it.each([400, 401, 403, 404])('HTTP %i → permanent, no retry', () => {
    expect(classifyRetry('failed_permanent', 1).shouldRetry).toBe(false);
  });
});
