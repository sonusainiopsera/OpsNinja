/**
 * Integration tests for POST /api/v1/portal/signup/verify and
 * POST /api/v1/portal/signup/resend — WO-014 AC9.
 *
 * Tests the PortalVerificationController end-to-end using a real NestJS
 * TestingModule with PortalVerificationService mocked at the provider boundary.
 *
 * Covers:
 *   verify happy path          — 200 with accessToken + refresh cookie
 *   unknown token              — 400 VERIFICATION_TOKEN_INVALID
 *   expired token              — 410 VERIFICATION_TOKEN_EXPIRED
 *   consumed token             — 410 VERIFICATION_TOKEN_CONSUMED
 *   inactive org               — 422 ORGANIZATION_INACTIVE
 *   malformed request          — 400 (missing token field)
 *   resend happy path          — 202 { status: 'accepted' }
 *   resend rate-limited        — 429 with Retry-After
 *   resend enumeration safety  — 202 even for non-existent email
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';

import { PortalVerificationController } from '../../src/modules/identity/portal-signup/portal-verification.controller';
import {
  PortalVerificationService,
  type PortalVerificationResult,
} from '../../src/modules/identity/portal-signup/portal-verification.service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID   = '10000000-0000-0000-0000-000000000001';
const ORG_ID      = '20000000-0000-0000-0000-000000000001';
const USER_ID     = '50000000-0000-0000-0000-000000000001';
const EMAIL       = 'alice@acmecorp.com';
const VALID_TOKEN = 'dGVzdGVudHJvcHkxMjM0NTY3ODkwMTIzNA.dGVzdHRhZ3Rlc3R0YWd0ZXN0dGFndGVzdA'; // fake but dot-separated

const REDEEM_SUCCESS: PortalVerificationResult = {
  accessToken: 'at.integration.test',
  expiresIn: 900,
  user: {
    id: USER_ID,
    email: EMAIL,
    organizationId: ORG_ID,
    roles: ['portal_user'],
  },
  onboardingRequired: true,
  sessionId:    'sess-integration-1',
  refreshToken: 'rt.integration.test',
  tenantId: TENANT_ID,
};

// ---------------------------------------------------------------------------
// Error factory helpers
// ---------------------------------------------------------------------------

function makeTokenError(code: string, statusCode: number): Error {
  return Object.assign(new Error(`Token error: ${code}`), { code, statusCode });
}

function makeRateLimitError(retryAfterSeconds: number): Error {
  return Object.assign(new Error('Too many resend attempts'), {
    code: 'RATE_LIMITED',
    statusCode: 429,
    retryAfter: retryAfterSeconds,
  });
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp(
  redeemImpl: jest.Mock,
  resendImpl: jest.Mock,
): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [PortalVerificationController],
    providers: [
      {
        provide: PortalVerificationService,
        useValue: {
          redeem: redeemImpl,
          resend: resendImpl,
        },
      },
      {
        provide: ConfigService,
        useValue: {
          get: (_key: string, def?: string) => def ?? '',
        },
      },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

// ---------------------------------------------------------------------------
// Tests — POST /api/v1/portal/signup/verify
// ---------------------------------------------------------------------------

describe('POST /api/v1/portal/signup/verify', () => {
  let app: INestApplication;
  const defaultResend = jest.fn().mockResolvedValue(undefined);

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('AC9 — returns 200 with accessToken and user on valid token', async () => {
    const redeem = jest.fn().mockResolvedValue(REDEEM_SUCCESS);
    app = await buildApp(redeem, defaultResend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/verify')
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.status).toBe('verified');
    expect(res.body.accessToken).toBe('at.integration.test');
    expect(res.body.expiresIn).toBe(900);
    expect(res.body.onboardingRequired).toBe(true);
    expect(res.body.user.email).toBe(EMAIL);
    expect(res.body.user.roles).toEqual(['portal_user']);
  });

  it('AC9 — sets portal_refresh_token httpOnly cookie on success', async () => {
    const redeem = jest.fn().mockResolvedValue(REDEEM_SUCCESS);
    app = await buildApp(redeem, defaultResend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/verify')
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(HttpStatus.OK);
    const cookies: string[] = res.headers['set-cookie'] as string[];
    expect(cookies).toBeDefined();
    const refreshCookie = cookies.find((c) => c.startsWith('portal_refresh_token='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/Secure/i);
  });

  it('AC9 — access token has portal_user role only (AC7)', async () => {
    const redeem = jest.fn().mockResolvedValue(REDEEM_SUCCESS);
    app = await buildApp(redeem, defaultResend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/verify')
      .send({ token: VALID_TOKEN });

    expect(res.body.user.roles).toEqual(['portal_user']);
    // Must not contain any staff-level roles
    expect(res.body.user.roles).not.toContain('staff');
    expect(res.body.user.roles).not.toContain('admin');
  });

  // ── Unknown token ─────────────────────────────────────────────────────────

  it('AC9 — returns 400 VERIFICATION_TOKEN_INVALID for unknown token', async () => {
    const redeem = jest.fn().mockRejectedValue(
      makeTokenError('VERIFICATION_TOKEN_INVALID', 400),
    );
    app = await buildApp(redeem, defaultResend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/verify')
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(res.body.error?.code).toBe('VERIFICATION_TOKEN_INVALID');
  });

  // ── Expired token ─────────────────────────────────────────────────────────

  it('AC9 — returns 410 VERIFICATION_TOKEN_EXPIRED for expired token', async () => {
    const redeem = jest.fn().mockRejectedValue(
      makeTokenError('VERIFICATION_TOKEN_EXPIRED', 410),
    );
    app = await buildApp(redeem, defaultResend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/verify')
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(410);
    expect(res.body.error?.code).toBe('VERIFICATION_TOKEN_EXPIRED');
  });

  // ── Replayed / consumed token ──────────────────────────────────────────────

  it('AC9 — returns 410 VERIFICATION_TOKEN_CONSUMED for replayed token', async () => {
    const redeem = jest.fn().mockRejectedValue(
      makeTokenError('VERIFICATION_TOKEN_CONSUMED', 410),
    );
    app = await buildApp(redeem, defaultResend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/verify')
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(410);
    expect(res.body.error?.code).toBe('VERIFICATION_TOKEN_CONSUMED');
  });

  // ── Inactive organisation ─────────────────────────────────────────────────

  it('returns 422 ORGANIZATION_INACTIVE when org deactivated between signup and verify', async () => {
    const redeem = jest.fn().mockRejectedValue(
      makeTokenError('ORGANIZATION_INACTIVE', 422),
    );
    app = await buildApp(redeem, defaultResend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/verify')
      .send({ token: VALID_TOKEN });

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(res.body.error?.code).toBe('ORGANIZATION_INACTIVE');
  });

  // ── Malformed request ─────────────────────────────────────────────────────

  it('returns 400 when token field is missing', async () => {
    const redeem = jest.fn();
    app = await buildApp(redeem, defaultResend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/verify')
      .send({});

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(redeem).not.toHaveBeenCalled();
  });

  it('returns 400 for extra unknown fields in the request body', async () => {
    const redeem = jest.fn();
    app = await buildApp(redeem, defaultResend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/verify')
      .send({ token: VALID_TOKEN, extraField: 'bad' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(redeem).not.toHaveBeenCalled();
  });

  // ── No information leakage ────────────────────────────────────────────────

  it('expired token response does NOT reveal token internals beyond the error code', async () => {
    const redeem = jest.fn().mockRejectedValue(
      makeTokenError('VERIFICATION_TOKEN_EXPIRED', 410),
    );
    app = await buildApp(redeem, defaultResend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/verify')
      .send({ token: VALID_TOKEN });

    // Should not leak raw token hash or DB row details
    expect(JSON.stringify(res.body)).not.toContain('sha256');
    expect(JSON.stringify(res.body)).not.toContain('token_hash');
    expect(JSON.stringify(res.body)).not.toContain('signup_request_id');
  });
});

// ---------------------------------------------------------------------------
// Tests — POST /api/v1/portal/signup/resend
// ---------------------------------------------------------------------------

describe('POST /api/v1/portal/signup/resend', () => {
  let app: INestApplication;
  const defaultRedeem = jest.fn();

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('AC9 — returns 202 { status: accepted } for a valid resend request', async () => {
    const resend = jest.fn().mockResolvedValue(undefined);
    app = await buildApp(defaultRedeem, resend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/resend')
      .send({ email: 'alice@acmecorp.com' });

    expect(res.status).toBe(HttpStatus.ACCEPTED);
    expect(res.body.status).toBe('accepted');
  });

  // ── Enumeration safety ────────────────────────────────────────────────────

  it('AC9 — returns identical 202 for non-existent email (enumeration-safe)', async () => {
    // Service returns undefined (no pending signup found, silently accepted)
    const resend = jest.fn().mockResolvedValue(undefined);
    app = await buildApp(defaultRedeem, resend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/resend')
      .send({ email: 'nobody@acmecorp.com' });

    expect(res.status).toBe(HttpStatus.ACCEPTED);
    expect(res.body.status).toBe('accepted');
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────

  it('AC9 — returns 429 with Retry-After when hourly resend limit exceeded', async () => {
    const resend = jest.fn().mockRejectedValue(makeRateLimitError(3600));
    app = await buildApp(defaultRedeem, resend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/resend')
      .send({ email: 'alice@acmecorp.com' });

    expect(res.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(res.body.error?.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBe('3600');
  });

  // ── Malformed request ─────────────────────────────────────────────────────

  it('returns 400 when email field is missing', async () => {
    const resend = jest.fn();
    app = await buildApp(defaultRedeem, resend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/resend')
      .send({});

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(resend).not.toHaveBeenCalled();
  });

  it('returns 400 for non-email value in email field', async () => {
    const resend = jest.fn();
    app = await buildApp(defaultRedeem, resend);

    const res = await request(app.getHttpServer())
      .post('/api/v1/portal/signup/resend')
      .send({ email: 'not-an-email' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    expect(resend).not.toHaveBeenCalled();
  });
});
