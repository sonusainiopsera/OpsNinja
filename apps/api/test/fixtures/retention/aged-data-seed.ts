/**
 * Aged-data seed generator — WO-095 AC12.
 *
 * Produces multi-tenant data spanning 14 months across:
 *   - Partitioned categories (notifications, webhook_deliveries)
 *   - Non-partitioned categories (contacts, csat_surveys)
 *   - Pending erasure requests (subject_data_keys to shred)
 *
 * All identifiers are deterministic. No real PII — uses example.invalid domains.
 * Safe to run repeatedly (idempotent inserts via ON CONFLICT DO NOTHING).
 */

// ---------------------------------------------------------------------------
// Fixed deterministic identifiers
// ---------------------------------------------------------------------------

export const PURGE_TENANT_A  = 'aa000000-0000-0000-0000-000000000001';
export const PURGE_TENANT_B  = 'bb000000-0000-0000-0000-000000000001';

export const PURGE_CONTACT_A1 = 'ca000001-0000-0000-0000-000000000001';
export const PURGE_CONTACT_A2 = 'ca000002-0000-0000-0000-000000000001';
export const PURGE_CONTACT_B1 = 'cb000001-0000-0000-0000-000000000001';

export const PURGE_ERASURE_REQUEST_1 = 'er000001-0000-0000-0000-000000000001';
export const PURGE_ERASURE_REQUEST_2 = 'er000002-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Notification rows (partitioned by created_at month)
// ---------------------------------------------------------------------------

export interface SeedNotificationRow {
  id:              string;
  tenantId:        string;
  recipientEmail:  string;
  templateKey:     string;
  status:          string;
  createdAt:       Date;
  partitionMonth:  string;  // YYYY_MM
}

/**
 * Generate notification rows spread across 14 months.
 * Months 1-3 are within retention horizon (90d), months 4+ are expired.
 */
export function buildSeedNotifications(
  tenantId: string,
  totalMonths = 14,
  rowsPerMonth = 5,
): SeedNotificationRow[] {
  const rows: SeedNotificationRow[] = [];
  const now = new Date();

  for (let m = 1; m <= totalMonths; m++) {
    const ref = new Date(now);
    ref.setUTCDate(15);
    ref.setUTCMonth(ref.getUTCMonth() - m);

    const y = ref.getUTCFullYear().toString();
    const mo = String(ref.getUTCMonth() + 1).padStart(2, '0');
    const suffix = `${y}_${mo}`;

    for (let i = 0; i < rowsPerMonth; i++) {
      rows.push({
        id:             `notif-seed-m${m}-${String(i).padStart(3, '0')}-${tenantId.slice(0, 8)}`,
        tenantId,
        recipientEmail: `seed-user-${m}-${i}@example.invalid`,
        templateKey:    'ticket.created',
        status:         'sent',
        createdAt:      new Date(ref.getTime() + i * 60_000),
        partitionMonth: suffix,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Webhook delivery rows (partitioned, 30d horizon)
// ---------------------------------------------------------------------------

export interface SeedWebhookRow {
  id:              string;
  tenantId:        string;
  endpointId:      string;
  eventType:       string;
  status:          string;
  createdAt:       Date;
  partitionMonth:  string;
}

export function buildSeedWebhookDeliveries(
  tenantId: string,
  totalMonths = 14,
  rowsPerMonth = 3,
): SeedWebhookRow[] {
  const rows: SeedWebhookRow[] = [];
  const now = new Date();

  for (let m = 1; m <= totalMonths; m++) {
    const ref = new Date(now);
    ref.setUTCDate(10);
    ref.setUTCMonth(ref.getUTCMonth() - m);

    const y = ref.getUTCFullYear().toString();
    const mo = String(ref.getUTCMonth() + 1).padStart(2, '0');
    const suffix = `${y}_${mo}`;

    for (let i = 0; i < rowsPerMonth; i++) {
      rows.push({
        id:             `wh-seed-m${m}-${String(i).padStart(3, '0')}-${tenantId.slice(0, 8)}`,
        tenantId,
        endpointId:     `ep000001-0000-0000-0000-000000000001`,
        eventType:      'ticket.created',
        status:         'delivered',
        createdAt:      new Date(ref.getTime() + i * 120_000),
        partitionMonth: suffix,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// CSAT rows (non-partitioned, tombstone_on_erasure)
// ---------------------------------------------------------------------------

export interface SeedCsatRow {
  id:          string;
  tenantId:    string;
  contactId:   string;
  score:       number;
  comment:     string | null;
  createdAt:   Date;
}

const SYNTHETIC_CSAT_COMMENTS = [
  'Good support experience.',
  'Issue resolved quickly.',
  null,
  'Took a while but resolved.',
  'Excellent service.',
];

export function buildSeedCsatRows(
  tenantId: string,
  contactId: string,
  count = 10,
  offsetMonths = 2,
): SeedCsatRow[] {
  const now = new Date();
  const ref = new Date(now);
  ref.setUTCMonth(ref.getUTCMonth() - offsetMonths);

  return Array.from({ length: count }, (_, i) => ({
    id:        `csat-seed-${String(i).padStart(3, '0')}-${tenantId.slice(0, 8)}`,
    tenantId,
    contactId,
    score:     (i % 5) + 1,
    comment:   SYNTHETIC_CSAT_COMMENTS[i % SYNTHETIC_CSAT_COMMENTS.length] ?? null,
    createdAt: new Date(ref.getTime() + i * 3_600_000),
  }));
}

// ---------------------------------------------------------------------------
// Erasure request fixtures (subject_data_keys to shred)
// ---------------------------------------------------------------------------

export interface SeedErasureRequest {
  requestId:   string;
  tenantId:    string;
  subjectType: string;
  subjectId:   string;
  email:       string;
  kmsKeyArn:   string;
  wrappedDek:  string;
}

export const SEED_ERASURE_REQUESTS: SeedErasureRequest[] = [
  {
    requestId:   PURGE_ERASURE_REQUEST_1,
    tenantId:    PURGE_TENANT_A,
    subjectType: 'contact',
    subjectId:   PURGE_CONTACT_A1,
    email:       'erasure-a1@example.invalid',
    kmsKeyArn:   'arn:aws:kms:us-east-1:123456789012:key/test-key-a1',
    wrappedDek:  'base64encodedwrappeddekforA1==',
  },
  {
    requestId:   PURGE_ERASURE_REQUEST_2,
    tenantId:    PURGE_TENANT_B,
    subjectType: 'contact',
    subjectId:   PURGE_CONTACT_B1,
    email:       'erasure-b1@example.invalid',
    kmsKeyArn:   'arn:aws:kms:us-east-1:123456789012:key/test-key-b1',
    wrappedDek:  'base64encodedwrappeddekforB1==',
  },
];

// ---------------------------------------------------------------------------
// Post-purge state snapshots for integration assertions
// ---------------------------------------------------------------------------

/** Minimum months of data that must remain after a 3-month (90d) purge. */
export const MIN_MONTHS_REMAINING_AFTER_PURGE = 3;
/** Months of data that should be dropped by a 90d notification purge. */
export const MIN_MONTHS_DROPPED_90D           = 11;  // months 4–14 are all expired

/** Expected partition suffix pattern for a notification partition. */
export const NOTIFICATION_PARTITION_RE = /^notifications_\d{4}_\d{2}$/;

/** Dry-run should never mutate the DB; expected zero deletions. */
export const DRY_RUN_EXPECTED_MUTATIONS = 0;
