/**
 * Retention fixtures — WO-085 AC11.
 *
 * Provides:
 *  - Multi-month aged notification, webhook delivery and CSAT data generators
 *  - A data-subject erasure request fixture spanning tickets, notifications
 *    and CSAT responses for a single contact
 *  - Expected post-purge state snapshots (row counts, tombstone values)
 */

// ---------------------------------------------------------------------------
// Fixed deterministic identifiers
// ---------------------------------------------------------------------------

export const RETENTION_TENANT_A    = 'a1000000-0000-0000-0000-000000000001';
export const RETENTION_TENANT_B    = 'b1000000-0000-0000-0000-000000000001';

export const RETENTION_CONTACT_A1  = 'c1000001-0000-0000-0000-000000000001';
export const RETENTION_CONTACT_A2  = 'c1000002-0000-0000-0000-000000000001';

export const RETENTION_TICKET_1    = 't1000001-0000-0000-0000-000000000001';
export const RETENTION_TICKET_2    = 't1000002-0000-0000-0000-000000000001';

/** Request ID for the GDPR erasure request fixture. */
export const ERASURE_REQUEST_ID    = 'req00001-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Aged data generators (deterministic, no real PII)
// ---------------------------------------------------------------------------

export interface AgedNotificationRow {
  id:              string;
  tenantId:        string;
  recipientEmail:  string;
  templateKey:     string;
  status:          string;
  createdAt:       Date;
  ageMonths:       number;
}

/**
 * Generate notification rows spread across `months` monthly partitions.
 * All emails use @example.invalid.
 */
export function buildAgedNotifications(
  tenantId: string,
  months: number,
  rowsPerMonth: number,
): AgedNotificationRow[] {
  const rows: AgedNotificationRow[] = [];
  const now = new Date();

  for (let m = 1; m <= months; m++) {
    const baseDate = new Date(now);
    baseDate.setUTCMonth(baseDate.getUTCMonth() - m);
    baseDate.setUTCDate(15);

    for (let i = 0; i < rowsPerMonth; i++) {
      const id = `notif-m${m}-${String(i).padStart(4, '0')}-${tenantId.slice(0, 8)}`;
      rows.push({
        id,
        tenantId,
        recipientEmail: `aged-user-${m}-${i}@example.invalid`,
        templateKey:    'ticket.created',
        status:         'sent',
        createdAt:      new Date(baseDate.getTime() + i * 60_000),
        ageMonths:      m,
      });
    }
  }
  return rows;
}

export interface AgedCsatRow {
  id:          string;
  tenantId:    string;
  contactId:   string | null;
  score:       number | null;
  comment:     string | null;
  createdAt:   Date;
  ageMonths:   number;
}

/**
 * Generate CSAT rows with synthetic comments.
 */
export function buildAgedCsatRows(
  tenantId: string,
  contactId: string,
  count: number,
  ageMonths: number,
): AgedCsatRow[] {
  const rows: AgedCsatRow[] = [];
  const now = new Date();
  const baseDate = new Date(now);
  baseDate.setUTCMonth(baseDate.getUTCMonth() - ageMonths);

  const SYNTHETIC = [
    'Great support, resolved quickly.',
    'Took longer than expected but resolved.',
    null,
    'Satisfied with the outcome.',
    'Support was excellent.',
  ];

  for (let i = 0; i < count; i++) {
    rows.push({
      id:        `csat-${ageMonths}-${String(i).padStart(4, '0')}`,
      tenantId,
      contactId,
      score:     (i % 5) + 1,
      comment:   SYNTHETIC[i % SYNTHETIC.length] ?? null,
      createdAt: new Date(baseDate.getTime() + i * 120_000),
      ageMonths,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Erasure request fixture
// ---------------------------------------------------------------------------

/** Full erasure request for RETENTION_CONTACT_A1 spanning tickets, notifications, CSAT. */
export const ERASURE_SUBJECT_FIXTURE = {
  requestId:   ERASURE_REQUEST_ID,
  tenantId:    RETENTION_TENANT_A,
  subjectType: 'contact',
  subjectId:   RETENTION_CONTACT_A1,
  email:       'erasure-subject@example.invalid',
};

/** Notification rows that should be tombstoned for the erasure subject. */
export const ERASURE_NOTIFICATION_ROWS = [
  {
    id:             'enot-0001-0000-0000-0000-000000000001',
    tenantId:       RETENTION_TENANT_A,
    recipientEmail: 'erasure-subject@example.invalid',
    templateKey:    'ticket.created',
    status:         'sent',
    createdAt:      new Date('2024-03-01T10:00:00Z'),
  },
  {
    id:             'enot-0002-0000-0000-0000-000000000001',
    tenantId:       RETENTION_TENANT_A,
    recipientEmail: 'erasure-subject@example.invalid',
    templateKey:    'ticket.resolved',
    status:         'sent',
    createdAt:      new Date('2024-03-15T12:00:00Z'),
  },
];

/** CSAT rows that should be tombstoned for the erasure subject. */
export const ERASURE_CSAT_ROWS = [
  {
    id:          'ecsat-001-0000-0000-0000-000000000001',
    tenantId:    RETENTION_TENANT_A,
    contactId:   RETENTION_CONTACT_A1,
    score:       4,
    comment:     'Good service overall.',
    createdAt:   new Date('2024-03-05T14:00:00Z'),
  },
];

// ---------------------------------------------------------------------------
// Post-purge state snapshots
// ---------------------------------------------------------------------------

/** Tombstone values that must be present after erasure. */
export const POST_ERASURE_EXPECTED = {
  notificationRecipientEmail: '[erased]',
  csatComment:                '[erased]',
  csatContactId:              null,
  webhookPayload:             { erased: true },
  webhookResponseSnippet:     '[erased]',
};

/** CSAT aggregate values must be unchanged after erasure (score preserved). */
export const PRE_ERASURE_CSAT_SCORE  = 4;  // from ERASURE_CSAT_ROWS[0]
export const POST_ERASURE_CSAT_SCORE = 4;  // score preserved after tombstone

// ---------------------------------------------------------------------------
// Anonymisation lint fixture — asserts no real email domains appear
// ---------------------------------------------------------------------------

/** These are the only email domains permitted in test fixtures. */
export const ALLOWED_TEST_DOMAINS = ['example.com', 'example.org', 'example.invalid', 'test.invalid'];

/**
 * Sample anonymised emails for the lint test. All must pass the validator.
 */
export const ANONYMISED_EMAIL_SAMPLES = [
  'user-1@example.invalid',
  'aged-user-0-0@example.invalid',
  'contact@example.com',
  'test-user@test.invalid',
];

/**
 * Sample emails that MUST be rejected by the lint test.
 */
export const REAL_EMAIL_SAMPLES = [
  'user@gmail.com',
  'customer@company.io',
  'admin@acmecorp.net',
];
