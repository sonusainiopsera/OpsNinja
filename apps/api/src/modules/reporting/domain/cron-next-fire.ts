/**
 * cronNextFire — IANA-aware cron next-fire calculator (WO-075).
 *
 * Computes the next UTC fire time for a 5-field cron expression given an IANA
 * timezone. Uses ONLY Intl.DateTimeFormat.formatToParts for timezone arithmetic
 * — never Date.prototype.getTimezoneOffset() (not IANA-aware).
 *
 * DST behaviour:
 *   Spring-forward (skipped hour): when the computed local time falls in the
 *     skipped hour, advance to the next valid local instant (start of the
 *     resumed hour). Fires exactly once — the skipped occurrence is lost.
 *   Fall-back (repeated hour): when the computed local time falls in the
 *     repeated hour, fire using the first occurrence (standard→DST transition)
 *     and record the UTC offset used. Fires exactly once per schedule tick.
 *
 * Minimum interval guard: callers enforce ≥ 1-hour minimum; this module does
 * not re-validate cadence.
 *
 * Supported cron fields: minute hour dom month dow (0–7 where both 0 and 7 = Sunday).
 * Supported value types: single value, comma list, range (a-b), step (start/step or *\/step).
 *
 * @example
 *   const next = computeNextFireAt('0 8 * * 1', 'America/New_York', new Date());
 *   // → next Monday 08:00 Eastern, returned as UTC Date
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CronNextFireOptions {
  /** 5-field cron expression: min hour dom month dow */
  expression: string;
  /** IANA timezone string */
  timezone: string;
  /** Start searching from this UTC time (exclusive) */
  after: Date;
  /** Safety limit on iterations (default 10_000) */
  maxIterations?: number;
}

export interface CronNextFireResult {
  nextUtc: Date;
  /** UTC offset string used, e.g. '-05:00' */
  utcOffsetUsed: string;
  /** True when the local fire time fell in a DST skipped window */
  dstSkipped: boolean;
}

export class CronParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CronParseError';
  }
}

export class CronIterationLimitError extends Error {
  constructor(expression: string, timezone: string) {
    super(`cron next-fire iteration limit exceeded: expr="${expression}" tz="${timezone}"`);
    this.name = 'CronIterationLimitError';
  }
}

// ---------------------------------------------------------------------------
// Cron field parser
// ---------------------------------------------------------------------------

interface CronFields {
  minutes:  number[];
  hours:    number[];
  doms:     number[];   // day-of-month
  months:   number[];   // 1-based
  dows:     number[];   // 0=Sun … 6=Sat
}

function range(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

function expandField(field: string, lo: number, hi: number): number[] {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    if (part === '*') {
      range(lo, hi).forEach((n) => values.add(n));
      continue;
    }

    // Step: */step or start/step or start-end/step
    if (part.includes('/')) {
      const [rangePart, stepStr] = part.split('/');
      const step = parseInt(stepStr!, 10);
      if (isNaN(step) || step < 1) throw new CronParseError(`Invalid step in "${part}"`);
      let start = lo;
      let end = hi;
      if (rangePart !== '*') {
        if (rangePart!.includes('-')) {
          const [a, b] = rangePart!.split('-').map(Number);
          start = a!;
          end = b!;
        } else {
          start = parseInt(rangePart!, 10);
        }
      }
      for (let v = start; v <= end; v += step) values.add(v);
      continue;
    }

    // Range: a-b
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number);
      if (isNaN(a!) || isNaN(b!) || a! > b!) throw new CronParseError(`Invalid range "${part}"`);
      range(a!, b!).forEach((n) => values.add(n));
      continue;
    }

    // Single value
    const v = parseInt(part, 10);
    if (isNaN(v)) throw new CronParseError(`Invalid cron value "${part}"`);
    values.add(v);
  }

  const sorted = Array.from(values).sort((a, b) => a - b);
  if (sorted.some((v) => v < lo || v > hi)) {
    throw new CronParseError(`Value out of range [${lo}-${hi}] in field "${field}"`);
  }
  return sorted;
}

export function parseCronExpression(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronParseError(
      `Expected 5-field cron expression (min hour dom month dow), got ${parts.length} fields: "${expression}"`,
    );
  }

  const [minStr, hourStr, domStr, monthStr, dowStr] = parts as [string, string, string, string, string];

  const dows = expandField(dowStr, 0, 7);
  // Normalise 7 → 0 (both mean Sunday)
  const normDows = Array.from(new Set(dows.map((d) => d === 7 ? 0 : d))).sort((a, b) => a - b);

  return {
    minutes: expandField(minStr,   0, 59),
    hours:   expandField(hourStr,  0, 23),
    doms:    expandField(domStr,   1, 31),
    months:  expandField(monthStr, 1, 12),
    dows:    normDows,
  };
}

// ---------------------------------------------------------------------------
// IANA timezone helpers (no getTimezoneOffset)
// ---------------------------------------------------------------------------

