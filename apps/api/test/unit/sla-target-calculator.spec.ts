/**
 * Unit tests for SlaTargetCalculator — WO-045 AC10.
 *
 * Tests computeSlaTarget and computeNextFireAt — pure, framework-free domain
 * functions. No database, no NestJS container.
 *
 * Coverage:
 *   - 24x7: plain elapsed arithmetic (simple, midnight crossing, 24h)
 *   - business_hours: start inside window, before open, after close (→ next day)
 *   - business_hours: spans crossing weekends
 *   - business_hours: spans crossing configured holidays
 *   - business_hours: DST spring-forward crossing (Europe/London, March 29 2026)
 *   - business_hours: DST fall-back crossing (Europe/London, October 25 2026)
 *   - business_hours: multi-week span (5 full business days)
 *   - business_hours: 1-min target with only 30s remaining in current window
 *   - SlaTargetError(NO_WORKING_WINDOWS) on misconfigured calendar
 *   - computeNextFireAt: reminder threshold arithmetic
 */

import {
  computeSlaTarget,
  computeNextFireAt,
  SlaTargetError,
  type CalendarSpec,
  type CalendarWindow,
} from '../../src/modules/sla/domain/sla-target-calculator';

// ---------------------------------------------------------------------------
// Calendar fixtures
// ---------------------------------------------------------------------------

const UTC_24x7: CalendarSpec = {
  calendarType: 'twenty_four_seven',
  timezone: 'UTC',
  windows: [],
  holidays: [],
};

// Mon–Fri 09:00–17:00 Europe/London
const LONDON_WINDOWS: CalendarWindow[] = [
  { weekday: 0, startLocalTime: '09:00:00', endLocalTime: '17:00:00' }, // Mon
  { weekday: 1, startLocalTime: '09:00:00', endLocalTime: '17:00:00' }, // Tue
  { weekday: 2, startLocalTime: '09:00:00', endLocalTime: '17:00:00' }, // Wed
  { weekday: 3, startLocalTime: '09:00:00', endLocalTime: '17:00:00' }, // Thu
  { weekday: 4, startLocalTime: '09:00:00', endLocalTime: '17:00:00' }, // Fri
];

function londonBiz(holidays: Array<{ holidayDate: string }> = []): CalendarSpec {
  return {
    calendarType: 'business_hours',
    timezone: 'Europe/London',
    windows: LONDON_WINDOWS.map((w) => ({ ...w })),
    holidays,
  };
}

/** Convenience: parse ISO string to Date */
function d(iso: string): Date {
  return new Date(iso);
}

// ---------------------------------------------------------------------------
// 24x7 — plain elapsed arithmetic
// ---------------------------------------------------------------------------

describe('computeSlaTarget — twenty_four_seven', () => {
  it('60 min simple elapsed (no day crossing)', () => {
    const result = computeSlaTarget({
      startAt: d('2026-01-05T10:00:00.000Z'),
      targetMinutes: 60,
      calendar: UTC_24x7,
    });
    expect(result.toISOString()).toBe('2026-01-05T11:00:00.000Z');
  });

  it('90 min crossing midnight', () => {
    const result = computeSlaTarget({
      startAt: d('2026-01-05T23:30:00.000Z'),
      targetMinutes: 90,
      calendar: UTC_24x7,
    });
    expect(result.toISOString()).toBe('2026-01-06T01:00:00.000Z');
  });

  it('1440 min (24 h) advances exactly one day', () => {
    const result = computeSlaTarget({
      startAt: d('2026-01-05T10:00:00.000Z'),
      targetMinutes: 1440,
      calendar: UTC_24x7,
    });
    expect(result.toISOString()).toBe('2026-01-06T10:00:00.000Z');
  });

  it('targetMinutes = 0 returns startAt unchanged', () => {
    const start = d('2026-01-05T10:00:00.000Z');
    const result = computeSlaTarget({ startAt: start, targetMinutes: 0, calendar: UTC_24x7 });
    expect(result.getTime()).toBe(start.getTime());
  });
});

// ---------------------------------------------------------------------------
// business_hours — Europe/London (UTC+0 in January, UTC+1 BST in summer)
// ---------------------------------------------------------------------------

