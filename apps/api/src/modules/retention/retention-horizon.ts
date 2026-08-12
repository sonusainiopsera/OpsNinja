/**
 * Retention horizon computation — WO-095.
 *
 * Pure functions for computing retention cutoff dates and selecting eligible
 * partitions.  No I/O — fully unit-testable.
 *
 * Constraint: UTC normalisation only; never calls getTimezoneOffset().
 * All dates are treated as UTC midnight boundaries.
 */

/** Result of a partition eligibility check. */
export interface PartitionEligibility {
  /** Partition name e.g. 'notifications_2024_12'. */
  name:     string;
  /** Lower bound of the partition range (inclusive). */
  lowerAt:  Date;
  /** Upper bound of the partition range (exclusive). */
  upperAt:  Date;
  /** True iff the entire partition is before the horizon. */
  eligible: boolean;
}

/**
 * Compute the UTC cutoff date for a given retention horizon.
 *
 * @param horizonDays  - Retention period in days.
 * @param now          - Reference timestamp (injected for testing).
 * @returns UTC midnight of (now - horizonDays), i.e. rows created before this
 *          date are eligible for purge.
 */
export function computeRetentionHorizon(horizonDays: number, now: Date = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - horizonDays);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff;
}

/**
 * Parse a monthly partition suffix into a start and end Date.
 *
 * Partition names follow the convention '<table>_YYYY_MM'.
 * Returns null if the suffix cannot be parsed.
 */
export function parsePartitionSuffix(suffix: string): { lowerAt: Date; upperAt: Date } | null {
  const match = suffix.match(/(\d{4})_(\d{2})$/);
  if (!match) return null;

  const year  = parseInt(match[1]!, 10);
  const month = parseInt(match[2]!, 10);
  if (month < 1 || month > 12) return null;

  const lowerAt = new Date(Date.UTC(year, month - 1, 1));
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear  = month === 12 ? year + 1 : year;
  const upperAt   = new Date(Date.UTC(nextYear, nextMonth - 1, 1));

  return { lowerAt, upperAt };
}

/**
 * Given a list of partition names and a horizon date, return eligibility info
 * for each partition.
 *
 * A partition is eligible when its entire date range lies before the horizon:
 *   upperAt <= horizon
 *
 * A partition that straddles the horizon (lowerAt < horizon < upperAt) is
 * NOT eligible — only fully expired partitions qualify.
 *
 * @param partitions  - Partition names to evaluate.
 * @param horizon     - Cutoff date; rows/partitions before this are purgeable.
 */
export function selectEligiblePartitions(
  partitions: string[],
  horizon: Date,
): PartitionEligibility[] {
  return partitions.map((name) => {
    const parsed = parsePartitionSuffix(name);
    if (!parsed) {
      return { name, lowerAt: new Date(0), upperAt: new Date(0), eligible: false };
    }
    const { lowerAt, upperAt } = parsed;
    return {
      name,
      lowerAt,
      upperAt,
      eligible: upperAt <= horizon,
    };
  });
}

/**
 * Generate the list of monthly partition names (YYYY_MM) that have expired
 * relative to the horizon, scanning back up to `lookback` months.
 *
 * This is the inverse of upcomingPartitionSuffixes from the retention package.
 */
export function expiredMonthlyPartitions(
  tableName: string,
  horizon: Date,
  lookback = 24,
): string[] {
  const names: string[] = [];
  const ref = new Date(horizon);
  // Start from the month *before* the horizon month (horizon month might straddle).
  ref.setUTCDate(1);
  ref.setUTCHours(0, 0, 0, 0);
  // Step back one month from the horizon
  ref.setUTCMonth(ref.getUTCMonth() - 1);

  for (let i = 0; i < lookback; i++) {
    const y = ref.getUTCFullYear().toString();
    const m = String(ref.getUTCMonth() + 1).padStart(2, '0');
    names.push(`${tableName}_${y}_${m}`);
    ref.setUTCMonth(ref.getUTCMonth() - 1);
  }
  return names;
}
