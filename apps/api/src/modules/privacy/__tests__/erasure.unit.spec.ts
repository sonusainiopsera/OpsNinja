/**
 * Unit tests for WO-085 AC9: retention class resolution, horizon computation,
 * erasure field enumeration completeness, and tombstone application.
 *
 * These tests are pure unit tests — no real Postgres or Redis required.
 * All external dependencies are mocked via jest.fn().
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  RETENTION_REGISTRY,
  getRetentionEntry,
  computeHorizon,
  expiredPartitionSuffixes,
  upcomingPartitionSuffixes,
  getByStrategy,
} from '../../../../../../packages/retention/src/retention-registry';
import { NotificationsEraser, NOTIFICATION_TOMBSTONE_EMAIL } from '../../notifications/notifications.eraser';
import { CsatEraser, CSAT_TOMBSTONE_COMMENT } from '../../csat/csat.eraser';
import { WebhooksEraser, WEBHOOK_TOMBSTONE_SNIPPET } from '../../webhooks/webhooks.eraser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockTx(executeResult: unknown = []) {
  return {
    execute: jest.fn().mockResolvedValue(executeResult),
  };
}

const TENANT_ID  = 'a0000000-0000-0000-0000-000000000001';
const CONTACT_ID = 'c0000000-0000-0000-0000-000000000001';
const EMAIL      = 'subject@example.invalid';

// ---------------------------------------------------------------------------
// Retention registry — resolution and validation
// ---------------------------------------------------------------------------

describe('RETENTION_REGISTRY', () => {
  it('contains entries for all required tables', () => {
    const requiredTables = [
      'notifications',
      'notification_templates',
      'notification_suppressions',
      'csat_surveys',
      'webhook_deliveries',
      'webhook_endpoints',
    ];
    for (const table of requiredTables) {
      expect(getRetentionEntry(table)).toBeDefined();
    }
  });

  it('all drop_partition entries have horizonDays', () => {
    const bad = RETENTION_REGISTRY.filter(
      (e) => e.strategy === 'drop_partition' && !e.horizonDays,
    );
    expect(bad).toHaveLength(0);
  });

  it('notifications entry has strategy drop_partition and horizonDays 90', () => {
    const entry = getRetentionEntry('notifications');
    expect(entry?.strategy).toBe('drop_partition');
    expect(entry?.horizonDays).toBe(90);
    expect(entry?.classification).toBe('confidential');
  });

  it('csat_surveys entry has strategy tombstone_on_erasure', () => {
    const entry = getRetentionEntry('csat_surveys');
    expect(entry?.strategy).toBe('tombstone_on_erasure');
    expect(entry?.classification).toBe('confidential');
  });

  it('webhook_deliveries entry has strategy drop_partition', () => {
    const entry = getRetentionEntry('webhook_deliveries');
    expect(entry?.strategy).toBe('drop_partition');
  });

  it('notification_suppressions has strategy admin_action_only', () => {
    const entry = getRetentionEntry('notification_suppressions');
    expect(entry?.strategy).toBe('admin_action_only');
  });

  it('getByStrategy returns correct subset', () => {
    const dropPartition = getByStrategy('drop_partition');
    expect(dropPartition.every((e) => e.strategy === 'drop_partition')).toBe(true);
    expect(dropPartition.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// computeHorizon — month boundary and DST handling
// ---------------------------------------------------------------------------

describe('computeHorizon()', () => {
  it('returns UTC midnight exactly horizonDays before now', () => {
    const now     = new Date('2025-03-15T14:30:00Z');
    const horizon = computeHorizon(90, now);
    expect(horizon.toISOString()).toBe('2024-12-15T00:00:00.000Z');
  });

  it('handles month boundary (30 days before March 1)', () => {
    const now     = new Date('2025-03-01T00:00:00Z');
    const horizon = computeHorizon(30, now);
    expect(horizon.toISOString()).toBe('2025-01-30T00:00:00.000Z');
  });

  it('handles leap year (1 day before March 1, 2024)', () => {
    const now     = new Date('2024-03-01T00:00:00Z');
    const horizon = computeHorizon(1, now);
    expect(horizon.toISOString()).toBe('2024-02-29T00:00:00.000Z');
  });

  it('always returns UTC midnight (no fractional seconds)', () => {
    const now     = new Date('2025-06-20T23:59:59.999Z');
    const horizon = computeHorizon(7, now);
    expect(horizon.getUTCHours()).toBe(0);
    expect(horizon.getUTCMinutes()).toBe(0);
    expect(horizon.getUTCSeconds()).toBe(0);
    expect(horizon.getUTCMilliseconds()).toBe(0);
  });

  it('handles horizonDays crossing year boundary', () => {
    const now     = new Date('2025-01-15T00:00:00Z');
    const horizon = computeHorizon(30, now);
    expect(horizon.getUTCFullYear()).toBe(2024);
    expect(horizon.getUTCMonth()).toBe(11); // December
  });
});

// ---------------------------------------------------------------------------
// expiredPartitionSuffixes
// ---------------------------------------------------------------------------

describe('expiredPartitionSuffixes()', () => {
  it('returns monthly suffixes older than the cutoff, not the cutoff month', () => {
    const cutoff   = new Date('2025-03-01T00:00:00Z');
    const suffixes = expiredPartitionSuffixes(cutoff, 3);
    expect(suffixes).toContain('2025_02');
    expect(suffixes).toContain('2025_01');
    expect(suffixes).toContain('2024_12');
    expect(suffixes).not.toContain('2025_03');
  });

  it('returns all overdue partitions in one call (not just oldest)', () => {
    const cutoff   = new Date('2025-06-01T00:00:00Z');
    const suffixes = expiredPartitionSuffixes(cutoff, 6);
    // Should include Jan-May 2025 at minimum
    expect(suffixes).toContain('2025_05');
    expect(suffixes).toContain('2025_01');
  });
});

// ---------------------------------------------------------------------------
// upcomingPartitionSuffixes
// ---------------------------------------------------------------------------

describe('upcomingPartitionSuffixes()', () => {
  it('returns the next 3 months from the given date', () => {
    const now      = new Date('2025-01-15T00:00:00Z');
    const suffixes = upcomingPartitionSuffixes(3, now);
    expect(suffixes).toEqual(['2025_02', '2025_03', '2025_04']);
  });

  it('handles year boundary correctly', () => {
    const now      = new Date('2024-11-15T00:00:00Z');
    const suffixes = upcomingPartitionSuffixes(3, now);
    expect(suffixes).toContain('2024_12');
    expect(suffixes).toContain('2025_01');
    expect(suffixes).toContain('2025_02');
  });
});

// ---------------------------------------------------------------------------
// NotificationsEraser
// ---------------------------------------------------------------------------

describe('NotificationsEraser', () => {
  let eraser: NotificationsEraser;

  beforeEach(() => {
    eraser = new NotificationsEraser();
  });

  it('enumerate returns count from DB result (by email)', async () => {
    const tx = makeMockTx([{ count: '7' }]);
    const result = await eraser.enumerate(tx as never, {
      tenantId: TENANT_ID, email: EMAIL,
    });
    expect(result.notifications).toBe(7);
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it('enumerate returns 0 when no rows match', async () => {
    const tx = makeMockTx([{ count: '0' }]);
    const result = await eraser.enumerate(tx as never, {
      tenantId: TENANT_ID, email: EMAIL,
    });
    expect(result.notifications).toBe(0);
  });

  it('erase returns receipt with tombstone strategy and rowsAffected count', async () => {
    const ids = [{ id: 'n1' }, { id: 'n2' }];
    const tx  = makeMockTx(ids);
    const entry = await eraser.erase(tx as never, {
      tenantId: TENANT_ID, email: EMAIL,
    });
    expect(entry.table).toBe('notifications');
    expect(entry.strategy).toBe('tombstone');
    expect(entry.rowsAffected).toBe(2);
  });

  it('tombstone value is the expected constant', () => {
    expect(NOTIFICATION_TOMBSTONE_EMAIL).toBe('[erased]');
  });

  it('erase with contactId uses contactId in query', async () => {
    const tx = makeMockTx([{ id: 'n1' }]);
    await eraser.erase(tx as never, {
      tenantId: TENANT_ID, contactId: CONTACT_ID,
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// CsatEraser
// ---------------------------------------------------------------------------

describe('CsatEraser', () => {
  let eraser: CsatEraser;

  beforeEach(() => {
    eraser = new CsatEraser();
  });

  it('enumerate returns count from DB result', async () => {
    const tx = makeMockTx([{ count: '3' }]);
    const result = await eraser.enumerate(tx as never, {
      tenantId: TENANT_ID, contactId: CONTACT_ID,
    });
    expect(result.csatSurveys).toBe(3);
  });

  it('erase tombstones comment and nulls contact_id, returns receipt', async () => {
    const tx = makeMockTx([{ id: 's1' }, { id: 's2' }]);
    const entry = await eraser.erase(tx as never, {
      tenantId: TENANT_ID, contactId: CONTACT_ID,
    });
    expect(entry.table).toBe('csat_surveys');
    expect(entry.strategy).toBe('tombstone');
    expect(entry.rowsAffected).toBe(2);
  });

  it('tombstone comment value is the expected constant', () => {
    expect(CSAT_TOMBSTONE_COMMENT).toBe('[erased]');
  });

  it('erase with zero matching rows returns rowsAffected = 0', async () => {
    const tx = makeMockTx([]);
    const entry = await eraser.erase(tx as never, {
      tenantId: TENANT_ID, contactId: CONTACT_ID,
    });
    expect(entry.rowsAffected).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WebhooksEraser
// ---------------------------------------------------------------------------

describe('WebhooksEraser', () => {
  let eraser: WebhooksEraser;

  beforeEach(() => {
    eraser = new WebhooksEraser();
  });

  it('enumerate returns count from DB result', async () => {
    const tx = makeMockTx([{ count: '5' }]);
    const result = await eraser.enumerate(tx as never, {
      tenantId: TENANT_ID, subjectId: CONTACT_ID,
    });
    expect(result.webhookDeliveries).toBe(5);
  });

  it('erase returns receipt with tombstone strategy', async () => {
    const tx = makeMockTx([{ id: 'wd1' }]);
    const entry = await eraser.erase(tx as never, {
      tenantId: TENANT_ID, subjectId: CONTACT_ID,
    });
    expect(entry.table).toBe('webhook_deliveries');
    expect(entry.strategy).toBe('tombstone');
    expect(entry.rowsAffected).toBe(1);
  });

  it('tombstone snippet value is the expected constant', () => {
    expect(WEBHOOK_TOMBSTONE_SNIPPET).toBe('[erased]');
  });
});

// ---------------------------------------------------------------------------
// Erasure field enumeration completeness test (AC9)
// ---------------------------------------------------------------------------

describe('Erasure field enumeration completeness', () => {
  it('all confidential tombstone_on_erasure entries have an eraser contributor', () => {
    const tombstoneEntries = RETENTION_REGISTRY.filter(
      (e) => e.strategy === 'tombstone_on_erasure' && e.classification === 'confidential',
    );

    // The eraser contributors map must cover all such tables.
    const COVERED_TABLES = new Set([
      'csat_surveys',
      'notifications', // notifications use tombstone on erasure (even though purged by partition drop)
    ]);

    for (const entry of tombstoneEntries) {
      const covered = COVERED_TABLES.has(entry.table);
      if (!covered) {
        throw new Error(
          `Table '${entry.table}' has strategy 'tombstone_on_erasure' but no eraser contributor is registered. ` +
          `Add an eraser in the appropriate module and register it with the privacy orchestrator.`,
        );
      }
    }

    expect(tombstoneEntries.every((e) => COVERED_TABLES.has(e.table))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Anonymisation lint test (AC7)
// ---------------------------------------------------------------------------

describe('Anonymisation lint — email domain enforcement', () => {
  const REAL_EMAIL_PATTERN =
    /@(?!example\.com|example\.org|test\.invalid|example\.invalid)[a-z0-9.\-]+\.[a-z]{2,}/i;

  it('example.invalid emails pass the lint check', () => {
    const samples = [
      'user-1@example.invalid',
      'aged-user-0@example.invalid',
      'contact@example.com',
      'test@test.invalid',
    ];
    for (const email of samples) {
      expect(REAL_EMAIL_PATTERN.test(email)).toBe(false);
    }
  });

  it('real email domains fail the lint check', () => {
    const realEmails = ['user@gmail.com', 'support@company.io', 'admin@corp.net'];
    for (const email of realEmails) {
      expect(REAL_EMAIL_PATTERN.test(email)).toBe(true);
    }
  });
});
