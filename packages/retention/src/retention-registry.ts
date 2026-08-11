/**
 * Retention Registry — WO-085.
 *
 * Single declarative source of truth for every table in the notification,
 * CSAT and webhook subsystems. The CI test reflects over these schemas and
 * fails if any table lacks a registry entry.
 *
 * Strategy semantics:
 *   drop_partition       — ALTER TABLE DETACH PARTITION + DROP TABLE for monthly
 *                          range-partitioned tables (notifications, webhook_deliveries).
 *   batch_delete         — bounded DELETE … WHERE created_at < cutoff LIMIT N loop.
 *   tombstone_on_erasure — row is retained for aggregation; PII fields are overwritten
 *                          with [erased] on GDPR erasure request only. No time-based purge.
 *   admin_action_only    — no automated purge; only removed by explicit admin action.
 *
 * Classification matches the platform data-classification tiers:
 *   confidential — highest; requires tombstone or crypto-shred on erasure.
 *   internal     — operational metadata; physical delete when horizon passes.
 *   operational  — aggregate-safe; tombstone preserves analytical value.
 */

export type RetentionStrategy =
  | 'drop_partition'
  | 'batch_delete'
  | 'tombstone_on_erasure'
  | 'admin_action_only';

export type DataClassification = 'confidential' | 'internal' | 'operational';

export interface RetentionEntry {
  /** Postgres table name. */
  table: string;
  /** True when tenant_id scopes the row and RLS applies. */
  tenantScoped: boolean;
  strategy: RetentionStrategy;
  /**
   * Number of days before rows / partitions become eligible for purge.
   * Required for drop_partition and batch_delete; omitted for others.
   */
  horizonDays?: number;
  classification: DataClassification;
  /** Human-readable rationale for auditors. */
  rationale: string;
}

/**
 * Retention registry for all tables introduced by this epic.
 *
 * Rule: every table in packages/db/src/schema/notifications.ts,
 * packages/db/src/schema/csat.ts and packages/db/src/schema/webhook-deliveries.ts
 * MUST appear here. The CI test enforces this.
 */
export const RETENTION_REGISTRY: readonly RetentionEntry[] = Object.freeze([
  // ── notifications ──────────────────────────────────────────────────────────
  {
    table:          'notifications',
    tenantScoped:   true,
    strategy:       'drop_partition',
    horizonDays:    90,
    classification: 'confidential',
    rationale:      'Contains recipient_email (PII). Range-partitioned monthly; partitions older than 90 days are detached and dropped.',
  },
  {
    table:          'notification_templates',
    tenantScoped:   true,
    strategy:       'admin_action_only',
    classification: 'internal',
    rationale:      'Template configuration; no time-bounded PII. Retained until explicitly deleted by admin.',
  },
  {
    table:          'notification_suppressions',
    tenantScoped:   true,
    strategy:       'admin_action_only',
    classification: 'confidential',
    rationale:      'Stores email_hash for bounce/complaint suppression. Retained until removed by administrator action to prevent re-sending to bounced addresses.',
  },

  // ── csat_surveys ───────────────────────────────────────────────────────────
  {
    table:          'csat_surveys',
    tenantScoped:   true,
    strategy:       'tombstone_on_erasure',
    classification: 'confidential',
    rationale:      'Contains free-text comment and contact_id linkage (PII). Score and timestamps retained for aggregate reporting; text fields tombstoned on erasure request.',
  },

  // ── webhook_deliveries ─────────────────────────────────────────────────────
  {
    table:          'webhook_deliveries',
    tenantScoped:   true,
    strategy:       'drop_partition',
    horizonDays:    parseInt(process.env['WEBHOOK_DELIVERIES_RETENTION_DAYS'] ?? '30', 10),
    classification: 'internal',
    rationale:      'Delivery attempt log including response_snippet and canonical_payload. Configurable horizon, default 30 days.',
  },
  {
    table:          'webhook_endpoints',
    tenantScoped:   true,
    strategy:       'admin_action_only',
    classification: 'internal',
    rationale:      'Endpoint configuration (URL, encrypted secret). Retained until deleted by admin; soft-deleted rows eligible for physical purge after 90 days.',
  },
] as const);

/** Look up a registry entry by table name. Returns undefined if not declared. */
export function getRetentionEntry(tableName: string): RetentionEntry | undefined {
  return RETENTION_REGISTRY.find((e) => e.table === tableName);
}

/** Return all entries for a given strategy type. */
export function getByStrategy(strategy: RetentionStrategy): RetentionEntry[] {
  return RETENTION_REGISTRY.filter((e) => e.strategy === strategy);
}

/**
 * Compute the UTC cutoff Date for a given horizon in days.
 * Exported separately so tests can inject a reference timestamp.
 */
export function computeHorizon(
  horizonDays: number,
  now: Date = new Date(),
): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - horizonDays);
  cutoff.setUTCHours(0, 0, 0, 0);
  return cutoff;
}

/**
 * Compute the list of monthly partition suffixes (YYYY_MM) that are older than
 * the given cutoff date.  Partitions are named <table>_YYYY_MM.
 *
 * @param cutoff   - rows older than this date are eligible
 * @param lookback - how many months back to consider (default 24)
 */
export function expiredPartitionSuffixes(
  cutoff: Date,
  lookback = 24,
): string[] {
  const suffixes: string[] = [];
  const ref = new Date(cutoff);
  ref.setUTCDate(1);
  ref.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < lookback; i++) {
    const y = ref.getUTCFullYear().toString();
    const m = String(ref.getUTCMonth() + 1).padStart(2, '0');
    suffixes.push(`${y}_${m}`);
    ref.setUTCMonth(ref.getUTCMonth() - 1);
  }
  return suffixes;
}

/**
 * Compute the next N monthly partition names (YYYY_MM) that should exist.
 * Used to pre-create partitions before the current month rolls over.
 */
export function upcomingPartitionSuffixes(lookahead = 3, now: Date = new Date()): string[] {
  const suffixes: string[] = [];
  const ref = new Date(now);
  ref.setUTCDate(1);
  ref.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < lookahead; i++) {
    ref.setUTCMonth(ref.getUTCMonth() + 1);
    const y = ref.getUTCFullYear().toString();
    const m = String(ref.getUTCMonth() + 1).padStart(2, '0');
    suffixes.push(`${y}_${m}`);
  }
  return suffixes;
}