describe('computeSlaTarget — business_hours (Europe/London)', () => {
  it('30 min starting inside window (Mon Jan 5 10:00 UTC)', () => {
    // January: London = GMT = UTC+0
    const result = computeSlaTarget({
      startAt: d('2026-01-05T10:00:00.000Z'), // Mon 10:00 London
      targetMinutes: 30,
      calendar: londonBiz(),
    });
    expect(result.toISOString()).toBe('2026-01-05T10:30:00.000Z');
  });

  it('60 min starting before window opens (Mon 07:00 → clock starts at 09:00)', () => {
    const result = computeSlaTarget({
      startAt: d('2026-01-05T07:00:00.000Z'), // Mon 07:00 London
      targetMinutes: 60,
      calendar: londonBiz(),
    });
    // Clock starts at Mon 09:00 UTC; target = 10:00 UTC
    expect(result.toISOString()).toBe('2026-01-05T10:00:00.000Z');
  });

  it('30 min starting after close on same day (Mon 17:30 → Tue 09:30)', () => {
    const result = computeSlaTarget({
      startAt: d('2026-01-05T17:30:00.000Z'), // Mon 17:30 London (after close)
      targetMinutes: 30,
      calendar: londonBiz(),
    });
    expect(result.toISOString()).toBe('2026-01-06T09:30:00.000Z');
  });

  it('30 min starting on Saturday (Jan 10) → Mon Jan 12 09:30', () => {
    // Jan 10 2026 = Saturday
    const result = computeSlaTarget({
      startAt: d('2026-01-10T03:00:00.000Z'),
      targetMinutes: 30,
      calendar: londonBiz(),
    });
    expect(result.toISOString()).toBe('2026-01-12T09:30:00.000Z');
  });

  it('60 min spanning Fri close → Mon open (Fri Jan 9 16:30)', () => {
    // Fri 16:30–17:00 = 30 min; Mon 09:00–09:30 = 30 min
    const result = computeSlaTarget({
      startAt: d('2026-01-09T16:30:00.000Z'), // Fri Jan 9 16:30 London
      targetMinutes: 60,
      calendar: londonBiz(),
    });
    expect(result.toISOString()).toBe('2026-01-12T09:30:00.000Z');
  });

  it('holiday skip: 120 min with Tuesday Jan 6 as holiday (Mon→skip Tue→Wed)', () => {
    // Mon Jan 5 16:00 → 17:00 = 60 min; Tue Jan 6 = holiday (skipped); Wed Jan 7 09:00 → 10:00 = 60 min
    const result = computeSlaTarget({
      startAt: d('2026-01-05T16:00:00.000Z'),
      targetMinutes: 120,
      calendar: londonBiz([{ holidayDate: '2026-01-06' }]),
    });
    expect(result.toISOString()).toBe('2026-01-07T10:00:00.000Z');
  });

  it('multi-week span: 2400 min = 5 full business days (Mon 09:00 → Fri 17:00)', () => {
    // 5 × 8h = 2400 min; starts Mon Jan 5 09:00; ends Fri Jan 9 17:00
    const result = computeSlaTarget({
      startAt: d('2026-01-05T09:00:00.000Z'),
      targetMinutes: 2400,
      calendar: londonBiz(),
    });
    expect(result.toISOString()).toBe('2026-01-09T17:00:00.000Z');
  });

  it('DST spring-forward: Fri (GMT) + 60 min + 60 min → Mon (BST)', () => {
    // UK DST starts Sun Mar 29 2026 at 01:00 UTC (→ 02:00 BST).
    // Fri Mar 27 is still GMT (UTC+0); 16:00 UTC = 16:00 London.
    // Window closes Fri 17:00 GMT = 17:00 UTC → 60 min consumed on Friday.
    // Mon Mar 30 opens at 09:00 BST = 08:00 UTC; +60 min = 09:00 UTC = 10:00 BST.
    const result = computeSlaTarget({
      startAt: d('2026-03-27T16:00:00.000Z'),
      targetMinutes: 120,
      calendar: londonBiz(),
    });
    expect(result.toISOString()).toBe('2026-03-30T09:00:00.000Z');
  });

  it('DST fall-back: Fri (BST) + 60 min + 60 min → Mon (GMT)', () => {
    // UK clocks fall back Sun Oct 25 2026 at 01:00 UTC.
    // Fri Oct 23 is in BST (UTC+1); 15:00 UTC = 16:00 BST; window closes 17:00 BST = 16:00 UTC.
    // 60 min consumed on Friday (15:00–16:00 UTC).
    // Mon Oct 26 is in GMT (UTC+0); opens at 09:00 GMT = 09:00 UTC; +60 min = 10:00 UTC.
    const result = computeSlaTarget({
      startAt: d('2026-10-23T15:00:00.000Z'),
      targetMinutes: 120,
      calendar: londonBiz(),
    });
    expect(result.toISOString()).toBe('2026-10-26T10:00:00.000Z');
  });

  it('start-outside-window: 1 min target with only 30 s left (Mon 16:59:30)', () => {
    // Mon 16:59:30 → 17:00 = 30 s; remaining 30 s on Tue 09:00
    const result = computeSlaTarget({
      startAt: d('2026-01-05T16:59:30.000Z'),
      targetMinutes: 1,
      calendar: londonBiz(),
    });
    expect(result.toISOString()).toBe('2026-01-06T09:00:30.000Z');
  });

  it('throws SlaTargetError(NO_WORKING_WINDOWS) when business_hours calendar has no windows', () => {
    const emptyBiz: CalendarSpec = {
      calendarType: 'business_hours',
      timezone: 'Europe/London',
      windows: [],
      holidays: [],
    };

    let caught: unknown;
    try {
      computeSlaTarget({ startAt: d('2026-01-05T10:00:00.000Z'), targetMinutes: 60, calendar: emptyBiz });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SlaTargetError);
    expect((caught as SlaTargetError).code).toBe('NO_WORKING_WINDOWS');
  });

  it('consecutive holidays: span across two-day holiday block is handled', () => {
    // Fri Jan 9 16:00 → 17:00 = 60 min; skip Mon Jan 12 (holiday); skip Tue Jan 13 (holiday); Wed Jan 14 09:00 → 10:00
    const result = computeSlaTarget({
      startAt: d('2026-01-09T16:00:00.000Z'), // Fri 16:00 London
      targetMinutes: 120,
      calendar: londonBiz([{ holidayDate: '2026-01-12' }, { holidayDate: '2026-01-13' }]),
    });
    expect(result.toISOString()).toBe('2026-01-14T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// computeNextFireAt
// ---------------------------------------------------------------------------

describe('computeNextFireAt', () => {
  it('returns first reminder instant when it is earliest (50% < 75% < 100%)', () => {
    const startedAt = d('2026-01-05T10:00:00.000Z');
    const targetAt = new Date(startedAt.getTime() + 100 * 60_000); // +100 min

    const result = computeNextFireAt({
      startedAt,
      targetAt,
      reminderPctFirst: 50,
      reminderPctSecond: 75,
    });

    const expected = new Date(startedAt.getTime() + 50 * 60_000); // +50 min
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('second reminder is earlier when percentages are reversed (picks minimum)', () => {
    const startedAt = d('2026-01-05T10:00:00.000Z');
    const targetAt = new Date(startedAt.getTime() + 100 * 60_000);

    const result = computeNextFireAt({
      startedAt,
      targetAt,
      reminderPctFirst: 75,
      reminderPctSecond: 50,
    });

    const expected = new Date(startedAt.getTime() + 50 * 60_000);
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('both reminders at 100% returns targetAt exactly', () => {
    const startedAt = d('2026-01-05T10:00:00.000Z');
    const targetAt = new Date(startedAt.getTime() + 60 * 60_000);

    const result = computeNextFireAt({
      startedAt,
      targetAt,
      reminderPctFirst: 100,
      reminderPctSecond: 100,
    });

    expect(result.getTime()).toBe(targetAt.getTime());
  });

  it('typical P2 policy: 50%/75% of 240 min → nextFireAt at 120 min', () => {
    const startedAt = d('2026-01-05T10:00:00.000Z');
    const targetAt = new Date(startedAt.getTime() + 240 * 60_000); // +240 min

    const result = computeNextFireAt({
      startedAt,
      targetAt,
      reminderPctFirst: 50,
      reminderPctSecond: 75,
    });

    const expected = new Date(startedAt.getTime() + 120 * 60_000); // 50% of 240
    expect(result.getTime()).toBe(expected.getTime());
  });

  it('nextFireAt is never after targetAt', () => {
    const startedAt = d('2026-01-05T10:00:00.000Z');
    const targetAt = new Date(startedAt.getTime() + 60 * 60_000);

    const result = computeNextFireAt({
      startedAt,
      targetAt,
      reminderPctFirst: 50,
      reminderPctSecond: 75,
    });

    expect(result.getTime()).toBeLessThanOrEqual(targetAt.getTime());
  });

  it('result is a Date instance', () => {
    const startedAt = d('2026-01-05T10:00:00.000Z');
    const targetAt = new Date(startedAt.getTime() + 60 * 60_000);
    const result = computeNextFireAt({ startedAt, targetAt, reminderPctFirst: 50, reminderPctSecond: 75 });
    expect(result).toBeInstanceOf(Date);
  });
});
