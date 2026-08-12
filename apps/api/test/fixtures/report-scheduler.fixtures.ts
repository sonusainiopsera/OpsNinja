/**
 * Fixtures for report-scheduler tests (WO-075) — AC-12.
 *
 * Provides deterministic schedule rows, occurrence rows, and recipient sets
 * spanning multiple timezones (including DST transitions) for integration and
 * unit tests.
 */

import type { ClaimableSchedule } from '../../src/workers/report-scheduler/report-scheduler.worker';

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

export const RS_TENANT_A       = '10000000-0000-0000-0000-000000000001';
export const RS_TENANT_B       = '10000000-0000-0000-0000-000000000002';
export const RS_SCHEDULE_NYC   = '20000000-0000-0000-0000-000000000001'; // America/New_York
export const RS_SCHEDULE_LON   = '20000000-0000-0000-0000-000000000002'; // Europe/London
export const RS_SCHEDULE_UTC   = '20000000-0000-0000-0000-000000000003'; // UTC
export const RS_SCHEDULE_LA    = '20000000-0000-0000-0000-000000000004'; // America/Los_Angeles
export const RS_DEF_A          = '30000000-0000-0000-0000-000000000001';
export const RS_DEF_B          = '30000000-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// Recipient sets
// ---------------------------------------------------------------------------

/** Verified-domain recipient — should be allowed by RecipientPolicy. */
export const RECIPIENT_VERIFIED_DOMAIN = {
  type: 'external' as const,
  email: 'exec@acme.com',
};

/** Allowlisted recipient — should be allowed regardless of domain. */
export const RECIPIENT_ALLOWLISTED = {
  type: 'external' as const,
  email: 'vip@external-partner.io',
};

/** Non-verified recipient — should be DENIED by RecipientPolicy. */
export const RECIPIENT_NON_VERIFIED = {
  type: 'external' as const,
  email: 'attacker@evil.xyz',
};

/** Active internal user recipient. */
export const RECIPIENT_USER_ACTIVE = {
  type: 'user' as const,
  userId: 'aabbccdd-0001-0000-0000-000000000001',
};

/** Inactive user — should be DENIED by RecipientPolicy. */
export const RECIPIENT_USER_INACTIVE = {
  type: 'user' as const,
  userId: 'aabbccdd-dead-0000-0000-000000000001',
};

/** Valid recipient set — all recipients are allowed. */
export const RECIPIENTS_VALID = [RECIPIENT_VERIFIED_DOMAIN, RECIPIENT_USER_ACTIVE];

/** Recipient set that contains a non-verified external address. */
export const RECIPIENTS_MIXED_DENIED = [RECIPIENT_USER_ACTIVE, RECIPIENT_NON_VERIFIED];

// ---------------------------------------------------------------------------
// Schedule fixtures spanning DST transitions
// ---------------------------------------------------------------------------

/**
 * Daily 08:00 America/New_York schedule.
 * 2024-03-09 next_fire_at = EST (UTC-5) → 13:00 UTC.
 * 2024-03-11 next_fire_at = EDT (UTC-4) → 12:00 UTC.
 */
export const SCHEDULE_NYC_DAILY: ClaimableSchedule = {
  id:                  RS_SCHEDULE_NYC,
  tenantId:            RS_TENANT_A,
  reportDefinitionId:  RS_DEF_A,
  cronExpression:      '0 8 * * *',
  timezone:            'America/New_York',
  format:              'csv',
  recipients:          RECIPIENTS_VALID,
  nextFireAt:          new Date('2024-03-09T13:00:00Z'), // 08:00 EST
};

/**
 * Weekly Monday 08:00 Europe/London.
 * Spans 2024-03-31 spring-forward (GMT → BST).
 */
export const SCHEDULE_LON_WEEKLY: ClaimableSchedule = {
  id:                  RS_SCHEDULE_LON,
  tenantId:            RS_TENANT_A,
  reportDefinitionId:  RS_DEF_A,
  cronExpression:      '0 8 * * 1',
  timezone:            'Europe/London',
  format:              'pdf',
  recipients:          [RECIPIENT_ALLOWLISTED],
  nextFireAt:          new Date('2024-03-25T08:00:00Z'), // 08:00 GMT
};

/**
 * Monthly 1st 08:00 UTC — no DST, baseline case.
 */
