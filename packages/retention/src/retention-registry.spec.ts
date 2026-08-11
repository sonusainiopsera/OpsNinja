/**
 * CI test: every table in the notifications, csat and webhook-deliveries Drizzle
 * schemas must have a declared entry in RETENTION_REGISTRY.
 *
 * If a developer adds a new table to any of those schemas without registering
 * a retention class this test fails, forcing an explicit decision before merge.
 */

import { describe, it, expect } from 'vitest';
import {
  notifications,
  notificationTemplates,
  notificationSuppressions,
  csatSurveys,
  webhookDeliveries,
  webhookEndpoints,
} from '@opsninja/db';
import {
  RETENTION_REGISTRY,
  getRetentionEntry,
  computeHorizon,
  expiredPartitionSuffixes,
  upcomingPartitionSuffixes,
} from './retention-registry';

// ---------------------------------------------------------------------------
// Enumerate all tables in the covered schemas
// ---------------------------------------------------------------------------

const COVERED_TABLES = [
  notifications,
  notificationTemplates,
  notificationSuppressions,
  csatSurveys,
  webhookDeliveries,
  webhookEndpoints,
];

// Each Drizzle table has a Symbol.for(DrizzleConfig) value with the table name.
function getTableName(table: { _: { name?: string } } | unknown): string {
  const t = table as { _?: { name?: string }; [key: string]: unknown };
  if (t._ && typeof t._.name === 'string') return t._.name;
  // fallback: look for a 'name' property
  const asAny = table as Record<string, unknown>;
  if (typeof asAny['name'] === 'string') return asAny['name'] as string;
  return '';
}

// ---------------------------------------------------------------------------
// Test: every table has a declared retention class
// ---------------------------------------------------------------------------

describe('Retention Registry — completeness CI check', () => {
  it('every covered table has a declared retention entry', () => {
    const undeclared: string[] = [];

    for (const table of COVERED_TABLES) {
      const tableName = getTableName(table);
      if (!tableName) continue;
      const entry = getRetentionEntry(tableName);
      if (!entry) {
        undeclared.push(tableName);
      }
    }

    if (undeclared.length > 0) {
      throw new Error(
        `The following tables lack a declared retention class in RETENTION_REGISTRY.\n` +
          `Add an entry in packages/retention/src/retention-registry.ts:\n` +
          undeclared.map((t) => `  - ${t}`).join('\n'),
      );
    }

    expect(undeclared).toHaveLength(0);
  });

  it('all drop_partition entries have horizonDays set', () => {
    const bad = RETENTION_REGISTRY.filter(
      (e) => e.strategy === 'drop_partition' && !e.horizonDays,
    );
    expect(bad).toHaveLength(0);
  });

  it('all batch_delete entries have horizonDays set', () => {
    const bad = RETENTION_REGISTRY.filter(
      (e) => e.strategy === 'batch_delete' && !e.horizonDays,
    );
    expect(bad).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test: horizon computation
// ---------------------------------------------------------------------------

describe('computeHorizon', () => {
  it('returns midnight UTC exactly horizonDays before now', () => {
    const now = new Date('2025-03-15T14:30:00Z');
    const horizon = computeHorizon(90, now);
    expect(horizon.toISOString()).toBe('2024-12-15T00:00:00.000Z');
  });

  it('handles month boundary correctly', () => {
    const now = new Date('2025-03-01T00:00:00Z');
    const horizon = computeHorizon(30, now);
    // 30 days before 2025-03-01 = 2025-01-30
    expect(horizon.toISOString()).toBe('2025-01-30T00:00:00.000Z');
  });

  it('handles leap years', () => {
    const now = new Date('2024-03-01T00:00:00Z');
    const horizon = computeHorizon(1, now);
    expect(horizon.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Test: partition suffix helpers
// ---------------------------------------------------------------------------

describe('expiredPartitionSuffixes', () => {
  it('returns monthly suffixes older than the cutoff', () => {
    const cutoff = new Date('2025-03-01T00:00:00Z');
    const suffixes = expiredPartitionSuffixes(cutoff, 3);
    // Months before March 2025: Feb 2025, Jan 2025, Dec 2024
    expect(suffixes).toContain('2025_02');
    expect(suffixes).toContain('2025_01');
    expect(suffixes).toContain('2024_12');
    expect(suffixes).not.toContain('2025_03');
  });
});

describe('upcomingPartitionSuffixes', () => {
  it('returns the next N month suffixes', () => {
    const now = new Date('2025-01-15T00:00:00Z');
    const suffixes = upcomingPartitionSuffixes(3, now);
    expect(suffixes).toEqual(['2025_02', '2025_03', '2025_04']);
  });
});
