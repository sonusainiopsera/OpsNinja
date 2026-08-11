/**
 * SlaTargetCalculator — pure, framework-free domain function (WO-045).
 *
 * Computes target_at from a start instant, target minutes and a calendar.
 *
 * Rules:
 *   - twenty_four_seven: target_at = startAt + targetMinutes (plain wall-clock).
 *   - business_hours: advance the clock only through configured working windows
 *     in the calendar's IANA timezone, skipping holidays and days with no windows.
 *
 * DST handling: all timezone conversion is done via Intl.DateTimeFormat (IANA
 * database). The code never calls Date.prototype.getTimezoneOffset — doing so
 * would silently produce wrong results when a date crosses a DST boundary.
 *
 * Throws SlaTargetError when:
 *   - calendarType is 'business_hours' but no windows are configured.
 *   - computation exceeds MAX_ITERATIONS (pathological/misconfigured calendar).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CalendarWindow {
  /** 0 = Monday … 6 = Sunday (ISO weekday minus 1) */
  weekday: number;
  /** 'HH:MM:SS' in the calendar's local timezone */
  startLocalTime: string;
  /** 'HH:MM:SS' in the calendar's local timezone */
  endLocalTime: string;
}

export interface CalendarHoliday {
  /** 'YYYY-MM-DD' in the calendar's local timezone */
  holidayDate: string;
}

export interface CalendarSpec {
  calendarType: 'twenty_four_seven' | 'business_hours';
  /** IANA timezone string, e.g. 'Europe/London', 'America/New_York' */
  timezone: string;
  windows: CalendarWindow[];
  holidays: CalendarHoliday[];
}

export interface SlaTargetInput {
  startAt: Date;
  /** Must be > 0 */
  targetMinutes: number;
  calendar: CalendarSpec;
}

export class SlaTargetError extends Error {
  constructor(
    message: string,
    public readonly code: 'NO_WORKING_WINDOWS' | 'ITERATION_LIMIT_EXCEEDED' | 'COMPUTATION_FAILED',
  ) {
    super(message);
    this.name = 'SlaTargetError';
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum outer loop iterations. At ≤1 window/day this covers ~14 months. */
const MAX_ITERATIONS = 500;
const MS_PER_MINUTE = 60_000;

// ---------------------------------------------------------------------------
// Intl-based local-time helpers (no getTimezoneOffset)
// ---------------------------------------------------------------------------

interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;   // 1–31
  hour: number;  // 0–23
  minute: number;
  second: number;
  weekday: number; // 0=Monday … 6=Sunday
}

/**
 * Parse the weekday short name (en-US locale) to 0=Monday … 6=Sunday.
 * Intl with weekday:'short' produces 'Mon','Tue','Wed','Thu','Fri','Sat','Sun'.
 */
const WEEKDAY_MAP: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

/**
 * Extract local time components for a UTC instant in the given IANA timezone.
 * All field values come from Intl.DateTimeFormat.formatToParts — no offset math.
 */
function getLocalParts(instant: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hour12: false,
  });

  const parts: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  // hour12: false can return '24' for midnight in some environments; normalise to 0.
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

