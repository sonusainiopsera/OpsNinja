/**
 * retry.ts – Retry classification and backoff schedule for webhook delivery.
 *
 * Backoff schedule (attempt 1 = first retry after initial failure):
 *   Attempt 1 → 1 s
 *   Attempt 2 → 2 s
 *   Attempt 3 → 4 s
 *   Attempt 4 → 8 s
 *   Attempt 5 → 60 s
 *   Attempt 6 → 900 s  (15 min, re-enqueue as delayed message)
 *   Attempt 7+ → exhaust → DLQ
 */

import type { DeliveryOutcome } from './webhook-dispatcher';

export const MAX_ATTEMPTS = 6;

/** Backoff delays in seconds indexed by attempt number (1-based). */
export const BACKOFF_DELAYS_SEC: Readonly<number[]> = [0, 1, 2, 4, 8, 60, 900];

/** Delay (seconds) that exceeds SQS max visibility timeout (43200 s). Use re-enqueue. */
export const LONG_DELAY_THRESHOLD_SEC = 60;

export interface RetryDecision {
  shouldRetry: boolean;
  /** Delay in seconds before the next attempt. */
  delaySec: number;
  /** Whether the delay exceeds SQS visibility limit and needs re-enqueue. */
  requiresReEnqueue: boolean;
}

/**
 * Classifies an outcome and returns the retry decision for this attempt.
 *
 * @param outcome   The classified delivery outcome.
 * @param attempt   Current attempt number (1-based; first delivery = 1).
 */
export function classifyRetry(outcome: DeliveryOutcome, attempt: number): RetryDecision {
  if (outcome === 'delivered' || outcome === 'failed_permanent' || outcome === 'blocked' || outcome === 'dropped') {
    return { shouldRetry: false, delaySec: 0, requiresReEnqueue: false };
  }

  // failed_retryable
  if (attempt >= MAX_ATTEMPTS) {
    return { shouldRetry: false, delaySec: 0, requiresReEnqueue: false };
  }

  const delaySec = BACKOFF_DELAYS_SEC[attempt] ?? BACKOFF_DELAYS_SEC[BACKOFF_DELAYS_SEC.length - 1];
  return {
    shouldRetry: true,
    delaySec,
    requiresReEnqueue: delaySec > LONG_DELAY_THRESHOLD_SEC,
  };
}

/**
 * Returns true if the attempt number has been exhausted (no more retries).
 */
export function isExhausted(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS;
}
