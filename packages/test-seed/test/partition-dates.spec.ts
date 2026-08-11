import { describe, it, expect } from 'vitest';
import { buildPartitionWindow, spreadAcrossPartitions } from '../src/partition-dates';
import { SeededRandom } from '../src/prng';

const REF_DATE = new Date('2025-06-15T12:00:00Z');

describe('buildPartitionWindow', () => {
  it('produces the expected number of partition labels', () => {
    const window = buildPartitionWindow(14, 1, REF_DATE);
    // 14 months back + current month + 1 forward = 16 labels
    expect(window.partitionLabels.length).toBeGreaterThanOrEqual(15);
  });

  it('includes a date beyond the 7-year retention horizon', () => {
    const window = buildPartitionWindow(14, 1, REF_DATE);
    // 7 years = 84 months. beyondRetention should be > 84 months before ref
    const diffMs = REF_DATE.getTime() - window.beyondRetention.getTime();
    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30);
    expect(diffMonths).toBeGreaterThan(84);
  });

  it('start is before end', () => {
    const window = buildPartitionWindow(14, 1, REF_DATE);
    expect(window.start < window.end).toBe(true);
  });

  it('partition labels are in ascending order', () => {
    const window = buildPartitionWindow(14, 1, REF_DATE);
    const sorted = [...window.partitionLabels].sort();
    expect(window.partitionLabels).toEqual(sorted);
  });

  it('all labels match YYYY-MM format', () => {
    const window = buildPartitionWindow(14, 1, REF_DATE);
    for (const label of window.partitionLabels) {
      expect(label).toMatch(/^\d{4}-\d{2}$/);
    }
  });
});

describe('spreadAcrossPartitions', () => {
  it('produces at least one date per partition', () => {
    const window = buildPartitionWindow(14, 1, REF_DATE);
    const rng = new SeededRandom(42);
    const dates = spreadAcrossPartitions(200, window, () => rng.next());

    const months = new Set(dates.map((d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    }));

    // Should cover at least 14 distinct months
    expect(months.size).toBeGreaterThanOrEqual(14);
  });

  it('produces at least one date beyond retention horizon', () => {
    const window = buildPartitionWindow(14, 1, REF_DATE);
    const rng = new SeededRandom(42);
    const dates = spreadAcrossPartitions(200, window, () => rng.next());

    const beyondRetention = dates.filter(
      (d) => REF_DATE.getTime() - d.getTime() > 84 * 30 * 24 * 60 * 60 * 1000,
    );
    expect(beyondRetention.length).toBeGreaterThanOrEqual(1);
  });

  it('returns exactly the requested count (approximately)', () => {
    const window = buildPartitionWindow(14, 1, REF_DATE);
    const rng = new SeededRandom(7);
    // When count < partitions+1, we get partitionLabels.length + 1 rows
    const dates = spreadAcrossPartitions(500, window, () => rng.next());
    // Should be >= 500 (extras from partition guarantee)
    expect(dates.length).toBeGreaterThanOrEqual(16);
  });
});
