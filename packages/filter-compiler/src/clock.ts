/**
 * Clock interface injected into compileToPredicate so tests are deterministic.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export type RelativeDateToken =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'this_week'
  | 'this_month'
  | 'this_quarter'
  | 'this_year';

export const RELATIVE_DATE_TOKENS = new Set<string>([
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'this_week',
  'this_month',
  'this_quarter',
  'this_year',
]);

export function isRelativeDateToken(value: unknown): value is RelativeDateToken {
  return typeof value === 'string' && RELATIVE_DATE_TOKENS.has(value);
}

/**
 * Resolves a relative date token to a [start, end] ISO date range using the given clock.
 * All boundaries are inclusive and aligned to midnight UTC.
 */
export function resolveRelativeToken(token: RelativeDateToken, clock: Clock): [string, string] {
  const now = clock.now();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();

  function startOf(d: Date): string {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  }
  function endOfDay(d: Date): string {
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
    ).toISOString();
  }

  const today = new Date(Date.UTC(year, month, day));

  switch (token) {
    case 'today':
      return [startOf(today), endOfDay(today)];

    case 'yesterday': {
      const y = new Date(Date.UTC(year, month, day - 1));
      return [startOf(y), endOfDay(y)];
    }

    case 'last_7_days': {
      const start = new Date(Date.UTC(year, month, day - 6));
      return [startOf(start), endOfDay(today)];
    }

    case 'last_30_days': {
      const start = new Date(Date.UTC(year, month, day - 29));
      return [startOf(start), endOfDay(today)];
    }

    case 'last_90_days': {
      const start = new Date(Date.UTC(year, month, day - 89));
      return [startOf(start), endOfDay(today)];
    }

    case 'this_week': {
      const dow = now.getUTCDay(); // 0=Sun
      const start = new Date(Date.UTC(year, month, day - dow));
      return [startOf(start), endOfDay(today)];
    }

    case 'this_month': {
      const start = new Date(Date.UTC(year, month, 1));
      return [startOf(start), endOfDay(today)];
    }

    case 'this_quarter': {
      const qStart = Math.floor(month / 3) * 3;
      const start = new Date(Date.UTC(year, qStart, 1));
      return [startOf(start), endOfDay(today)];
    }

    case 'this_year': {
      const start = new Date(Date.UTC(year, 0, 1));
      return [startOf(start), endOfDay(today)];
    }
  }
}
