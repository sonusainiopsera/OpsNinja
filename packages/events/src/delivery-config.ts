/**
 * Webhook delivery configuration — single source of truth for retry schedule,
 * backoff intervals and signature replay window.
 *
 * These constants are read by:
 *  - apps/workers/webhook-worker (runtime delivery engine)
 *  - docs/scripts/generate-webhook-catalogue.ts (documentation generator)
 *  - test/docs/portal-coverage.spec.ts (parity assertion)
 *
 * Changing a value here must be reflected in operator runbooks.
 */

/** Maximum delivery attempts before routing to the DLQ. */
export const MAX_WEBHOOK_DELIVERY_ATTEMPTS = 6;

/**
 * Per-attempt backoff delay in seconds (0-indexed by attempt number - 1).
 * Attempt 1 → 1s, attempt 2 → 2s, ..., attempt 5 → 60s, attempt 6 → 900s.
 */
export const WEBHOOK_BACKOFF_DELAYS_SECONDS: readonly number[] = [1, 2, 4, 8, 60, 900];

/**
 * Maximum age of a request timestamp accepted during signature verification.
 * Requests older than this window are rejected as replays.
 * Unit: seconds. Default: 300 (5 minutes).
 */
export const SIGNATURE_REPLAY_WINDOW_SECONDS = 300;

/** Consumer-side response timeout in seconds after which the delivery is retried. */
export const WEBHOOK_CONSUMER_TIMEOUT_SECONDS = 30;
