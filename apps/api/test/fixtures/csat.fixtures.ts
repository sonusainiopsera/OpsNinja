/**
 * CSAT test fixtures
 *
 * Provides resolved-ticket events, valid/expired/used/unknown token fixtures,
 * and aggregation expectation fixtures for unit and integration tests.
 */

import { createHash, randomBytes } from 'crypto';

// ── Token helpers ─────────────────────────────────────────────────────────────

export function generateCsatToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');
  return { rawToken, tokenHash };
}

// ── Resolved ticket event fixture ─────────────────────────────────────────────

export const resolvedTicketEvent = {
  tenantId: 'e7f3a1b2-0000-0000-0000-000000000001',
  ticketId: 'c4d5e6f7-0000-0000-0000-000000000002',
  ticketReference: 'TKT-0042',
  ticketSubject: 'Unable to access VPN after password reset',
  organizationId: 'a1b2c3d4-0000-0000-0000-000000000003',
  contactId: 'b2c3d4e5-0000-0000-0000-000000000004',
  contactEmail: 'contact@example.com',
  contactName: 'Alice Smith',
  resolvedAt: '2025-06-01T14:30:00.000Z',
  traceId: 'trace-fixture-001',
};

// ── Survey row fixtures ───────────────────────────────────────────────────────

const now = new Date('2025-06-01T12:00:00Z');
const expiresAt = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
const expiredAt = new Date(now.getTime() - 1000);

const { rawToken: VALID_RAW, tokenHash: VALID_HASH } = generateCsatToken();
const { rawToken: EXPIRED_RAW, tokenHash: EXPIRED_HASH } = generateCsatToken();
const { rawToken: USED_RAW, tokenHash: USED_HASH } = generateCsatToken();

export const validSurveyFixture = {
  tenantId: resolvedTicketEvent.tenantId,
  id: 'survey-valid-001',
  ticketId: resolvedTicketEvent.ticketId,
  contactId: resolvedTicketEvent.contactId,
  tokenHash: VALID_HASH,
  rawToken: VALID_RAW,
  score: null,
  comment: null,
  responseSource: null,
  sentAt: now,
  delivered: true,
  expiresAt,
  respondedAt: null,
  reminderSentAt: null,
};

export const expiredSurveyFixture = {
  ...validSurveyFixture,
  id: 'survey-expired-001',
  tokenHash: EXPIRED_HASH,
  rawToken: EXPIRED_RAW,
  expiresAt: expiredAt,
};

export const usedSurveyFixture = {
  ...validSurveyFixture,
  id: 'survey-used-001',
  tokenHash: USED_HASH,
  rawToken: USED_RAW,
  score: 4,
  responseSource: 'form',
  respondedAt: new Date(now.getTime() - 3600 * 1000),
};

/** Token that has no corresponding survey row. */
export const unknownRawToken = randomBytes(32).toString('base64url');

// ── Aggregation expectation fixtures ─────────────────────────────────────────

export const aggregationZeroState = {
  averageScore: null,
  responseCount: 0,
  sentCount: 0,
  responseRate: 0,
  distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 },
};

export const aggregationFiveResponses = {
  averageScore: 4.0,
  responseCount: 5,
  sentCount: 8,
  responseRate: 0.625,
  distribution: { '1': 0, '2': 0, '3': 1, '4': 2, '5': 2 },
};

// ── CSAT email template fixture ───────────────────────────────────────────────

export const csatEmailTemplateFixture = {
  key: 'csat_survey',
  subject: 'How did we do? Rate your recent support experience',
  bodyTemplate: `
Hello {{contactName}},

Your recent support request ({{ticketReference}}: {{ticketSubject}}) has been resolved.

We'd love your feedback! Please take 10 seconds to rate your experience:

⭐ 1 - Very poor: {{score1Url}}
⭐⭐ 2 - Poor: {{score2Url}}
⭐⭐⭐ 3 - OK: {{score3Url}}
⭐⭐⭐⭐ 4 - Good: {{score4Url}}
⭐⭐⭐⭐⭐ 5 - Excellent: {{score5Url}}

Or add a detailed comment: {{surveyUrl}}

Thank you for helping us improve!
`,
};