/** Return 'YYYY-MM-DD' for a UTC instant expressed in the given timezone. */
function getLocalDateString(instant: Date, tz: string): string {
  const { year, month, day } = getLocalParts(instant, tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Convert local civil time in `tz` to a UTC Date.
 *
 * Algorithm: estimate using UTC, measure the offset at that estimate via Intl,
 * then apply a correction. A second pass handles DST ambiguity (fall-back
 * repeated hour) by always preferring the first (earlier) UTC occurrence.
 *
 * This is functionally equivalent to Luxon's DateTime.fromObject() and
 * date-fns-tz's zonedTimeToUtc(), implemented using only built-in Intl API.
 */
function localToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
  tz: string,
): Date {
  // Step 1: treat local time as UTC for a rough estimate.
  const estimate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  // Step 2: measure offset at the estimate.
  const localAtEstimate = getLocalParts(estimate, tz);
  const utcFromLocal = Date.UTC(
    localAtEstimate.year, localAtEstimate.month - 1, localAtEstimate.day,
    localAtEstimate.hour, localAtEstimate.minute, localAtEstimate.second,
  );
  const offsetMs = estimate.getTime() - utcFromLocal;

  // Step 3: apply correction.
  const adjusted = new Date(estimate.getTime() + offsetMs);

  // Step 4: verify — one more correction pass for edge cases near DST transitions.
  const checkParts = getLocalParts(adjusted, tz);
  if (
    checkParts.year === year && checkParts.month === month && checkParts.day === day &&
    checkParts.hour === hour && checkParts.minute === minute && checkParts.second === second
  ) {
    return adjusted;
  }

  // Second correction pass.
  const utcFromCheck = Date.UTC(
    checkParts.year, checkParts.month - 1, checkParts.day,
    checkParts.hour, checkParts.minute, checkParts.second,
  );
  return new Date(estimate.getTime() + (adjusted.getTime() - utcFromCheck));
}

/** Parse 'HH:MM:SS' or 'HH:MM' into { hour, minute, second }. */
function parseLocalTime(t: string): { hour: number; minute: number; second: number } {
  const [h = '0', m = '0', s = '0'] = t.split(':');
  return { hour: parseInt(h, 10), minute: parseInt(m, 10), second: parseInt(s, 10) };
}

// ---------------------------------------------------------------------------
// Business-hours walker helpers
// ---------------------------------------------------------------------------

/** Convert a working-window boundary (date + time + tz) to a UTC Date. */
function windowBoundary(dateStr: string, timeStr: string, tz: string): Date {
  const [y = '0', mo = '0', d = '0'] = dateStr.split('-');
  const { hour, minute, second } = parseLocalTime(timeStr);
  return localToUtc(parseInt(y, 10), parseInt(mo, 10), parseInt(d, 10), hour, minute, second, tz);
}

/**
 * Return the open/close UTC instant pairs for all working windows on a given
 * local date (by weekday), sorted by start time.
 *
 * Returns an empty array when:
 *   - The date is a configured holiday.
 *   - No windows are configured for that weekday.
 */
function getWindowsForDate(
  localDate: string,
  weekday: number,
  calendar: CalendarSpec,
): Array<{ start: Date; end: Date }> {
  if (calendar.holidays.some((h) => h.holidayDate === localDate)) return [];

  const dayWindows = calendar.windows.filter((w) => w.weekday === weekday);
  if (dayWindows.length === 0) return [];

  return dayWindows
    .map((w) => ({
      start: windowBoundary(localDate, w.startLocalTime, calendar.timezone),
      end: windowBoundary(localDate, w.endLocalTime, calendar.timezone),
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Return a UTC Date for midnight (00:00:00) of the next local calendar day in `tz`.
 *
 * We use a noon-based pivot (safe from DST ambiguity at midnight) to find the
 * next day's date string before converting midnight back to UTC.
 */
function startOfNextLocalDay(localDateStr: string, tz: string): Date {
  const [y = '0', m = '0', d = '0'] = localDateStr.split('-');
  const noonUtc = localToUtc(parseInt(y, 10), parseInt(m, 10), parseInt(d, 10), 12, 0, 0, tz);
  const nextDayNoon = new Date(noonUtc.getTime() + 24 * 60 * 60 * 1000);
  const nextDateStr = getLocalDateString(nextDayNoon, tz);
  const [ny = '0', nm = '0', nd = '0'] = nextDateStr.split('-');
  return localToUtc(parseInt(ny, 10), parseInt(nm, 10), parseInt(nd, 10), 0, 0, 0, tz);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Compute the SLA target instant from a start instant, a target duration in
 * minutes and a calendar specification.
 *
 * @throws SlaTargetError on misconfigured calendars or pathological spans.
 */
export function computeSlaTarget({ startAt, targetMinutes, calendar }: SlaTargetInput): Date {
  if (targetMinutes <= 0) {
    return new Date(startAt.getTime());
  }

  // ── twenty_four_seven: plain elapsed arithmetic ───────────────────────────
  if (calendar.calendarType === 'twenty_four_seven') {
    return new Date(startAt.getTime() + targetMinutes * MS_PER_MINUTE);
  }

  // ── business_hours: walk forward through working windows ─────────────────
  if (calendar.windows.length === 0) {
    throw new SlaTargetError(
      'Calendar has no working windows — cannot compute SLA target.',
      'NO_WORKING_WINDOWS',
    );
  }

  let remainingMs = targetMinutes * MS_PER_MINUTE;
  let currentInstant = new Date(startAt.getTime());
  let iterations = 0;

  while (remainingMs > 0) {
    if (iterations++ >= MAX_ITERATIONS) {
      throw new SlaTargetError(
        `SLA target could not be computed within ${MAX_ITERATIONS} iterations — ` +
        'check the calendar for missing windows or holidays covering the entire span.',
        'ITERATION_LIMIT_EXCEEDED',
      );
    }

    const localParts = getLocalParts(currentInstant, calendar.timezone);
    const localDate = getLocalDateString(currentInstant, calendar.timezone);
    const windows = getWindowsForDate(localDate, localParts.weekday, calendar);

    // Iterate all windows for today in order.
    for (const window of windows) {
      // Skip windows that have already ended.
      if (window.end.getTime() <= currentInstant.getTime()) continue;

      // Effective start is the later of the window open and the current clock position.
      const effectiveStart = Math.max(window.start.getTime(), currentInstant.getTime());
      const windowMs = window.end.getTime() - effectiveStart;
      if (windowMs <= 0) continue;

      if (remainingMs <= windowMs) {
        // The target instant falls within this window.
        return new Date(effectiveStart + remainingMs);
      }

      // Consume the entire window and continue to the next one today.
      remainingMs -= windowMs;
      currentInstant = new Date(window.end.getTime());
    }

    // No windows remain for today (either holiday, no config, or all consumed).
    // Advance to midnight of the next local day.
    currentInstant = startOfNextLocalDay(localDate, calendar.timezone);
  }

  // Should be unreachable — loop exits only via return or throw.
  throw new SlaTargetError('SLA target computation failed.', 'COMPUTATION_FAILED');
}

// ---------------------------------------------------------------------------
// next_fire_at helper (exported for SlaService)
// ---------------------------------------------------------------------------

/**
 * Compute next_fire_at as the earliest of the two reminder threshold instants
 * and target_at.
 *
 * Reminder instants are proportional to the wall-clock duration from startedAt
 * to targetAt (calendar-aware span already reflected in targetAt).
 */
export function computeNextFireAt(params: {
  startedAt: Date;
  targetAt: Date;
  reminderPctFirst: number;
  reminderPctSecond: number;
}): Date {
  const { startedAt, targetAt, reminderPctFirst, reminderPctSecond } = params;
  const totalMs = targetAt.getTime() - startedAt.getTime();

  const firstAt = new Date(startedAt.getTime() + totalMs * (reminderPctFirst / 100));
  const secondAt = new Date(startedAt.getTime() + totalMs * (reminderPctSecond / 100));

  return new Date(Math.min(firstAt.getTime(), secondAt.getTime(), targetAt.getTime()));
}
