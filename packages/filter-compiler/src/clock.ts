/**
 * Clock abstraction for deterministic relative-date resolution.
 * Inject SystemClock in production; inject FixedClock in tests.
 */

export interface Clock {
  now(): Date;
}

export const SystemClock: Clock = {
  now: () => new Date(),
};

export class FixedClock implements Clock {
  constructor(private readonly fixedDate: Date) {}
  now(): Date {
    return this.fixedDate;
  }
}

export const RELATIVE_DATE_TOKENS = [
  'today',
  'yesterday',
  'this_week',
  'this_month',
  'this_year',
  'last_7_days',
  'last_30_days',
  'last_90_days',
] as const;

export type RelativeDateToken = (typeof RELATIVE_DATE_TOKENS)[number];

export function isRelativeDateToken(value: unknown): value is RelativeDateToken {
  return (
    typeof value === 'string' &&
    (RELATIVE_DATE_TOKENS as readonly string[]).includes(value)
  );
}

/** Resolve a relative date token to an absolute Date against the injected clock. */
export function resolveRelativeDate(token: RelativeDateToken, clock: Clock): Date {
  const now = clock.now();
  switch (token) {
    case 'today': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d;
    }
    case 'yesterday': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - 1);
      return d;
    }
    case 'this_week': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - d.getDay());
      return d;
    }
    case 'this_month': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(1);
      return d;
    }
    case 'this_year': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setMonth(0, 1);
      return d;
    }
    case 'last_7_days': {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d;
    }
    case 'last_30_days': {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return d;
    }
    case 'last_90_days': {
      const d = new Date(now);
      d.setDate(d.getDate() - 90);
      return d;
    }
  }
}
