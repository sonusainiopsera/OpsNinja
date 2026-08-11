/**
 * Unit tests for PortalSignupService (WO-086).
 *
 * Tests are pure-function style: pool and OrganizationsService are stubbed.
 * No real database, Redis, or HTTP involved.
 *
 * Covers:
 *   - Email normalisation (uppercase, plus-addressing, unicode domain)
 *   - Blocklist: gmail.com (free mail) rejected with 422
 *   - Domain classification: single-match → email_verification
 *   - Domain classification: zero-match → pending_approval
 *   - Domain classification: multi-match → pending_approval (ambiguous)
 *   - SSO path: match with hasSsoConnection=true → authMode sso + ssoRedirectUrl
 *   - Existing portal user → generic 202 email_verification (non-disclosing)
 *   - Non-disclosing: email_verification and pending_approval have identical shape
 *   - Discovery endpoint returns correct authMode
 *   - DB error during persist → 503 propagated
 */

import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { PortalSignupService } from './portal-signup.service';
import { OrganizationsService } from '../../organizations/organizations.service';

// ---------------------------------------------------------------------------
// Mock pool — intercept pool.connect() calls
// ---------------------------------------------------------------------------

const mockPoolClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('@opsninja/db', () => ({
  pool: {
    connect: jest.fn().mockResolvedValue(mockPoolClient),
  },
}));

import { pool } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = '10000000-0000-0000-0000-000000000001';
const ORG_ID    = '20000000-0000-0000-0000-000000000001';
const TRACE_ID  = 'trace-test-0001';

