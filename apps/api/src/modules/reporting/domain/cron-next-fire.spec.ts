/**
 * Unit tests for cron-next-fire.ts — DST transitions, occurrence key determinism,
 * cadence allow-list and minimum interval validation (AC-10).
 *
 * Covers:
 *   - Spring-forward (skipped hour): America/New_York 2024-03-10 02:30 → fire at 03:00
 *   - Fall-back (repeated hour): America/New_York 2024-11-03 01:30 → fire once at std-time
 *   - Europe/London DST transitions
 *   - America/Los_Angeles DST transitions
 *   - UTC schedule (no DST adjustment)
 *   - Monthly, weekly, daily, custom expressions
 *   - Occurrence key determinism and minute-truncation
 *   - validateMinimumInterval rejects sub-hourly expressions
 *   - parseCronExpression errors on malformed expressions
 */

import {
  computeNextFireAt,
  parseCronExpression,
  validateMinimumInterval,
  buildOccurrenceKey,
  CronParseError,
  CronIterationLimitError,
  CADENCE_PRESETS,
} from './cron-next-fire';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a UTC ISO string into a Date. */
const d = (iso: string) => new Date(iso);

/** Compute next fire in a timezone, returns the ISO string for assertions. */
function nextFireIso(expression: string, timezone: string, after: string): string {
  const result = computeNextFireAt({ expression, timezone, after: d(after) });
  return result.nextUtc.toISOString();
}

// ---------------------------------------------------------------------------
// parseCronExpression
// ---------------------------------------------------------------------------

