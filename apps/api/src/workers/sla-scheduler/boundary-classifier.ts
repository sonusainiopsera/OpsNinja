/**
 * BoundaryClassifier — pure domain function for SLA scheduler (WO-046).
 *
 * Given a timer row plus policy thresholds and an injectable clock, returns the
 * ordered list of boundaries that are NOW DUE (not yet fired).
 *
 * Boundaries (in chronological order):
 *   reminder_first   — elapsed ≥ reminderPctFirst  % of total span
 *   reminder_second  — elapsed ≥ reminderPctSecond % of total span
 *   breach           — elapsed ≥ 100 % (i.e. now >= targetAt)
 *
 * Rules:
 * 1. Only 'running' timers are eligible; paused/met/breached/cancelled are no-ops.
 * 2. elapsed percentage accounts for accumulated paused_ms so a paused period
 *    does not count against the SLA.
 * 3. All boundaries that are now due but have not yet been fired are returned in
 *    order — this handles the catch-up case (worker was down for > one tick).
 * 4. A boundary that already has a row in firedBoundaries is skipped (idempotent).
 *
 * This function is framework-free and has no side effects: it is safe to unit-test
 * with an arbitrary injectable clock.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlaTimerState = 'running' | 'paused' | 'met' | 'breached' | 'cancelled';

export type SlaBoundary = 'reminder_first' | 'reminder_second' | 'breach';

/** Minimal shape needed from the DB sla_timers row. */
export interface ClaimableTimer {
  id: string;
  tenantId: string;
  ticketId: string;
  slaPolicyId: string;
  clockType: string;
  state: SlaTimerState;
  /** Accumulated milliseconds during which the clock was paused. */
  pausedMs: number;
  startedAt: Date;
  targetAt: Date;
  nextFireAt: Date | null;
}

/** Policy thresholds needed for classification. */
export interface PolicyThresholds {
  reminderPctFirst: number;   // e.g. 50 = 50%
  reminderPctSecond: number;  // e.g. 75 = 75%
}

/** Injectable clock — returns the current UTC instant. */
export type Clock = () => Date;

/** Classification result for a single timer. */
export interface ClassificationResult {
  timerId: string;
  tenantId: string;
  /** Boundaries that are due and not yet fired, in chronological order. */
  dueBoundaries: SlaBoundary[];
  /** The next next_fire_at to set after processing, or null when breached. */
  nextFireAt: Date | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ordered list of all boundaries — classification always processes in this order. */
const ORDERED_BOUNDARIES: SlaBoundary[] = [
  'reminder_first',
  'reminder_second',
  'breach',
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Compute the UTC instant at which a given percentage of the SLA span is reached,
 * accounting for accumulated paused milliseconds.
 *
 * Effective elapsed is:
 *   elapsed_ms = now_ms - started_at_ms - paused_ms
 *
 * A boundary fires when:
 *   elapsed_ms >= total_span_ms * pct / 100
 *
 * Solving for the instant:
 *   fire_at = started_at + paused_ms + total_span_ms * pct / 100
 */
function boundaryInstant(
  startedAt: Date,
  targetAt: Date,
  pausedMs: number,
  pct: number,
): Date {
  const totalSpanMs = targetAt.getTime() - startedAt.getTime();
  const offsetMs = Math.floor(totalSpanMs * (pct / 100));
  // Add paused_ms so the clock "doesn't count" paused time.
  return new Date(startedAt.getTime() + pausedMs + offsetMs);
}

/**
 * Map a boundary to its threshold percentage.
 */
function boundaryPct(
  boundary: SlaBoundary,
  thresholds: PolicyThresholds,
): number {
  switch (boundary) {
    case 'reminder_first':  return thresholds.reminderPctFirst;
    case 'reminder_second': return thresholds.reminderPctSecond;
    case 'breach':          return 100;
  }
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Classify which boundaries are now due for a single timer.
 *
 * @param timer         Timer row from the claim batch.
 * @param thresholds    Policy thresholds snapshot for this timer.
 * @param firedBoundaries  Set of boundary names already in sla_fired_boundaries.
 * @param clock         Injectable clock (defaults to Date.now).
 */
export function classifyDueBoundaries(
  timer: ClaimableTimer,
  thresholds: PolicyThresholds,
  firedBoundaries: ReadonlySet<SlaBoundary>,
  clock: Clock = () => new Date(),
): ClassificationResult {
  // Paused / terminal timers are never eligible.
  if (timer.state !== 'running') {
    return { timerId: timer.id, tenantId: timer.tenantId, dueBoundaries: [], nextFireAt: null };
  }

  const now = clock();
  const dueBoundaries: SlaBoundary[] = [];

  for (const boundary of ORDERED_BOUNDARIES) {
    // Already fired — skip.
    if (firedBoundaries.has(boundary)) continue;

    const pct = boundaryPct(boundary, thresholds);
    const fireAt = boundaryInstant(timer.startedAt, timer.targetAt, timer.pausedMs, pct);

    if (now >= fireAt) {
      dueBoundaries.push(boundary);
    }
  }

  // Compute next_fire_at: the earliest unfired boundary instant in the future.
  const nextFireAt = computeNextFireAt(timer, thresholds, firedBoundaries, dueBoundaries, clock);

  return { timerId: timer.id, tenantId: timer.tenantId, dueBoundaries, nextFireAt };
}

/**
 * Compute the next_fire_at value after processing dueBoundaries.
 *
 * - If breach is in dueBoundaries → null (timer is done).
 * - Otherwise → earliest instant of the remaining unfired boundaries.
 * - If no remaining boundaries → null.
 */
function computeNextFireAt(
  timer: ClaimableTimer,
  thresholds: PolicyThresholds,
  firedBoundaries: ReadonlySet<SlaBoundary>,
  justFired: SlaBoundary[],
  clock: Clock,
): Date | null {
  if (justFired.includes('breach')) return null;

  const nowFired = new Set([...firedBoundaries, ...justFired]);
  const remaining = ORDERED_BOUNDARIES.filter((b) => !nowFired.has(b));

  if (remaining.length === 0) return null;

  const instants = remaining.map((b) =>
    boundaryInstant(timer.startedAt, timer.targetAt, timer.pausedMs, boundaryPct(b, thresholds)),
  );

  return new Date(Math.min(...instants.map((d) => d.getTime())));
}

// ---------------------------------------------------------------------------
// Advancement helper (exported for direct unit testing)
// ---------------------------------------------------------------------------

/**
 * Determine the new timer state after processing the given boundaries.
 * - 'breach' → 'breached'
 * - otherwise → 'running'
 */
export function advanceTimerState(
  dueBoundaries: SlaBoundary[],
): SlaTimerState {
  if (dueBoundaries.includes('breach')) return 'breached';
  return 'running';
}

/**
 * Compute the lag in seconds: the age of the oldest overdue next_fire_at.
 *
 * Used for the sla_scheduler_lag_seconds metric.
 *
 * @param oldestNextFireAt  The earliest next_fire_at in the pending batch, or
 *                          null when there are no due timers.
 * @param clock             Injectable clock.
 */
export function computeLagSeconds(
  oldestNextFireAt: Date | null,
  clock: Clock = () => new Date(),
): number {
  if (!oldestNextFireAt) return 0;
  const lagMs = clock().getTime() - oldestNextFireAt.getTime();
  return Math.max(0, lagMs / 1000);
}
