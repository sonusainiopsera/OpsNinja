/**
 * Unit tests for BoundaryClassifier — WO-046 AC11.
 *
 * All tests use an injectable clock so no real time passes and the suite is
 * deterministic across machines. No sleeping.
 *
 * Covers:
 *  1. Basic classification: each boundary fires at the correct percentage.
 *  2. Missed-boundary catch-up: worker was down; both reminders fire at once.
 *  3. Same-tick double boundary: two thresholds fall within the same 15 s window.
 *  4. Paused-ms accounting: paused time does not count against SLA.
 *  5. Idempotent skip: already-fired boundaries are not returned again.
 *  6. Non-running timers are no-ops.
 *  7. next_fire_at advancement after each boundary.
 *  8. advanceTimerState and computeLagSeconds helpers.
 *  9. Terminal state transitions.
 */

import {
  classifyDueBoundaries,
  advanceTimerState,
  computeLagSeconds,
  type ClaimableTimer,
  type SlaBoundary,
} from './boundary-classifier';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_A = 'f0000001-0000-0000-0000-000000000001';

/** Build a base running timer with 4-hour SLA. */
function makeTimer(overrides: Partial<ClaimableTimer> = {}): ClaimableTimer {
  const startedAt = new Date('2026-08-11T10:00:00.000Z');
  const targetAt  = new Date('2026-08-11T14:00:00.000Z'); // +4 h
  return {
    id: 'timer-001',
    tenantId: TENANT_A,
    ticketId: 'ticket-001',
    slaPolicyId: 'policy-001',
    clockType: 'response',
    state: 'running',
    pausedMs: 0,
    startedAt,
    targetAt,
    nextFireAt: startedAt,
    ...overrides,
  };
}

const DEFAULT_THRESHOLDS = {
  reminderPctFirst: 50,   // 2 h in = 2026-08-11T12:00:00Z
  reminderPctSecond: 75,  // 3 h in = 2026-08-11T13:00:00Z
};

const NO_FIRED: ReadonlySet<SlaBoundary> = new Set();

// ---------------------------------------------------------------------------
// 1. Basic boundary classification
// ---------------------------------------------------------------------------

describe('classifyDueBoundaries — basic', () => {
  const timer = makeTimer();

  it('nothing due before first reminder', () => {
    // clock = 11:59:59 — just before 50% (12:00:00)
    const clock = () => new Date('2026-08-11T11:59:59.000Z');
    const result = classifyDueBoundaries(timer, DEFAULT_THRESHOLDS, NO_FIRED, clock);
    expect(result.dueBoundaries).toHaveLength(0);
  });

  it('reminder_first fires at exactly 50%', () => {
    const clock = () => new Date('2026-08-11T12:00:00.000Z');
    const result = classifyDueBoundaries(timer, DEFAULT_THRESHOLDS, NO_FIRED, clock);
    expect(result.dueBoundaries).toEqual(['reminder_first']);
  });

  it('reminder_second fires at exactly 75%', () => {
    const clock = () => new Date('2026-08-11T13:00:00.000Z');
    const result = classifyDueBoundaries(timer, DEFAULT_THRESHOLDS, new Set(['reminder_first']), clock);
    expect(result.dueBoundaries).toEqual(['reminder_second']);
  });

  it('breach fires at 100%', () => {
    const clock = () => new Date('2026-08-11T14:00:00.000Z');
    const result = classifyDueBoundaries(
      timer,
      DEFAULT_THRESHOLDS,
      new Set(['reminder_first', 'reminder_second']),
      clock,
    );
    expect(result.dueBoundaries).toEqual(['breach']);
  });
});

// ---------------------------------------------------------------------------
// 2. Missed-boundary catch-up
// ---------------------------------------------------------------------------

describe('classifyDueBoundaries — catch-up after worker down', () => {
  it('returns all three boundaries when clock is past target_at and none fired', () => {
    const timer = makeTimer();
    // Worker was down — now is 30 minutes PAST target_at
    const clock = () => new Date('2026-08-11T14:30:00.000Z');
    const result = classifyDueBoundaries(timer, DEFAULT_THRESHOLDS, NO_FIRED, clock);
    expect(result.dueBoundaries).toEqual(['reminder_first', 'reminder_second', 'breach']);
  });

  it('catch-up: only fires unfired boundaries', () => {
    const timer = makeTimer();
    // reminder_first already fired; worker missed reminder_second and breach
    const clock = () => new Date('2026-08-11T14:30:00.000Z');
    const result = classifyDueBoundaries(
      timer,
      DEFAULT_THRESHOLDS,
      new Set(['reminder_first']),
      clock,
    );
    expect(result.dueBoundaries).toEqual(['reminder_second', 'breach']);
  });
});

// ---------------------------------------------------------------------------
// 3. Same-tick double boundary
// ---------------------------------------------------------------------------

describe('classifyDueBoundaries — two thresholds in same tick', () => {
  it('fires both reminder_first and reminder_second when very close together', () => {
    // 60-minute SLA: 50% = 30 min, 75% = 45 min. Clock = 50 min in.
    const startedAt = new Date('2026-08-11T10:00:00.000Z');
    const targetAt  = new Date('2026-08-11T11:00:00.000Z'); // +1 h
    const timer = makeTimer({ startedAt, targetAt });
    // Tick fires at 50 min — both 50% (30 min) and 75% (45 min) are due.
    const clock = () => new Date('2026-08-11T10:50:00.000Z');
    const result = classifyDueBoundaries(timer, DEFAULT_THRESHOLDS, NO_FIRED, clock);
    expect(result.dueBoundaries).toContain('reminder_first');
    expect(result.dueBoundaries).toContain('reminder_second');
    expect(result.dueBoundaries).not.toContain('breach');
    // Order: reminder_first before reminder_second
    expect(result.dueBoundaries.indexOf('reminder_first'))
      .toBeLessThan(result.dueBoundaries.indexOf('reminder_second'));
  });
});

