/**
 * Partition date utilities.
 *
 * Generates Date values that span the configured window so that partitioned
 * tables (tickets, ticket_comments, audit_logs) have rows in multiple monthly
 * partitions. Also generates one date beyond the retention horizon to test
 * the nightly purge job.
 */

export interface PartitionWindow {
  /** Inclusive start: `monthsBack` months before now. */
  start: Date;
  /** Inclusive end: `monthsForward` months after now. */
  end: Date;
  /** One date beyond the 7-year retention horizon for purge testing. */
  beyondRetention: Date;
  /** All distinct monthly partition labels within the window (YYYY-MM). */
  partitionLabels: string[];
}

/** Seven-year retention horizon in months. */
const RETENTION_MONTHS = 84;

/**
 * Compute the partition window for a given profile.
 */
export function buildPartitionWindow(
  monthsBack: number,
  monthsForward: number,
  referenceDate?: Date,
): PartitionWindow {
  const now = referenceDate ?? new Date();

  const start = addMonths(now, -monthsBack);
  const end = addMonths(now, monthsForward);
  const beyondRetention = addMonths(now, -(RETENTION_MONTHS + 1));

  const partitionLabels = collectMonthLabels(start, end);

  return { start, end, beyondRetention, partitionLabels };
}

/**
 * Pick a random date within the window using the provided random fn.
 * Deliberately includes the beyondRetention date with ~2% probability.
 */
export function pickPartitionDate(
  window: PartitionWindow,
  random: () => number,
): Date {
  if (random() < 0.02) {
    return window.beyondRetention;
  }
  const span = window.end.getTime() - window.start.getTime();
  return new Date(window.start.getTime() + Math.floor(random() * span));
}

/**
 * Evenly distribute `count` dates across the window, ensuring every partition
 * has at least one row.
 */
export function spreadAcrossPartitions(
  count: number,
  window: PartitionWindow,
  random: () => number,
): Date[] {
  const { partitionLabels, start, end, beyondRetention } = window;
  const dates: Date[] = [];

  // Guarantee at least one row per partition
  for (const label of partitionLabels) {
    const [year, month] = label.split('-').map(Number) as [number, number];
    const partStart = new Date(year, month - 1, 1);
    const partEnd = new Date(year, month, 0, 23, 59, 59); // last day
    dates.push(randomBetween(partStart, partEnd, random));
  }

  // Include one beyond-retention date
  dates.push(beyondRetention);

  // Fill remaining count with random dates in the window
  const remaining = Math.max(0, count - dates.length);
  const span = end.getTime() - start.getTime();
  for (let i = 0; i < remaining; i++) {
    dates.push(new Date(start.getTime() + Math.floor(random() * span)));
  }

  return dates;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function collectMonthLabels(start: Date, end: Date): string[] {
  const labels: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= endMonth) {
    labels.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`,
    );
    cur.setMonth(cur.getMonth() + 1);
  }
  return labels;
}

function randomBetween(start: Date, end: Date, random: () => number): Date {
  const span = end.getTime() - start.getTime();
  return new Date(start.getTime() + Math.floor(random() * span));
}