export const SCHEDULE_UTC_MONTHLY: ClaimableSchedule = {
  id:                  RS_SCHEDULE_UTC,
  tenantId:            RS_TENANT_B,
  reportDefinitionId:  RS_DEF_B,
  cronExpression:      '0 8 1 * *',
  timezone:            'UTC',
  format:              'csv',
  recipients:          [RECIPIENT_USER_ACTIVE],
  nextFireAt:          new Date('2024-02-01T08:00:00Z'),
};

/**
 * America/Los_Angeles daily 08:00.
 * Before PDT transition: 2024-03-09 = PST (UTC-8) → 16:00 UTC.
 * After PDT transition: 2024-03-11 = PDT (UTC-7) → 15:00 UTC.
 */
export const SCHEDULE_LA_DAILY: ClaimableSchedule = {
  id:                  RS_SCHEDULE_LA,
  tenantId:            RS_TENANT_B,
  reportDefinitionId:  RS_DEF_B,
  cronExpression:      '0 8 * * *',
  timezone:            'America/Los_Angeles',
  format:              'csv',
  recipients:          RECIPIENTS_VALID,
  nextFireAt:          new Date('2024-03-09T16:00:00Z'), // 08:00 PST
};

/**
 * Schedule targeting the America/New_York spring-forward skipped hour (02:30).
 * 2024-03-10 02:30 does not exist — fire at 03:00 EDT instead.
 */
export const SCHEDULE_NYC_SPRING_FORWARD: ClaimableSchedule = {
  id:                  '20000000-0000-0000-0000-000000000005',
  tenantId:            RS_TENANT_A,
  reportDefinitionId:  RS_DEF_A,
  cronExpression:      '30 2 10 3 *',
  timezone:            'America/New_York',
  format:              'csv',
  recipients:          RECIPIENTS_VALID,
  nextFireAt:          new Date('2024-03-10T07:00:00Z'), // 03:00 EDT = UTC-4
};

/**
 * Schedule targeting the America/New_York fall-back repeated hour (01:30).
 * 2024-11-03 01:30 occurs twice — should fire once only.
 */
export const SCHEDULE_NYC_FALL_BACK: ClaimableSchedule = {
  id:                  '20000000-0000-0000-0000-000000000006',
  tenantId:            RS_TENANT_A,
  reportDefinitionId:  RS_DEF_A,
  cronExpression:      '30 1 3 11 *',
  timezone:            'America/New_York',
  format:              'csv',
  recipients:          RECIPIENTS_VALID,
  nextFireAt:          new Date('2024-11-03T05:30:00Z'), // 01:30 EDT (first occurrence)
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock SQS-style schedule row with overrides. */
export function makeSchedule(overrides: Partial<ClaimableSchedule> = {}): ClaimableSchedule {
  return {
    id:                  'schedule-default-id',
    tenantId:            RS_TENANT_A,
    reportDefinitionId:  RS_DEF_A,
    cronExpression:      '0 8 * * *',
    timezone:            'UTC',
    format:              'csv',
    recipients:          RECIPIENTS_VALID,
    nextFireAt:          new Date('2024-01-15T08:00:00Z'),
    ...overrides,
  };
}

/** Build an occurrence key input record matching the schedule. */
export interface OccurrenceKeyInput {
  tenantId:   string;
  scheduleId: string;
  fireAt:     Date;
}

/** All DST-spanning fixtures as an array for parametrised tests. */
export const DST_SPANNING_SCHEDULES: ClaimableSchedule[] = [
  SCHEDULE_NYC_DAILY,
  SCHEDULE_LON_WEEKLY,
  SCHEDULE_LA_DAILY,
  SCHEDULE_NYC_SPRING_FORWARD,
  SCHEDULE_NYC_FALL_BACK,
];

// ---------------------------------------------------------------------------
// Stub SES transport recording
// ---------------------------------------------------------------------------

export interface SentEmail {
  to:      string[];
  subject: string;
  body:    string;
}

/** In-memory stub SES transport that records sent messages without hitting AWS. */
export class StubSesTransport {
  readonly sent: SentEmail[] = [];

  async sendEmail(params: {
    to:      string[];
    subject: string;
    body:    string;
  }): Promise<{ messageId: string }> {
    this.sent.push({ to: params.to, subject: params.subject, body: params.body });
    return { messageId: `stub-msg-${this.sent.length}` };
  }

  reset(): void {
    this.sent.length = 0;
  }

  get lastSent(): SentEmail | undefined {
    return this.sent[this.sent.length - 1];
  }
}
