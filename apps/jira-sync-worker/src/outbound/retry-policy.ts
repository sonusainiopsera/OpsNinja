/**
 * retry-policy.ts — fixed exponential backoff schedule for outbound Jira sync.
 *
 * Pure functions — no I/O, no framework dependencies.
 *
 * Backoff schedule (six attempts, 0-indexed):
 *   attempt 0 → 1 s
 *   attempt 1 → 2 s
 *   attempt 2 → 4 s
 *   attempt 3 → 8 s
 *   attempt 4 → 60 s
 *   attempt 5 → 900 s (15 min)
 *
 * After attempt 5 (the 6th delivery) the message is dead-lettered.
 * Backoff is enforced via SQS visibility timeout extension, not by sleeping.
 *
 * When Jira returns a 429 with Retry-After the caller may pass the override
 * delay and it takes precedence over the schedule for that attempt.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of attempts before declaring the item dead. */
export const MAX_ATTEMPTS = 6;

/** Fixed delay schedule in seconds, indexed by attempt number (0-based). */
export const BACKOFF_SECONDS: readonly number[] = [1, 2, 4, 8, 60, 900];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RetryDecision {
  /** Whether the message should be retried. */
  shouldRetry: boolean;
  /**
   * How long to hide the SQS message before it becomes visible again
   * (i.e. the SQS VisibilityTimeout extension, in seconds).
   * Only meaningful when shouldRetry is true.
   */
  delaySeconds: number;
  /** True when this is the last attempt — after this we dead-letter. */
  isFinalAttempt: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the retry decision for attempt `attemptNumber` (0-based).
 *
 * @param attemptNumber  Zero-based attempt count (0 = first delivery).
 * @param retryAfterSeconds  Optional override from Jira's Retry-After header;
 *                           takes precedence over the built-in schedule.
 */
export function getRetryDecision(
  attemptNumber: number,
  retryAfterSeconds?: number,
): RetryDecision {
  const isFinalAttempt = attemptNumber >= MAX_ATTEMPTS - 1;

  if (isFinalAttempt) {
    return { shouldRetry: false, delaySeconds: 0, isFinalAttempt: true };
  }

  const scheduledDelay = BACKOFF_SECONDS[attemptNumber] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]!;
  const delaySeconds = retryAfterSeconds != null && retryAfterSeconds > 0
    ? Math.max(retryAfterSeconds, scheduledDelay)
    : scheduledDelay;

  return { shouldRetry: true, delaySeconds, isFinalAttempt: false };
}

/**
 * Add random jitter (±25% of the base delay) to avoid thundering-herd when
 * many messages retry simultaneously after a rate-limit window.
 */
export function withJitter(delaySeconds: number): number {
  const jitter = (Math.random() - 0.5) * 0.5 * delaySeconds;
  return Math.max(1, Math.round(delaySeconds + jitter));
}