describe('parseCronExpression', () => {
  it('parses a standard 5-field expression', () => {
    const fields = parseCronExpression('0 8 * * *');
    expect(fields.minutes).toEqual([0]);
    expect(fields.hours).toEqual([8]);
    expect(fields.doms).toEqual(expect.arrayContaining([1, 15, 31]));
    expect(fields.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(fields.dows).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('normalises dow 7 → 0 (both are Sunday)', () => {
    const fields = parseCronExpression('0 8 * * 7');
    expect(fields.dows).toEqual([0]);
  });

  it('expands comma-separated values', () => {
    const fields = parseCronExpression('0,30 8,20 * * *');
    expect(fields.minutes).toEqual([0, 30]);
    expect(fields.hours).toEqual([8, 20]);
  });

  it('expands range (a-b)', () => {
    const fields = parseCronExpression('0 9-17 * * 1-5');
    expect(fields.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(fields.dows).toEqual([1, 2, 3, 4, 5]);
  });

  it('expands step (*/step)', () => {
    const fields = parseCronExpression('*/15 * * * *');
    expect(fields.minutes).toEqual([0, 15, 30, 45]);
  });

  it('throws CronParseError on wrong field count', () => {
    expect(() => parseCronExpression('0 8 * *')).toThrow(CronParseError);
    expect(() => parseCronExpression('0 8 * * * *')).toThrow(CronParseError);
  });

  it('throws CronParseError on out-of-range value', () => {
    expect(() => parseCronExpression('60 8 * * *')).toThrow(CronParseError);
    expect(() => parseCronExpression('0 24 * * *')).toThrow(CronParseError);
  });

  it('throws CronParseError on invalid step', () => {
    expect(() => parseCronExpression('*/0 * * * *')).toThrow(CronParseError);
  });
});

// ---------------------------------------------------------------------------
// validateMinimumInterval
// ---------------------------------------------------------------------------

describe('validateMinimumInterval', () => {
  it('accepts an expression with >= 1-hour interval', () => {
    expect(() => validateMinimumInterval('0 8 * * *', 'UTC')).not.toThrow();
    expect(() => validateMinimumInterval('0 8 * * 1', 'UTC')).not.toThrow();
    expect(() => validateMinimumInterval('0 8 1 * *', 'UTC')).not.toThrow();
    expect(() => validateMinimumInterval('0 */2 * * *', 'UTC')).not.toThrow();
  });

  it('rejects an expression with a 30-minute interval', () => {
    expect(() => validateMinimumInterval('0,30 * * * *', 'UTC')).toThrow(CronParseError);
  });

  it('rejects an expression with a 15-minute interval', () => {
    expect(() => validateMinimumInterval('*/15 * * * *', 'UTC')).toThrow(CronParseError);
  });

  it('rejects an expression with a 1-minute interval', () => {
    expect(() => validateMinimumInterval('* * * * *', 'UTC')).toThrow(CronParseError);
  });

  it('accepts exactly-1-hour interval (*/1 not */0)', () => {
    // Every hour at minute 0 — interval is exactly 1h.
    expect(() => validateMinimumInterval('0 * * * *', 'UTC')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// computeNextFireAt — basic expressions
// ---------------------------------------------------------------------------

describe('computeNextFireAt — basic UTC expressions', () => {
  it('daily 08:00 UTC fires next day when already past 08:00', () => {
    // after = 2024-01-15 09:00 UTC → next = 2024-01-16 08:00 UTC
    const result = computeNextFireAt({
      expression: '0 8 * * *',
      timezone:   'UTC',
      after:      d('2024-01-15T09:00:00Z'),
    });
    expect(result.nextUtc.toISOString()).toBe('2024-01-16T08:00:00.000Z');
    expect(result.dstSkipped).toBe(false);
    expect(result.utcOffsetUsed).toBe('+00:00');
  });

  it('daily 08:00 UTC fires same day when still before 08:00', () => {
    const result = computeNextFireAt({
      expression: '0 8 * * *',
      timezone:   'UTC',
      after:      d('2024-01-15T07:59:00Z'),
    });
    expect(result.nextUtc.toISOString()).toBe('2024-01-15T08:00:00.000Z');
  });

  it('weekly Monday 08:00 UTC fires on next Monday', () => {
    // 2024-01-16 is a Tuesday; next Monday = 2024-01-22
    const result = computeNextFireAt({
      expression: '0 8 * * 1',
      timezone:   'UTC',
      after:      d('2024-01-16T08:00:00Z'),
    });
    expect(result.nextUtc.toISOString()).toBe('2024-01-22T08:00:00.000Z');
  });

  it('monthly 1st at 08:00 UTC fires on 1st of next month', () => {
    const result = computeNextFireAt({
      expression: '0 8 1 * *',
      timezone:   'UTC',
      after:      d('2024-01-01T08:00:00Z'),
    });
    expect(result.nextUtc.toISOString()).toBe('2024-02-01T08:00:00.000Z');
  });

  it('honours CADENCE_PRESETS expressions', () => {
    // Smoke test all three presets parse without error.
    for (const expr of Object.values(CADENCE_PRESETS)) {
      expect(() => computeNextFireAt({
        expression: expr,
        timezone:   'UTC',
        after:      new Date('2024-06-01T00:00:00Z'),
      })).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// DST — America/New_York spring-forward 2024-03-10
//   Clocks move forward at 02:00 EST → 03:00 EDT.
//   The local hour 02:00–02:59 does not exist.
// ---------------------------------------------------------------------------

describe('computeNextFireAt — America/New_York spring-forward (2024-03-10)', () => {
  const TZ = 'America/New_York';

  it('fires at 03:00 EDT when expression targets 02:30 (skipped hour)', () => {
    // Expression: 30 2 10 3 * — fire at 02:30 on March 10.
    // 02:30 Eastern does not exist on 2024-03-10.
    // Expected: fires at 03:00 EDT = 07:00 UTC.
    const result = computeNextFireAt({
      expression: '30 2 10 3 *',
      timezone:   TZ,
      after:      d('2024-03-09T00:00:00Z'),
    });
    // Spring-forward: 03:00 EDT = UTC-4 = 2024-03-10T07:00:00Z
    expect(result.dstSkipped).toBe(true);
    // The next-fire should be in the 07:xx hour UTC (EDT = UTC-4)
    expect(result.nextUtc.getUTCHours()).toBe(7);
    expect(result.nextUtc.getUTCDate()).toBe(10);
    expect(result.nextUtc.getUTCMonth()).toBe(2); // March = 2
  });

  it('fires normally the day before the spring-forward', () => {
    // 08:00 Eastern on 2024-03-09 = EST (UTC-5) = 13:00 UTC
    const result = computeNextFireAt({
      expression: '0 8 9 3 *',
      timezone:   TZ,
      after:      d('2024-03-08T00:00:00Z'),
    });
    expect(result.dstSkipped).toBe(false);
    expect(result.nextUtc.toISOString()).toBe('2024-03-09T13:00:00.000Z');
  });

  it('fires at 08:00 EDT (= UTC-4 = 12:00 UTC) the day after spring-forward', () => {
    const result = computeNextFireAt({
      expression: '0 8 11 3 *',
      timezone:   TZ,
      after:      d('2024-03-10T00:00:00Z'),
    });
    expect(result.dstSkipped).toBe(false);
    // 08:00 EDT = UTC-4 → 12:00 UTC
    expect(result.nextUtc.toISOString()).toBe('2024-03-11T12:00:00.000Z');
  });

  it('fires exactly once for the spring-forward schedule (not twice, not zero)', () => {
    // Weekly schedule on Sunday 02:30 Eastern.
    // Week of 2024-03-10 (Sunday): 02:30 EST skipped.
    // Should produce a single fire, not two.
    const results: string[] = [];
    let after = d('2024-03-09T00:00:00Z');
    for (let i = 0; i < 3; i++) {
      const r = computeNextFireAt({ expression: '30 2 * * 0', timezone: TZ, after });
      results.push(r.nextUtc.toISOString());
      after = r.nextUtc;
    }
    // All three fires are on different Sundays.
    const sundays = new Set(results.map((iso) => iso.slice(0, 10)));
    expect(sundays.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// DST — America/New_York fall-back 2024-11-03
//   Clocks move back at 02:00 EDT → 01:00 EST.
//   The local hour 01:00–01:59 occurs twice.
// ---------------------------------------------------------------------------

describe('computeNextFireAt — America/New_York fall-back (2024-11-03)', () => {
  const TZ = 'America/New_York';

  it('fires exactly once for an expression targeting the repeated hour', () => {
    // Expression: 30 1 3 11 * — 01:30 on November 3.
    // 01:30 occurs twice: first as EDT (UTC-4 → 05:30 UTC), then as EST (UTC-5 → 06:30 UTC).
    // Should fire exactly once (first occurrence, standard-time behaviour).
    const after  = d('2024-11-02T00:00:00Z');
    const result = computeNextFireAt({ expression: '30 1 3 11 *', timezone: TZ, after });

    expect(result.dstSkipped).toBe(false);
    // The result must be on Nov 3.
    expect(result.nextUtc.getUTCDate()).toBe(3);
    expect(result.nextUtc.getUTCMonth()).toBe(10); // November = 10

    // Confirm that a second invocation (after = result.nextUtc) skips to 2025.
    const second = computeNextFireAt({ expression: '30 1 3 11 *', timezone: TZ, after: result.nextUtc });
    expect(second.nextUtc.getUTCFullYear()).toBe(2025);
  });

  it('fires at 08:00 EST (UTC-5 = 13:00 UTC) the day after fall-back', () => {
    const result = computeNextFireAt({
      expression: '0 8 4 11 *',
      timezone:   TZ,
      after:      d('2024-11-03T00:00:00Z'),
    });
    expect(result.dstSkipped).toBe(false);
    expect(result.nextUtc.toISOString()).toBe('2024-11-04T13:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// DST — Europe/London spring-forward 2024-03-31
//   Clocks move forward at 01:00 GMT → 02:00 BST.
// ---------------------------------------------------------------------------

describe('computeNextFireAt — Europe/London spring-forward (2024-03-31)', () => {
  const TZ = 'Europe/London';

  it('fires at 02:00 BST when expression targets 01:30 (skipped)', () => {
    const result = computeNextFireAt({
      expression: '30 1 31 3 *',
      timezone:   TZ,
      after:      d('2024-03-30T00:00:00Z'),
    });
    expect(result.dstSkipped).toBe(true);
    // 02:00 BST = UTC+1 = 01:00 UTC
    expect(result.nextUtc.getUTCHours()).toBe(1);
    expect(result.nextUtc.getUTCDate()).toBe(31);
  });

  it('fires at 09:00 BST (= 08:00 UTC) after spring-forward', () => {
    const result = computeNextFireAt({
      expression: '0 9 1 4 *',
      timezone:   TZ,
      after:      d('2024-03-31T00:00:00Z'),
    });
    // 09:00 BST = UTC+1 → 08:00 UTC
    expect(result.nextUtc.toISOString()).toBe('2024-04-01T08:00:00.000Z');
    expect(result.dstSkipped).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DST — America/Los_Angeles spring-forward 2024-03-10
// ---------------------------------------------------------------------------

describe('computeNextFireAt — America/Los_Angeles spring-forward (2024-03-10)', () => {
  const TZ = 'America/Los_Angeles';

  it('fires at 03:00 PDT when expression targets 02:30 (skipped)', () => {
    const result = computeNextFireAt({
      expression: '30 2 10 3 *',
      timezone:   TZ,
      after:      d('2024-03-09T00:00:00Z'),
    });
    expect(result.dstSkipped).toBe(true);
    // 03:00 PDT = UTC-7 = 10:00 UTC
    expect(result.nextUtc.getUTCHours()).toBe(10);
    expect(result.nextUtc.getUTCDate()).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// buildOccurrenceKey
// ---------------------------------------------------------------------------

describe('buildOccurrenceKey', () => {
  const TENANT_ID   = 'tenant-aaa-111';
  const SCHEDULE_ID = 'sched-bbb-222';

  it('returns a 64-character hex SHA-256', () => {
    const key = buildOccurrenceKey(TENANT_ID, SCHEDULE_ID, new Date('2024-01-15T08:00:00Z'));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same inputs', () => {
    const a = buildOccurrenceKey(TENANT_ID, SCHEDULE_ID, new Date('2024-01-15T08:00:00Z'));
    const b = buildOccurrenceKey(TENANT_ID, SCHEDULE_ID, new Date('2024-01-15T08:00:00Z'));
    expect(a).toBe(b);
  });

  it('differs for different tenants', () => {
    const a = buildOccurrenceKey('tenant-A', SCHEDULE_ID, new Date('2024-01-15T08:00:00Z'));
    const b = buildOccurrenceKey('tenant-B', SCHEDULE_ID, new Date('2024-01-15T08:00:00Z'));
    expect(a).not.toBe(b);
  });

  it('differs for different schedules', () => {
    const a = buildOccurrenceKey(TENANT_ID, 'sched-1', new Date('2024-01-15T08:00:00Z'));
    const b = buildOccurrenceKey(TENANT_ID, 'sched-2', new Date('2024-01-15T08:00:00Z'));
    expect(a).not.toBe(b);
  });

  it('is truncated to the minute (seconds ignored)', () => {
    const a = buildOccurrenceKey(TENANT_ID, SCHEDULE_ID, new Date('2024-01-15T08:00:00Z'));
    const b = buildOccurrenceKey(TENANT_ID, SCHEDULE_ID, new Date('2024-01-15T08:00:59Z'));
    expect(a).toBe(b);
  });

  it('differs for different minutes', () => {
    const a = buildOccurrenceKey(TENANT_ID, SCHEDULE_ID, new Date('2024-01-15T08:00:00Z'));
    const b = buildOccurrenceKey(TENANT_ID, SCHEDULE_ID, new Date('2024-01-15T08:01:00Z'));
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// CronIterationLimitError
// ---------------------------------------------------------------------------

describe('CronIterationLimitError', () => {
  it('throws when maxIterations is exceeded', () => {
    // An impossible expression: February 31st never exists.
    expect(() =>
      computeNextFireAt({
        expression:    '0 8 31 2 *',
        timezone:      'UTC',
        after:         new Date('2024-01-01T00:00:00Z'),
        maxIterations: 100,
      }),
    ).toThrow(CronIterationLimitError);
  });
});
