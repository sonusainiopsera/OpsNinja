/**
 * sla-clock.ts — pure calendar-aware SLA clock functions (WO-047).
 *
 * NO framework imports. NO database imports. Safe for unit and property tests.
 *
 * Exported functions:
 *   computeWorkingMs(from, to, calendar) — working milliseconds in [from, to)
 *   computeElapsed(params)               — working ms elapsed against the SLA clock
 *   computeRemaining(params)             — working ms remaining before breach
 *   elapsedPct(params)                   — 0–100 percentage of SLA span consumed
 *
 * Model:
 *   - target_at is IMMUTABLE; pause/resume never change it.
 *   - pausedMs accumulates working time spent paused (set on resume, not on pause).
 *   - When currently paused (pausedAt != null), the open pause window is excluded
 *     from elapsed but is NOT yet in pausedMs (it will be added on resume).
 *   - elapsed = workingMs(startedAt, now) − pausedMs − workingMs(pausedAt, now) [if paused]
 *   - remaining = targetSpan − elapsed  where targetSpan = workingMs(startedAt, targetAt)
 *
 * Calendar types:
 *   twenty_four_seven: workingMs = wall-clock ms (every second counts)
 *   business_hours:    workingMs = sum of time in configured working windows,
 *                      skipping weekdays with no windows and holiday dates.
 *
 * DST safety: all tz conversions use Intl.DateTimeFormat; no getTimezoneOffset calls.
 */

import type { CalendarSpec } from './sla-target-calculator';

// ---------------------------------------------------------------------------
// Re-export CalendarSpec so callers can import from one place
// ---------------------------------------------------------------------------
export type { CalendarSpec } from './sla-target-calculator';

// ---------------------------------------------------------------------------
// Parameter shapes
// ---------------------------------------------------------------------------

export interface ClockParams {
  startedAt: Date;
  targetAt: Date;
  /** Accumulated pause duration already committed (set on resume). */
  pausedMs: number;
  /** Set when the timer is currently paused; null when running. */
  pausedAt: Date | null;
  now: Date;
  calendar: CalendarSpec;
}

// ---------------------------------------------------------------------------
// Intl helpers (duplicated from sla-target-calculator to keep module pure)
// ---------------------------------------------------------------------------

const WEEKDAY_MAP: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

interface LocalParts {
  year: number; month: number; day: number;
  hour: number; minute: number; second: number;
  weekday: number;
}

function getLocalParts(instant: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short', hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) parts[part.type] = part.value;
  const rawHour = parseInt(parts['hour'] ?? '0', 10);
  return {
    year: parseInt(parts['year'] ?? '0', 10),
    month: parseInt(parts['month'] ?? '0', 10),
    day: parseInt(parts['day'] ?? '0', 10),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: parseInt(parts['minute'] ?? '0', 10),
    second: parseInt(parts['second'] ?? '0', 10),
    weekday: WEEKDAY_MAP[parts['weekday'] ?? ''] ?? 0,
  };
}

function getLocalDateString(instant: Date, tz: string): string {
  const { year, month, day } = getLocalParts(instant, tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function localToUtc(y: number, mo: number, d: number, h: number, m: number, s: number, tz: string): Date {
  const estimate = new Date(Date.UTC(y, mo - 1, d, h, m, s));
  const localAtEstimate = getLocalParts(estimate, tz);
  const utcFromLocal = Date.UTC(localAtEstimate.year, localAtEstimate.month - 1, localAtEstimate.day, localAtEstimate.hour, localAtEstimate.minute, localAtEstimate.second);
  const offsetMs = estimate.getTime() - utcFromLocal;
  const adjusted = new Date(estimate.getTime() + offsetMs);
  const checkParts = getLocalParts(adjusted, tz);
  if (checkParts.year === y && checkParts.month === mo && checkParts.day === d && checkParts.hour === h && checkParts.minute === m && checkParts.second === s) return adjusted;
  const utcFromCheck = Date.UTC(checkParts.year, checkParts.month - 1, checkParts.day, checkParts.hour, checkParts.minute, checkParts.second);
  return new Date(estimate.getTime() + (adjusted.getTime() - utcFromCheck));
}

function parseLocalTime(t: string): { hour: number; minute: number; second: number } {
  const [h = '0', m = '0', s = '0'] = t.split(':');
  return { hour: parseInt(h, 10), minute: parseInt(m, 10), second: parseInt(s, 10) };
}

function windowBoundaryUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y = '0', mo = '0', d = '0'] = dateStr.split('-');
  const { hour, minute, second } = parseLocalTime(timeStr);
  return localToUtc(parseInt(y, 10), parseInt(mo, 10), parseInt(d, 10), hour, minute, second, tz);
}

function startOfNextLocalDay(localDateStr: string, tz: string): Date {
  const [y = '0', m = '0', d = '0'] = localDateStr.split('-');
  const noonUtc = localToUtc(parseInt(y, 10), parseInt(m, 10), parseInt(d, 10), 12, 0, 0, tz);
  const nextDayNoon = new Date(noonUtc.getTime() + 24 * 60 * 60 * 1000);
  const nextDateStr = getLocalDateString(nextDayNoon, tz);
  const [ny = '0', nm = '0', nd = '0'] = nextDateStr.split('-');
  return localToUtc(parseInt(ny, 10), parseInt(nm, 10), parseInt(nd, 10), 0, 0, 0, tz);
}

