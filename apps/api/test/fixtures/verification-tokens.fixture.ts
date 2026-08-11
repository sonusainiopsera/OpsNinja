/**
 * Verification token fixtures for portal signup tests.
 *
 * Provides pre-built token rows, signup request rows, and a fake email
 * transport that captures sent messages for assertion in tests.
 */

import { createHash, randomBytes } from 'crypto';
import { generateToken } from '../../src/modules/identity/portal-signup/token.codec';

export const FIXTURE_TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
export const FIXTURE_SIGNUP_REQUEST_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
export const FIXTURE_USER_EMAIL = 'applicant@example.com';
export const FIXTURE_ORG_ID = 'cccccccc-0000-0000-0000-000000000003';
export const TEST_HMAC_KEY = 'test-hmac-key-for-fixtures';

// ── Signup request fixtures ───────────────────────────────────────────────────

export const pendingSignupRequest = {
  id: FIXTURE_SIGNUP_REQUEST_ID,
  tenantId: FIXTURE_TENANT_ID,
  email: FIXTURE_USER_EMAIL,
  emailHash: createHash('sha256').update(FIXTURE_USER_EMAIL).digest('hex'),
  applicantName: 'Alice Applicant',
  organizationId: FIXTURE_ORG_ID,
  status: 'pending_verification' as const,
  verifiedAt: null,
  verificationEmailStatus: 'sent',
  createdAt: new Date('2025-06-01T12:00:00.000Z'),
  updatedAt: new Date('2025-06-01T12:00:00.000Z'),
};

export const verifiedSignupRequest = {
  ...pendingSignupRequest,
  status: 'verified' as const,
  verifiedAt: new Date('2025-06-01T13:00:00.000Z'),
  updatedAt: new Date('2025-06-01T13:00:00.000Z'),
};

// ── Token fixtures ─────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2025-06-01T12:00:00.000Z').getTime();

export const validTokenMaterial = generateToken(TEST_HMAC_KEY, FIXED_NOW);

export const validTokenRow = {
  tokenId: 'dddddddd-0000-0000-0000-000000000004',
  signupRequestId: FIXTURE_SIGNUP_REQUEST_ID,
  tenantId: FIXTURE_TENANT_ID,
  tokenHash: validTokenMaterial.tokenHash,
  expiresAt: validTokenMaterial.expiresAt,
  consumedAt: null,
  attemptCount: 0,
  createdAt: new Date('2025-06-01T12:00:00.000Z'),
};

export const expiredTokenMaterial = generateToken(TEST_HMAC_KEY, FIXED_NOW - 25 * 60 * 60 * 1000);

export const expiredTokenRow = {
  tokenId: 'eeeeeeee-0000-0000-0000-000000000005',
  signupRequestId: FIXTURE_SIGNUP_REQUEST_ID,
  tenantId: FIXTURE_TENANT_ID,
  tokenHash: expiredTokenMaterial.tokenHash,
  expiresAt: expiredTokenMaterial.expiresAt, // expired 25h ago
  consumedAt: null,
  attemptCount: 0,
  createdAt: new Date('2025-06-01T00:00:00.000Z'),
};

export const consumedTokenMaterial = generateToken(TEST_HMAC_KEY, FIXED_NOW - 10 * 60 * 1000);

export const consumedTokenRow = {
  tokenId: 'ffffffff-0000-0000-0000-000000000006',
  signupRequestId: FIXTURE_SIGNUP_REQUEST_ID,
  tenantId: FIXTURE_TENANT_ID,
  tokenHash: consumedTokenMaterial.tokenHash,
  expiresAt: consumedTokenMaterial.expiresAt,
  consumedAt: new Date('2025-06-01T11:55:00.000Z'), // consumed 5 min ago
  attemptCount: 1,
  createdAt: new Date('2025-06-01T11:00:00.000Z'),
};

export const tamperedRawToken = 'this-is-not-a-valid-token-aaaaabbbbccccc';

// ── Fake email transport ──────────────────────────────────────────────────────

export interface CapturedEmail {
  to: string;
  templateKey: string;
  payload: Record<string, unknown>;
  sentAt: Date;
}

export class FakeEmailTransport {
  private readonly _sent: CapturedEmail[] = [];

  get sent(): readonly CapturedEmail[] {
    return this._sent;
  }

  clear(): void {
    this._sent.length = 0;
  }

  capture(email: CapturedEmail): void {
    this._sent.push(email);
  }

  lastSentTo(email: string): CapturedEmail | undefined {
    return [...this._sent].reverse().find((m) => m.to === email);
  }

  countSentTo(email: string): number {
    return this._sent.filter((m) => m.to === email).length;
  }
}

export const fakeEmailTransport = new FakeEmailTransport();
