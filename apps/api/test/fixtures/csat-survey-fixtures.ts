/**
 * CSAT survey fixtures — WO-082.
 *
 * Deterministic fixtures for resolved tickets, valid/expired/used/unknown
 * token scenarios, and expected aggregation outputs.
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Fixed identifiers (deterministic for test reproducibility)
// ---------------------------------------------------------------------------

export const CSAT_TENANT_ID = '10000000-0000-0000-0000-000000000082';
export const CSAT_CONTACT_ID = '20000000-0000-0000-0000-000000000001';
export const CSAT_ORG_ID = '30000000-0000-0000-0000-000000000001';
export const CSAT_TICKET_ID_1 = '40000000-0000-0000-0000-000000000001';
export const CSAT_TICKET_ID_2 = '40000000-0000-0000-0000-000000000002';
export const CSAT_TICKET_ID_3 = '40000000-0000-0000-0000-000000000003';
export const CSAT_TICKET_ID_4 = '40000000-0000-0000-0000-000000000004';

// ---------------------------------------------------------------------------
// Token fixtures
// ---------------------------------------------------------------------------

/** A valid 43-char base64url token (32 bytes of deterministic test data). */
export const VALID_RAW_TOKEN = Buffer.from('a'.repeat(32)).toString('base64url');
export const VALID_TOKEN_HASH = createHash('sha256')
  .update(VALID_RAW_TOKEN)
  .digest('hex');

/** Token for an already-responded survey. */
export const USED_RAW_TOKEN = Buffer.from('b'.repeat(32)).toString('base64url');
export const USED_TOKEN_HASH = createHash('sha256')
  .update(USED_RAW_TOKEN)
  .digest('hex');

/** Token for an expired survey (sent 15 days ago, 14-day expiry). */
export const EXPIRED_RAW_TOKEN = Buffer.from('c'.repeat(32)).toString('base64url');
export const EXPIRED_TOKEN_HASH = createHash('sha256')
  .update(EXPIRED_RAW_TOKEN)
  .digest('hex');

/** A token that has no matching survey row (unknown). */
export const UNKNOWN_RAW_TOKEN = Buffer.from('d'.repeat(32)).toString('base64url');
export const UNKNOWN_TOKEN_HASH = createHash('sha256')
  .update(UNKNOWN_RAW_TOKEN)
  .digest('hex');

// ---------------------------------------------------------------------------
// Survey row fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-01-15T12:00:00Z');
const FUTURE = new Date(NOW.getTime() + 14 * 24 * 3600 * 1000);
const EXPIRED_DATE = new Date(NOW.getTime() - 1000); // 1 second ago

export interface CsatSurveyFixture {
  tenantId: string;
  id: string;
  ticketId: string;
  contactId: string;
  tokenHash: string;
  score: number | null;
  comment: string | null;
  responseSource: string | null;
  sentAt: Date;
  delivered: boolean;
  expiresAt: Date;
  respondedAt: Date | null;
}

export const VALID_SURVEY: CsatSurveyFixture = {
  tenantId: CSAT_TENANT_ID,
  id: '50000000-0000-0000-0000-000000000001',
  ticketId: CSAT_TICKET_ID_1,
  contactId: CSAT_CONTACT_ID,
  tokenHash: VALID_TOKEN_HASH,
  score: null,
  comment: null,
  responseSource: null,
  sentAt: new Date(NOW.getTime() - 3600 * 1000),
  delivered: true,
  expiresAt: FUTURE,
  respondedAt: null,
};

export const USED_SURVEY: CsatSurveyFixture = {
  ...VALID_SURVEY,
  id: '50000000-0000-0000-0000-000000000002',
  ticketId: CSAT_TICKET_ID_2,
  tokenHash: USED_TOKEN_HASH,
  score: 4,
  comment: null,
  responseSource: 'form',
  respondedAt: new Date(NOW.getTime() - 1800 * 1000),
};

export const EXPIRED_SURVEY: CsatSurveyFixture = {
  ...VALID_SURVEY,
  id: '50000000-0000-0000-0000-000000000003',
  ticketId: CSAT_TICKET_ID_3,
  tokenHash: EXPIRED_TOKEN_HASH,
  expiresAt: EXPIRED_DATE,
  respondedAt: null,
};

// ---------------------------------------------------------------------------
// Aggregation fixture
// ---------------------------------------------------------------------------

/** Expected aggregation output for VALID_SURVEY + USED_SURVEY combined. */
export const EXPECTED_AGGREGATION = {
  averageScore: 4.0,
  responseCount: 1,
  sentCount: 2,
  responseRate: 0.5,
  distribution: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 0 },
};