function getWindowsForDate(localDate: string, weekday: number, calendar: CalendarSpec): Array<{ start: Date; end: Date }> {
  if (calendar.holidays.some((h) => h.holidayDate === localDate)) return [];
  const dayWindows = calendar.windows.filter((w) => w.weekday === weekday);
  if (dayWindows.length === 0) return [];
  return dayWindows
    .map((w) => ({
      start: windowBoundaryUtc(localDate, w.startLocalTime, calendar.timezone),
      end: windowBoundaryUtc(localDate, w.endLocalTime, calendar.timezone),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

// ---------------------------------------------------------------------------
// Core primitive: computeWorkingMs
// ---------------------------------------------------------------------------

const MAX_WORKING_MS_ITERATIONS = 500;

/**
 * Compute the number of working milliseconds in the half-open interval [from, to).
 *
 * For twenty_four_seven: returns max(0, to - from) in wall-clock ms.
 * For business_hours: sums only the time inside configured working windows.
 *
 * Returns 0 when from >= to (handles paused periods that span non-working time).
 */
export function computeWorkingMs(from: Date, to: Date, calendar: CalendarSpec): number {
  if (from.getTime() >= to.getTime()) return 0;

  if (calendar.calendarType === 'twenty_four_seven') {
    return to.getTime() - from.getTime();
  }

  // business_hours: walk forward summing window time
  let accumulated = 0;
  let cursor = new Date(from.getTime());
  const toMs = to.getTime();
  let iterations = 0;

  while (cursor.getTime() < toMs) {
    if (iterations++ >= MAX_WORKING_MS_ITERATIONS) break; // safety: should never hit this

    const localDate = getLocalDateString(cursor, calendar.timezone);
    const localParts = getLocalParts(cursor, calendar.timezone);
    const windows = getWindowsForDate(localDate, localParts.weekday, calendar);

    let advancedToday = false;
    for (const win of windows) {
      if (win.end.getTime() <= cursor.getTime()) continue; // window already passed

      const effectiveStart = Math.max(win.start.getTime(), cursor.getTime());
      const effectiveEnd = Math.min(win.end.getTime(), toMs);

      if (effectiveEnd > effectiveStart) {
        accumulated += effectiveEnd - effectiveStart;
        cursor = new Date(Math.min(win.end.getTime(), toMs));
        advancedToday = true;
      }

      if (cursor.getTime() >= toMs) break;
    }

    if (!advancedToday || cursor.getTime() < toMs) {
      // Advance to next local day's start
      const nextDay = startOfNextLocalDay(localDate, calendar.timezone);
      if (nextDay.getTime() <= cursor.getTime()) {
        // Fallback: advance by 1 hour to avoid infinite loop on edge cases
        cursor = new Date(cursor.getTime() + 3_600_000);
      } else {
        cursor = nextDay;
      }
    }
  }

  return accumulated;
}

// ---------------------------------------------------------------------------
// Public clock functions
// ---------------------------------------------------------------------------

/**
 * Compute how many working milliseconds of SLA time have been consumed.
 *
 * elapsed = workingMs(startedAt, now)
 *         − pausedMs           (accumulated from prior pause windows)
 *         − workingMs(pausedAt, now)  [only when currently paused]
 */
export function computeElapsed(p: ClockParams): number {
  const totalSoFar = computeWorkingMs(p.startedAt, p.now, p.calendar);
  const currentPauseWorking = p.pausedAt
    ? computeWorkingMs(p.pausedAt, p.now, p.calendar)
    : 0;
  return Math.max(0, totalSoFar - p.pausedMs - currentPauseWorking);
}

/**
 * Compute how many working milliseconds remain before the SLA target.
 *
 * remaining = targetSpan − elapsed
 * where targetSpan = workingMs(startedAt, targetAt)
 */
export function computeRemaining(p: ClockParams): number {
  const targetSpan = computeWorkingMs(p.startedAt, p.targetAt, p.calendar);
  const elapsed = computeElapsed(p);
  return Math.max(0, targetSpan - elapsed);
}

/**
 * Compute elapsed as a 0–100 percentage of the total SLA span.
 * Returns 100 when the target span is zero or the SLA has been exceeded.
 */
export function elapsedPct(p: ClockParams): number {
  const targetSpan = computeWorkingMs(p.startedAt, p.targetAt, p.calendar);
  if (targetSpan <= 0) return 100;
  const elapsed = computeElapsed(p);
  return Math.min(100, (elapsed / targetSpan) * 100);
}

/**
 * Reconstruct the full timeline from an ordered list of state-transition events.
 * Returns { pausedMs, state } matching what the live timer row should show.
 *
 * Used by the audit reconstruction helper (AC-9) and integration test assertions.
 */
export interface TimerEvent {
  toState: string;
  fromState: string;
  occurredAt: Date;
  pausedMsAtEvent: number;
}

export interface ReconstructedTimer {
  state: string;
  pausedMs: number;
  /** The pausedAt instant if the final state is 'paused', else null */
  pausedAt: Date | null;
}

export function reconstructFromEvents(events: TimerEvent[]): ReconstructedTimer {
  if (events.length === 0) return { state: 'running', pausedMs: 0, pausedAt: null };
  const last = events[events.length - 1]!;
  return {
    state: last.toState,
    pausedMs: last.pausedMsAtEvent,
    pausedAt: last.toState === 'paused' ? last.occurredAt : null,
  };
}
