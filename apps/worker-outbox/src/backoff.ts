/**
 * Exponential backoff scheduling for the outbox drain loop.
 *
 * Backoff ladder (seconds): 1, 2, 4, 8, 60, 900
 * After 6 failed attempts the row transitions to dead_letter.
 *
 * Design: the ladder is short at the start to recover from transient
 * network blips quickly, then escalates to 15 minutes for persistent
 * failures to avoid burning connection pool capacity on a stuck bus.
 */

/** Backoff ladder in seconds. Index = attempt number (0-based). */
export const BACKOFF_SECONDS = [1, 2, 4, 8, 60, 900] as const;

/** Maximum attempts before transitioning to dead_letter. */
export const MAX_ATTEMPTS = BACKOFF_SECONDS.length;

/**
 * Returns the Date at which the next delivery attempt should be made,
 * given the number of previous failed attempts.
 *
 * @param attempts - Number of failed attempts so far (0-based).
 * @param now      - Current timestamp (injectable for test predictability).
 */
export function nextAttemptAt(attempts: number, now: Date = new Date()): Date {
  const secondsIndex = Math.min(attempts, BACKOFF_SECONDS.length - 1);
  const seconds = BACKOFF_SECONDS[secondsIndex] ?? 900;
  return new Date(now.getTime() + seconds * 1_000);
}

/**
 * Returns true if the row should be transitioned to dead_letter status.
 */
export function shouldDeadLetter(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

/**
 * Returns the backoff delay in milliseconds for the given attempt count.
 * Useful for logging and metrics.
 */
export function backoffMs(attempts: number): number {
  const secondsIndex = Math.min(attempts, BACKOFF_SECONDS.length - 1);
  const seconds = BACKOFF_SECONDS[secondsIndex] ?? 900;
  return seconds * 1_000;
}