// ---------------------------------------------------------------------------
// 4. paused_ms accounting
// ---------------------------------------------------------------------------

describe('classifyDueBoundaries — paused_ms', () => {
  it('paused time pushes the boundary instants forward', () => {
    // Timer with 1 hour (3600000 ms) of accumulated pause.
    // Without pause: 50% = 12:00:00. With pause: 50% = 13:00:00.
    const timer = makeTimer({ pausedMs: 3_600_000 });

    // Clock at 12:30:00 — would be past 50% without pause, but not with it.
    const clockBefore = () => new Date('2026-08-11T12:30:00.000Z');
    const before = classifyDueBoundaries(timer, DEFAULT_THRESHOLDS, NO_FIRED, clockBefore);
    expect(before.dueBoundaries).toHaveLength(0);

    // Clock at 13:00:00 — exactly at 50% with pause.
    const clockAt = () => new Date('2026-08-11T13:00:00.000Z');
    const at = classifyDueBoundaries(timer, DEFAULT_THRESHOLDS, NO_FIRED, clockAt);
    expect(at.dueBoundaries).toContain('reminder_first');
  });
});

// ---------------------------------------------------------------------------
// 5. Idempotent skip of already-fired boundaries
// ---------------------------------------------------------------------------

describe('classifyDueBoundaries — idempotency', () => {
  it('does not re-fire boundaries already in firedBoundaries set', () => {
    const timer = makeTimer();
    const clock = () => new Date('2026-08-11T14:30:00.000Z'); // past everything
    const allFired: ReadonlySet<SlaBoundary> = new Set([
      'reminder_first', 'reminder_second', 'breach',
    ]);
    const result = classifyDueBoundaries(timer, DEFAULT_THRESHOLDS, allFired, clock);
    expect(result.dueBoundaries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Non-running timers are no-ops
// ---------------------------------------------------------------------------

describe('classifyDueBoundaries — non-running timers', () => {
  const nonRunningStates = ['paused', 'met', 'breached', 'cancelled'] as const;

  it.each(nonRunningStates)('state=%s returns empty dueBoundaries', (state) => {
    const timer = makeTimer({ state });
    const clock = () => new Date('2026-08-11T14:30:00.000Z');
    const result = classifyDueBoundaries(timer, DEFAULT_THRESHOLDS, NO_FIRED, clock);
    expect(result.dueBoundaries).toHaveLength(0);
    expect(result.nextFireAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. next_fire_at advancement
// ---------------------------------------------------------------------------

describe('classifyDueBoundaries — nextFireAt advancement', () => {
  const timer = makeTimer();

  it('after firing reminder_first, nextFireAt points to reminder_second instant', () => {
    const clock = () => new Date('2026-08-11T12:00:00.000Z');
    const result = classifyDueBoundaries(timer, DEFAULT_THRESHOLDS, NO_FIRED, clock);
    // reminder_second is at 75% = 13:00:00
    expect(result.nextFireAt?.toISOString()).toBe('2026-08-11T13:00:00.000Z');
  });

  it('after firing reminder_second, nextFireAt points to target_at', () => {
    const clock = () => new Date('2026-08-11T13:00:00.000Z');
    const result = classifyDueBoundaries(
      timer,
      DEFAULT_THRESHOLDS,
      new Set(['reminder_first']),
      clock,
    );
    expect(result.nextFireAt?.toISOString()).toBe('2026-08-11T14:00:00.000Z');
  });

  it('after breach, nextFireAt is null', () => {
    const clock = () => new Date('2026-08-11T14:00:00.000Z');
    const result = classifyDueBoundaries(
      timer,
      DEFAULT_THRESHOLDS,
      new Set(['reminder_first', 'reminder_second']),
      clock,
    );
    expect(result.nextFireAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. advanceTimerState and computeLagSeconds
// ---------------------------------------------------------------------------

describe('advanceTimerState', () => {
  it('returns breached when breach is in dueBoundaries', () => {
    expect(advanceTimerState(['reminder_first', 'breach'])).toBe('breached');
  });

  it('returns running when only reminders fire', () => {
    expect(advanceTimerState(['reminder_first', 'reminder_second'])).toBe('running');
  });

  it('returns running for empty array', () => {
    expect(advanceTimerState([])).toBe('running');
  });
});

describe('computeLagSeconds', () => {
  it('returns 0 when no overdue timers', () => {
    expect(computeLagSeconds(null)).toBe(0);
  });

  it('returns correct lag for a 30-second-old timer', () => {
    const fireAt = new Date('2026-08-11T12:00:00.000Z');
    const clock  = () => new Date('2026-08-11T12:00:30.000Z');
    expect(computeLagSeconds(fireAt, clock)).toBe(30);
  });

  it('returns 0 when next_fire_at is in the future (no lag)', () => {
    const fireAt = new Date('2026-08-11T12:01:00.000Z');
    const clock  = () => new Date('2026-08-11T12:00:00.000Z');
    expect(computeLagSeconds(fireAt, clock)).toBe(0);
  });

  it('returns large lag for a timer that has been waiting 2 minutes', () => {
    const fireAt = new Date('2026-08-11T12:00:00.000Z');
    const clock  = () => new Date('2026-08-11T12:02:00.000Z');
    expect(computeLagSeconds(fireAt, clock)).toBe(120);
  });
});