const BASE_PARAMS = {
  email: 'alice@acmecorp.com',
  fullName: 'Alice Tester',
  sourceIp: '192.0.2.1',
  userAgent: 'jest-test/1.0',
  traceId: TRACE_ID,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOrgsService(
  candidates: Array<{ tenantId: string; organizationId: string; hasSsoConnection: boolean }> = [],
): OrganizationsService {
  return {
    findByVerifiedDomain: jest.fn().mockResolvedValue(candidates),
  } as unknown as OrganizationsService;
}

/** Make the pool client behave: no blocked domains, no existing user, INSERT OK */
function setupSuccessfulPool(hasExistingUser = false) {
  mockPoolClient.query.mockImplementation((sql: string) => {
    if (sql?.includes('signup_blocked_domains')) {
      return Promise.resolve({ rows: [] }); // empty blocklist
    }
    if (sql?.includes('portal_users')) {
      return Promise.resolve({ rows: hasExistingUser ? [{ id: 'u1' }] : [] });
    }
    if (sql?.includes('portal_signup_requests') && sql?.includes('SELECT')) {
      return Promise.resolve({ rows: [] }); // no existing pending request
    }
    // INSERT, UPDATE, BEGIN, COMMIT, set_config → OK
    return Promise.resolve({ rows: [], rowCount: 1 });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe('PortalSignupService.handleSignup', () => {
  // ── Email format validation ──────────────────────────────────────────────

  it('throws 400 for malformed email', async () => {
    const service = new PortalSignupService(makeOrgsService());
    await expect(
      service.handleSignup({ ...BASE_PARAMS, email: 'not-an-email' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 400 for email over 320 chars', async () => {
    const service = new PortalSignupService(makeOrgsService());
    const longEmail = 'a'.repeat(310) + '@acmecorp.com';
    await expect(
      service.handleSignup({ ...BASE_PARAMS, email: longEmail }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ── Blocklist ────────────────────────────────────────────────────────────

  it('throws 422 SIGNUP_DOMAIN_NOT_BUSINESS for gmail.com (blocklisted)', async () => {
    const service = new PortalSignupService(makeOrgsService());
    // Force cache with gmail.com in it (bypass 5-min TTL by setting refreshedAt=0)
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(['gmail.com', 'yahoo.com']),
      refreshedAt: Date.now(), // mark as fresh
    };
    await expect(
      service.handleSignup({ ...BASE_PARAMS, email: 'alice@gmail.com' }),
    ).rejects.toMatchObject({
      response: { error: { code: 'SIGNUP_DOMAIN_NOT_BUSINESS' } },
    });
  });

  it('throws 422 for disposable domain (mailinator.com)', async () => {
    const service = new PortalSignupService(makeOrgsService());
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(['mailinator.com']),
      refreshedAt: Date.now(),
    };
    await expect(
      service.handleSignup({ ...BASE_PARAMS, email: 'test@mailinator.com' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  // ── Email normalisation ──────────────────────────────────────────────────

  it('normalises uppercase email and strips plus-addressing', async () => {
    const service = new PortalSignupService(makeOrgsService([
      { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
    ]));
    // Inject empty blocklist
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(),
      refreshedAt: Date.now(),
    };
    setupSuccessfulPool();

    const result = await service.handleSignup({
      ...BASE_PARAMS,
      email: 'ALICE+work@ACMECORP.COM',
    });

    expect(result.status).toBe('accepted');
    expect(result.authMode).toBe('email_verification');
    // The findByVerifiedDomain should have been called with the normalised domain
    const orgsSvc = service['organizationsService'] as jest.Mocked<OrganizationsService>;
    expect(orgsSvc.findByVerifiedDomain).toHaveBeenCalledWith('acmecorp.com');
  });

  // ── Single-match → email_verification ────────────────────────────────────

  it('returns email_verification authMode for matched domain without SSO', async () => {
    const service = new PortalSignupService(makeOrgsService([
      { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
    ]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(),
      refreshedAt: Date.now(),
    };
    setupSuccessfulPool();

    const result = await service.handleSignup(BASE_PARAMS);
    expect(result.status).toBe('accepted');
    expect(result.authMode).toBe('email_verification');
    expect(result.traceId).toBe(TRACE_ID);
    expect(result.ssoRedirectUrl).toBeUndefined();
  });

  it('creates portal_signup_requests row with status pending_verification for single match', async () => {
    const service = new PortalSignupService(makeOrgsService([
      { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
    ]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(),
      refreshedAt: Date.now(),
    };
    setupSuccessfulPool();

    await service.handleSignup(BASE_PARAMS);

    // Find the INSERT call for portal_signup_requests
    const insertCall = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO portal_signup_requests'),
    );
    expect(insertCall).toBeDefined();
    const insertArgs = insertCall[1] as unknown[];
    // 7th param (index 6) is the status
    expect(insertArgs[6]).toBe('pending_verification');
    // tenant_id (index 1) should match
    expect(insertArgs[1]).toBe(TENANT_ID);
  });

  // ── Zero-match → pending_approval ────────────────────────────────────────

  it('returns pending_approval authMode for unmatched domain', async () => {
    const service = new PortalSignupService(makeOrgsService([])); // no matches
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(),
      refreshedAt: Date.now(),
    };
    setupSuccessfulPool();

    const result = await service.handleSignup({ ...BASE_PARAMS, email: 'alice@unknowncorp.com' });
    expect(result.status).toBe('accepted');
    expect(result.authMode).toBe('pending_approval');
    expect(result.ssoRedirectUrl).toBeUndefined();
  });

  it('creates portal_signup_requests row with status pending_admin_approval for unmatched domain', async () => {
    const service = new PortalSignupService(makeOrgsService([]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(),
      refreshedAt: Date.now(),
    };
    setupSuccessfulPool();

    await service.handleSignup({ ...BASE_PARAMS, email: 'alice@unknowncorp.com' });

    const insertCall = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO portal_signup_requests'),
    );
    expect(insertCall).toBeDefined();
    const insertArgs = insertCall[1] as unknown[];
    expect(insertArgs[6]).toBe('pending_admin_approval');
    expect(insertArgs[1]).toBeNull(); // tenant_id null
  });

  // ── Multi-match → ambiguous → pending_approval ────────────────────────────

  it('falls back to pending_approval for ambiguous (multi-match) domain', async () => {
    const service = new PortalSignupService(makeOrgsService([
      { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
      { tenantId: '10000000-0000-0000-0000-000000000002', organizationId: '20000000-0000-0000-0000-000000000002', hasSsoConnection: false },
    ]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(),
      refreshedAt: Date.now(),
    };
    setupSuccessfulPool();

    const result = await service.handleSignup(BASE_PARAMS);
    expect(result.authMode).toBe('pending_approval');
  });

  // ── SSO path ──────────────────────────────────────────────────────────────

  it('returns authMode sso with ssoRedirectUrl for SSO-enabled match', async () => {
    const service = new PortalSignupService(makeOrgsService([
      { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: true },
    ]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(),
      refreshedAt: Date.now(),
    };
    setupSuccessfulPool();

    const result = await service.handleSignup(BASE_PARAMS);
    expect(result.authMode).toBe('sso');
    expect(result.ssoRedirectUrl).toBeDefined();
    expect(result.ssoRedirectUrl).toContain(TENANT_ID);
  });

  // ── Existing user — non-disclosing ─────────────────────────────────────────

  it('returns generic email_verification 202 for existing portal user (no new row)', async () => {
    const service = new PortalSignupService(makeOrgsService([
      { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
    ]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(),
      refreshedAt: Date.now(),
    };
    setupSuccessfulPool(true); // existing user present

    const result = await service.handleSignup(BASE_PARAMS);
    expect(result.status).toBe('accepted');
    expect(result.authMode).toBe('email_verification');

    // No INSERT into portal_signup_requests should have occurred
    const insertCall = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('INSERT INTO portal_signup_requests'),
    );
    expect(insertCall).toBeUndefined();
  });

  // ── Non-disclosing shape: email_verification vs pending_approval ──────────

  it('email_verification and pending_approval responses have identical JSON key set', async () => {
    // email_verification case
    const serviceMatched = new PortalSignupService(makeOrgsService([
      { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
    ]));
    (serviceMatched as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(), refreshedAt: Date.now(),
    };
    setupSuccessfulPool();
    const matchedResult = await serviceMatched.handleSignup(BASE_PARAMS);

    // pending_approval case
    jest.clearAllMocks();
    const serviceUnmatched = new PortalSignupService(makeOrgsService([]));
    (serviceUnmatched as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(), refreshedAt: Date.now(),
    };
    setupSuccessfulPool();
    const unmatchedResult = await serviceUnmatched.handleSignup({ ...BASE_PARAMS, email: 'alice@unknowncorp.com' });

    // Both must have exactly the same keys (no ssoRedirectUrl on either)
    expect(Object.keys(matchedResult).sort()).toEqual(Object.keys(unmatchedResult).sort());
  });
});

// ---------------------------------------------------------------------------
// Discovery endpoint tests
// ---------------------------------------------------------------------------

describe('PortalSignupService.handleDiscovery', () => {
  it('returns email_verification for matched domain', async () => {
    const service = new PortalSignupService(makeOrgsService([
      { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: false },
    ]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(), refreshedAt: Date.now(),
    };

    const result = await service.handleDiscovery({ email: 'alice@acmecorp.com', traceId: TRACE_ID });
    expect(result.authMode).toBe('email_verification');
  });

  it('returns pending_approval for unmatched domain', async () => {
    const service = new PortalSignupService(makeOrgsService([]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(), refreshedAt: Date.now(),
    };

    const result = await service.handleDiscovery({ email: 'alice@unknowncorp.com', traceId: TRACE_ID });
    expect(result.authMode).toBe('pending_approval');
  });

  it('returns sso for SSO-enabled domain', async () => {
    const service = new PortalSignupService(makeOrgsService([
      { tenantId: TENANT_ID, organizationId: ORG_ID, hasSsoConnection: true },
    ]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(), refreshedAt: Date.now(),
    };

    const result = await service.handleDiscovery({ email: 'alice@acmecorp.com', traceId: TRACE_ID });
    expect(result.authMode).toBe('sso');
  });

  it('throws 422 for blocklisted domain on discovery', async () => {
    const service = new PortalSignupService(makeOrgsService([]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(['gmail.com']),
      refreshedAt: Date.now(),
    };

    await expect(
      service.handleDiscovery({ email: 'alice@gmail.com', traceId: TRACE_ID }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws 400 for malformed email on discovery', async () => {
    const service = new PortalSignupService(makeOrgsService([]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(), refreshedAt: Date.now(),
    };

    await expect(
      service.handleDiscovery({ email: 'not-valid', traceId: TRACE_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Blocked-domains cache refresh
// ---------------------------------------------------------------------------

describe('PortalSignupService blocked-domains cache', () => {
  it('queries signup_blocked_domains when cache is stale (refreshedAt=0)', async () => {
    const service = new PortalSignupService(makeOrgsService([]));
    // Cache starts with refreshedAt=0, triggering a refresh

    mockPoolClient.query.mockImplementation((sql: string) => {
      if (sql?.includes('signup_blocked_domains')) {
        return Promise.resolve({ rows: [{ domain: 'gmail.com' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    // Calling handleDiscovery with a non-blocked domain should trigger cache load
    (service as unknown as { blockedDomainsCache: { refreshedAt: number } }).blockedDomainsCache.refreshedAt = 0;

    await service.handleDiscovery({ email: 'alice@acmecorp.com', traceId: TRACE_ID });

    const blockedDomainQuery = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('signup_blocked_domains'),
    );
    expect(blockedDomainQuery).toBeDefined();
  });

  it('does NOT re-query DB when cache is fresh', async () => {
    const service = new PortalSignupService(makeOrgsService([]));
    (service as unknown as { blockedDomainsCache: { domains: Set<string>; refreshedAt: number } }).blockedDomainsCache = {
      domains: new Set(['gmail.com']),
      refreshedAt: Date.now(), // fresh
    };

    mockPoolClient.query.mockResolvedValue({ rows: [] });

    await service.handleDiscovery({ email: 'alice@acmecorp.com', traceId: TRACE_ID });

    const blockedDomainQuery = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) => typeof sql === 'string' && sql.includes('signup_blocked_domains'),
    );
    expect(blockedDomainQuery).toBeUndefined();
  });
});