interface LocalParts {
  year: number;
  month: number;   // 1-based
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getDtf(timezone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timezone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year:     'numeric',
      month:    '2-digit',
      day:      '2-digit',
      hour:     '2-digit',
      minute:   '2-digit',
      second:   '2-digit',
      hour12:   false,
    });
    dtfCache.set(timezone, dtf);
  }
  return dtf;
}

function utcToLocal(utc: Date, timezone: string): LocalParts {
  const dtf = getDtf(timezone);
  const parts = dtf.formatToParts(utc);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)!.value, 10);
  let hour = get('hour');
  // Intl hour12:false can return 24 for midnight in some implementations
  if (hour === 24) hour = 0;
  return {
    year:   get('year'),
    month:  get('month'),
    day:    get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * localToUtc — convert a local broken-down time back to UTC.
 * Uses an estimate-and-correct approach to handle DST transitions
 * without ever calling getTimezoneOffset.
 *
 * Returns { utc, dstSkipped } where dstSkipped is true when the
 * requested local time doesn't exist (spring-forward gap).
 */
function localToUtc(
  local: LocalParts,
  timezone: string,
): { utc: Date; dstSkipped: boolean; utcOffsetMs: number } {
  // Build a UTC candidate as if the local time were UTC.
  const naiveUtcMs = Date.UTC(
    local.year, local.month - 1, local.day,
    local.hour, local.minute, local.second,
  );

  // First estimate: use the naive UTC to probe the timezone.
  const estimate = new Date(naiveUtcMs);
  const localOfEstimate = utcToLocal(estimate, timezone);
  const diffMs = (
    Date.UTC(localOfEstimate.year, localOfEstimate.month - 1, localOfEstimate.day,
              localOfEstimate.hour, localOfEstimate.minute, localOfEstimate.second) -
    naiveUtcMs
  );
  // Corrected UTC = naive - diff
  const correctedUtcMs = naiveUtcMs - diffMs;
  const corrected = new Date(correctedUtcMs);

  // Verify: round-trip to catch DST boundary edge cases.
  const verify = utcToLocal(corrected, timezone);
  const matches = (
    verify.year   === local.year &&
    verify.month  === local.month &&
    verify.day    === local.day &&
    verify.hour   === local.hour &&
    verify.minute === local.minute
  );

  if (matches) {
    return { utc: corrected, dstSkipped: false, utcOffsetMs: -diffMs };
  }

  // The local time doesn't exist (spring-forward gap).
  // Advance to the next valid instant (start of the resumed hour).
  const skippedUtc = new Date(correctedUtcMs + 3600_000); // +1h heuristic
  return { utc: skippedUtc, dstSkipped: true, utcOffsetMs: -diffMs };
}

function utcOffsetString(offsetMs: number): string {
  const sign = offsetMs >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMs);
  const h = Math.floor(abs / 3_600_000).toString().padStart(2, '0');
  const m = Math.floor((abs % 3_600_000) / 60_000).toString().padStart(2, '0');
  return `${sign}${h}:${m}`;
}

// ---------------------------------------------------------------------------
// dow of a date in a given timezone
// ---------------------------------------------------------------------------

