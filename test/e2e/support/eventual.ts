/**
 * eventual — state-based polling utility.
 *
 * Replaces all fixed sleeps in the E2E suite.  Polls a condition with
 * exponential back-off and fails with a descriptive message naming exactly
 * which condition never became true and for how long it was awaited.
 *
 * No test may use page.waitForTimeout() or setTimeout() as a sync
 * mechanism — this file is the sole waiting primitive.
 *
 * Usage:
 *   await eventually(
 *     () => api.get(`/api/v1/tickets/${id}`).then(r => r.status === 200),
 *     { description: `ticket ${id} visible in API`, timeoutMs: 10_000 }
 *   );
 *
 *   const ticket = await eventualValue(
 *     () => api.getJson(`/api/v1/tickets/${id}`),
 *     (t) => t.status === 'open',
 *     { description: 'ticket status becomes open', timeoutMs: 15_000 }
 *   );
 */

export interface EventualOptions {
  /** Human-readable name of the awaited condition (shown on failure). */
  description: string;
  /** Max ms to wait before throwing (default: 15_000). */
  timeoutMs?: number;
  /** Initial poll interval in ms (default: 200). */
  initialIntervalMs?: number;
  /** Back-off multiplier per failed attempt (default: 1.5). */
  backoffFactor?: number;
  /** Maximum poll interval ms (default: 2_000). */
  maxIntervalMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `condition` until it returns `true`.
 * Throws with a descriptive message if the timeout expires.
 */
export async function eventually(
  condition: () => Promise<boolean> | boolean,
  opts: EventualOptions,
): Promise<void> {
  const timeout = opts.timeoutMs ?? 15_000;
  const initial = opts.initialIntervalMs ?? 200;
  const factor = opts.backoffFactor ?? 1.5;
  const maxInterval = opts.maxIntervalMs ?? 2_000;

  const deadline = Date.now() + timeout;
  let interval = initial;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const result = await condition();
      if (result) return;
    } catch (err) {
      lastError = err;
    }
    await sleep(Math.min(interval, deadline - Date.now(), maxInterval));
    interval = Math.min(interval * factor, maxInterval);
  }

  const elapsed = timeout;
  const cause = lastError ? `\nLast error: ${String(lastError)}` : '';
  throw new Error(
    `Timed out after ${elapsed}ms waiting for: "${opts.description}"${cause}`,
  );
}

/**
 * Poll `supplier` until `predicate(value)` is true, then return the value.
 * Throws with a descriptive message if the timeout expires.
 */
export async function eventualValue<T>(
  supplier: () => Promise<T>,
  predicate: (value: T) => boolean,
  opts: EventualOptions,
): Promise<T> {
  const timeout = opts.timeoutMs ?? 15_000;
  const initial = opts.initialIntervalMs ?? 200;
  const factor = opts.backoffFactor ?? 1.5;
  const maxInterval = opts.maxIntervalMs ?? 2_000;

  const deadline = Date.now() + timeout;
  let interval = initial;
  let lastValue: T | undefined;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const value = await supplier();
      lastValue = value;
      if (predicate(value)) return value;
    } catch (err) {
      lastError = err;
    }
    await sleep(Math.min(interval, deadline - Date.now(), maxInterval));
    interval = Math.min(interval * factor, maxInterval);
  }

  const cause = lastError
    ? `\nLast error: ${String(lastError)}`
    : lastValue !== undefined
      ? `\nLast observed value: ${JSON.stringify(lastValue)}`
      : '';
  throw new Error(
    `Timed out after ${timeout}ms waiting for: "${opts.description}"${cause}`,
  );
}

/**
 * Compute the expected queue contents for a saved-view assertion.
 * Given an array of tickets and a filter predicate, returns the matching set
 * of ticket IDs — used to compare against the UI-rendered queue rows.
 */
export function computeExpectedQueue<T extends { id: string }>(
  allTickets: T[],
  predicate: (ticket: T) => boolean,
): Set<string> {
  return new Set(allTickets.filter(predicate).map((t) => t.id));
}
