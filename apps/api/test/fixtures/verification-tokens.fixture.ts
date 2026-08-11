/**
 * Test fixtures for portal verification token flow.
 *
 * Provides:
 *   - Pending signup request fixture
 *   - Valid, expired, consumed, and tampered token fixtures
 *   - FakeEmailTransport for capturing sent messages in integration tests
 */
import { createHash, createHmac, randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Shared UUIDs
// ---------------------------------------------------------------------------

export const FIXTURE_TENANT_ID = '10000000-0000-0000-0000-000000000001';
export const FIXTURE_ORG_ID = '20000000-0000-0000-0000-000000000001';
export const FIXTURE_SIGNUP_REQUEST_ID = '30000000-0000-0000-0000-000000000001';
export const FIXTURE_TOKEN_ID_VALID = '40000000-0000-0000-0000-000000000001';
export const FIXTURE_TOKEN_ID_EXPIRED = '40000000-0000-0000-0000-000000000002';
export const FIXTURE_TOKEN_ID_CONSUMED = '40000000-0000-0000-0000-000000000003';

export const FIXTURE_APPLICANT_EMAIL = 'applicant@example.com';
export const FIXTURE_APPLICANT_NAME = 'Jane Applicant';
export const FIXTURE_ORG_NAME = 'Acme Corp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

function buildRawToken(
  tokenId: string,
  email: string,
  expiresAt: Date,
  signingKey: Buffer,
): string {
  const entropy = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // deterministic for tests
  const payload = `${tokenId}.${hashEmail(email)}.${expiresAt.toISOString()}`;
  const tag = createHmac('sha256', signingKey).update(payload).digest('base64url');
  return `${entropy}.${tag}`;
}

const TEST_SIGNING_KEY = Buffer.alloc(32, 0xab); // matches PORTAL_TOKEN_SIGNING_KEY in tests

// ---------------------------------------------------------------------------
// Pending signup request fixture
// ---------------------------------------------------------------------------

export const FIXTURE_PENDING_SIGNUP_REQUEST = {
  id: FIXTURE_SIGNUP_REQUEST_ID,
  tenantId: FIXTURE_TENANT_ID,
  organizationId: FIXTURE_ORG_ID,
  email: FIXTURE_APPLICANT_EMAIL,
  applicantName: FIXTURE_APPLICANT_NAME,
  status: 'pending_verification' as const,
  verifiedAt: null,
  verificationEmailStatus: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

// ---------------------------------------------------------------------------
// Valid token fixture (expires in 24 hours from reference point)
// ---------------------------------------------------------------------------

const VALID_EXPIRES_AT = new Date('2026-01-02T12:00:00Z'); // 24h from ref
export const FIXTURE_VALID_RAW_TOKEN = buildRawToken(
  FIXTURE_TOKEN_ID_VALID,
  FIXTURE_APPLICANT_EMAIL,
  VALID_EXPIRES_AT,
  TEST_SIGNING_KEY,
);

export const FIXTURE_TOKEN_VALID = {
  tokenId: FIXTURE_TOKEN_ID_VALID,
  signupRequestId: FIXTURE_SIGNUP_REQUEST_ID,
  tenantId: FIXTURE_TENANT_ID,
  tokenHash: hashToken(FIXTURE_VALID_RAW_TOKEN),
  expiresAt: VALID_EXPIRES_AT,
  consumedAt: null,
  attemptCount: 0,
  createdAt: new Date('2026-01-01T12:00:00Z'),
};

// ---------------------------------------------------------------------------
// Expired token fixture (expires in the past)
// ---------------------------------------------------------------------------

const EXPIRED_EXPIRES_AT = new Date('2026-01-01T00:00:00Z'); // already expired
export const FIXTURE_EXPIRED_RAW_TOKEN = buildRawToken(
  FIXTURE_TOKEN_ID_EXPIRED,
  FIXTURE_APPLICANT_EMAIL,
  EXPIRED_EXPIRES_AT,
  TEST_SIGNING_KEY,
);

export const FIXTURE_TOKEN_EXPIRED = {
  tokenId: FIXTURE_TOKEN_ID_EXPIRED,
  signupRequestId: FIXTURE_SIGNUP_REQUEST_ID,
  tenantId: FIXTURE_TENANT_ID,
  tokenHash: hashToken(FIXTURE_EXPIRED_RAW_TOKEN),
  expiresAt: EXPIRED_EXPIRES_AT,
  consumedAt: null,
  attemptCount: 0,
  createdAt: new Date('2025-12-31T00:00:00Z'),
};

// ---------------------------------------------------------------------------
// Consumed token fixture
// ---------------------------------------------------------------------------

export const FIXTURE_CONSUMED_RAW_TOKEN = buildRawToken(
  FIXTURE_TOKEN_ID_CONSUMED,
  FIXTURE_APPLICANT_EMAIL,
  new Date('2026-01-03T12:00:00Z'),
  TEST_SIGNING_KEY,
);

export const FIXTURE_TOKEN_CONSUMED = {
  tokenId: FIXTURE_TOKEN_ID_CONSUMED,
  signupRequestId: FIXTURE_SIGNUP_REQUEST_ID,
  tenantId: FIXTURE_TENANT_ID,
  tokenHash: hashToken(FIXTURE_CONSUMED_RAW_TOKEN),
  expiresAt: new Date('2026-01-03T12:00:00Z'),
  consumedAt: new Date('2026-01-02T08:00:00Z'),
  attemptCount: 1,
  createdAt: new Date('2026-01-02T08:00:00Z'),
};

// ---------------------------------------------------------------------------
// Tampered token fixture — valid format but HMAC tag replaced
// ---------------------------------------------------------------------------

export const FIXTURE_TAMPERED_RAW_TOKEN = (() => {
  const parts = FIXTURE_VALID_RAW_TOKEN.split('.');
  // Flip two characters in the HMAC tag
  const tag = parts[1]!;
  const tamperedTag = tag.slice(0, 4) + 'XXXX' + tag.slice(8);
  return `${parts[0]}.${tamperedTag}`;
})();

// ---------------------------------------------------------------------------
// FakeEmailTransport — records sent messages for integration test assertions
// ---------------------------------------------------------------------------

export interface CapturedEmail {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  messageId: string;
}

export class FakeEmailTransport {
  public readonly sent: CapturedEmail[] = [];

  async sendEmail(params: {
    from: string;
    to: string;
    subject: string;
    htmlBody: string;
    textBody: string;
    traceId?: string;
  }): Promise<{ messageId: string }> {
    const messageId = `fake-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.sent.push({
      to: params.to,
      subject: params.subject,
      htmlBody: params.htmlBody,
      textBody: params.textBody,
      messageId,
    });
    return { messageId };
  }

  reset(): void {
    this.sent.length = 0;
  }

  /** Extract the verification link from the most recently sent email. */
  extractVerificationLink(): string | null {
    const last = this.sent[this.sent.length - 1];
    if (!last) return null;
    const match = last.htmlBody.match(/href="([^"]+verify[^"]+)"/);
    return match?.[1] ?? null;
  }
}