function localDowOf(utc: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const str = dtf.format(utc);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[str] ?? 0;
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Compute the next UTC fire time for a cron expression after a given UTC time.
 *
 * Algorithm (minute-by-minute advancement):
 *   1. Convert `after` to local time in `timezone`.
 *   2. Advance by 1 minute (exclusive lower bound).
 *   3. Check month, dom, dow, hour, minute against the cron fields.
 *   4. On match, convert back to UTC. Handle DST gap (fire at next valid instant)
 *      and DST repeat (fire on first occurrence — standard time wins).
 *   5. If result UTC ≤ after (fell in DST repeat), advance 1 minute and retry once.
 */
export function computeNextFireAt(opts: CronNextFireOptions): CronNextFireResult {
  const { expression, timezone, after, maxIterations = 10_000 } = opts;
  const fields = parseCronExpression(expression);

  // Validate timezone — throws RangeError for invalid strings.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new CronParseError(`Invalid IANA timezone: "${timezone}"`);
  }

  // Start 1 minute after `after` (exclusive bound).
  let cursor = new Date(after.getTime() + 60_000);
  // Truncate to minute boundary.
  cursor = new Date(Math.floor(cursor.getTime() / 60_000) * 60_000);

  for (let i = 0; i < maxIterations; i++) {
    const local = utcToLocal(cursor, timezone);

    // Month check (1-based)
    if (!fields.months.includes(local.month)) {
      // Advance to 1st of next valid month at 00:00 local.
      const nextMonthIdx = fields.months.findIndex((m) => m > local.month);
      const nextMonth = nextMonthIdx >= 0
        ? fields.months[nextMonthIdx]!
        : fields.months[0]!;
      const nextYear = nextMonthIdx >= 0 ? local.year : local.year + 1;
      const { utc } = localToUtc({ year: nextYear, month: nextMonth, day: 1, hour: 0, minute: 0, second: 0 }, timezone);
      cursor = utc;
      continue;
    }

    // DOM check
    if (!fields.doms.includes(local.day)) {
      // Advance to next day at 00:00 local.
      const { utc } = localToUtc({ ...local, day: local.day + 1, hour: 0, minute: 0, second: 0 }, timezone);
      // If localToUtc pushed past the month, we'll re-check on the next iteration.
      cursor = utc;
      continue;
    }

    // DOW check
    const dow = localDowOf(cursor, timezone);
    if (!fields.dows.includes(dow)) {
      const daysUntilNextDow = (() => {
        for (let d = 1; d <= 7; d++) {
          if (fields.dows.includes((dow + d) % 7)) return d;
        }
        return 1;
      })();
      const { utc } = localToUtc({ ...local, day: local.day + daysUntilNextDow, hour: 0, minute: 0, second: 0 }, timezone);
      cursor = utc;
      continue;
    }

    // Hour check
    if (!fields.hours.includes(local.hour)) {
      const nextHourIdx = fields.hours.findIndex((h) => h > local.hour);
      if (nextHourIdx >= 0) {
        const { utc } = localToUtc({ ...local, hour: fields.hours[nextHourIdx]!, minute: 0, second: 0 }, timezone);
        cursor = utc;
      } else {
        // Next valid hour is tomorrow.
        const { utc } = localToUtc({ ...local, day: local.day + 1, hour: fields.hours[0]!, minute: 0, second: 0 }, timezone);
        cursor = utc;
      }
      continue;
    }

    // Minute check
    if (!fields.minutes.includes(local.minute)) {
      const nextMinIdx = fields.minutes.findIndex((m) => m > local.minute);
      if (nextMinIdx >= 0) {
        const { utc } = localToUtc({ ...local, minute: fields.minutes[nextMinIdx]!, second: 0 }, timezone);
        cursor = utc;
      } else {
        // Next valid minute is in the next valid hour.
        const nextHourIdx = fields.hours.findIndex((h) => h > local.hour);
        if (nextHourIdx >= 0) {
          const { utc } = localToUtc({ ...local, hour: fields.hours[nextHourIdx]!, minute: fields.minutes[0]!, second: 0 }, timezone);
          cursor = utc;
        } else {
          const { utc } = localToUtc({ ...local, day: local.day + 1, hour: fields.hours[0]!, minute: fields.minutes[0]!, second: 0 }, timezone);
          cursor = utc;
        }
      }
      continue;
    }

    // All fields match — convert to UTC.
    const { utc, dstSkipped, utcOffsetMs } = localToUtc(
      { year: local.year, month: local.month, day: local.day, hour: local.hour, minute: local.minute, second: 0 },
      timezone,
    );

    // Guard against DST fall-back repeat: if utc is before `after`, advance 1 min.
    if (utc.getTime() <= after.getTime()) {
      cursor = new Date(cursor.getTime() + 60_000);
      continue;
    }

    return {
      nextUtc: utc,
      utcOffsetUsed: utcOffsetString(utcOffsetMs),
      dstSkipped,
    };
  }

  throw new CronIterationLimitError(expression, timezone);
}

// ---------------------------------------------------------------------------
// Minimum interval validator
// ---------------------------------------------------------------------------

const MIN_INTERVAL_MS = 3_600_000; // 1 hour

/**
 * Validate that a cron expression fires no more frequently than once per hour.
 * Returns true if valid; throws CronParseError if the interval is too short.
 */
export function validateMinimumInterval(expression: string, timezone: string = 'UTC'): void {
  const now = new Date();
  const first = computeNextFireAt({ expression, timezone, after: now });
  const second = computeNextFireAt({ expression, timezone, after: first.nextUtc });
  const intervalMs = second.nextUtc.getTime() - first.nextUtc.getTime();
  if (intervalMs < MIN_INTERVAL_MS) {
    throw new CronParseError(
      `Cron expression fires every ${Math.round(intervalMs / 60_000)} minutes — minimum interval is 60 minutes.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Cadence presets → cron expressions
// ---------------------------------------------------------------------------

export const CADENCE_PRESETS: Record<string, string> = {
  daily:   '0 8 * * *',     // 08:00 local time every day
  weekly:  '0 8 * * 1',     // 08:00 local time every Monday
  monthly: '0 8 1 * *',     // 08:00 local time on the 1st of every month
};

// Supported cadence values
export const ALLOWED_CADENCES = ['daily', 'weekly', 'monthly', 'custom'] as const;

/**
 * Build an occurrence key: deterministic SHA-256 of "tenantId:scheduleId:fireAtMinute".
 * fireAtMinute = UTC ISO string truncated to the minute (seconds zeroed).
 */
export function buildOccurrenceKey(tenantId: string, scheduleId: string, fireAt: Date): string {
  const { createHash } = require('crypto') as typeof import('crypto');
  const fireAtMinute = new Date(Math.floor(fireAt.getTime() / 60_000) * 60_000).toISOString();
  return createHash('sha256')
    .update(`${tenantId}:${scheduleId}:${fireAtMinute}`)
    .digest('hex');
}
