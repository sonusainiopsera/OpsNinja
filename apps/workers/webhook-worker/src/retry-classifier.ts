/**
 * Retry classifier and backoff schedule for webhook deliveries.
 *
 * Backoff delays (seconds): 1, 2, 4, 8, 60, 900
 * Maximum attempts: 6 (after which the message routes to DLQ)
 *
 * Outcome classification:
 *  - delivered (2xx): success — reset consecutive_failures counter
 *  - failed_retryable (timeout, 429, 5xx, connect error): retry with backoff
 *  - failed_permanent (4xx except 408/429): fail immediately, no retry
 *  - dropped (endpoint inactive/deleted): no HTTP request, record and stop
 *  - blocked (SSRF): record and stop
 */

import type { DispatchOutcome } from '@opsninja/webhooks';

export const MAX_ATTEMPTS = 6;

/** Backoff delay in seconds for each attempt index (0-based). */
export const BACKOFF_DELAYS_SECONDS = [1, 2, 4, 8, 60, 900] as const;

export type RetryDecision =
  | { action: 'succeed' }
  | { action: 'retry'; delaySeconds: number; nextAttempt: number }
  | { action: 'dlq'; reason: string }
  | { action: 'drop'; reason: string };

/**
 * Decide what to do after a dispatch attempt.
 *
 * @param outcome - The outcome from dispatchWebhook()
 * @param attempt - Current attempt number (1-based)
 */
export function classifyRetry(outcome: DispatchOutcome, attempt: number): RetryDecision {
  switch (outcome) {
    case 'delivered':
      return { action: 'succeed' };

    case 'blocked':
      return { action: 'drop', reason: 'SSRF_BLOCKED' };

    case 'dropped':
      return { action: 'drop', reason: 'endpoint_inactive' };

    case 'failed_permanent':
      return { action: 'dlq', reason: 'permanent_failure' };

    case 'failed_retryable': {
      if (attempt >= MAX_ATTEMPTS) {
        return { action: 'dlq', reason: 'max_attempts_exceeded' };
      }
      const delaySeconds = BACKOFF_DELAYS_SECONDS[attempt - 1] ?? 900;
      return { action: 'retry', delaySeconds, nextAttempt: attempt + 1 };
    }

    default:
      return { action: 'dlq', reason: 'unknown_outcome' };
  }
}

/** Returns true if the attempt count has been exhausted. */
export function isExhausted(attempt: number): boolean {
  return attempt >= MAX_ATTEMPTS;
}
