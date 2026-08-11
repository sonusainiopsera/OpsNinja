/**
 * Test fixtures for WO-086 portal self-service signup tests.
 *
 * Covers:
 *   - Two tenants with organizations (one SSO-enabled, one email-verification)
 *   - Blocklisted domains
 *   - Signup request row factories
 *   - OrganizationsService.findByVerifiedDomain response factories
 */

// ---------------------------------------------------------------------------
// Fixed UUIDs (deterministic across runs)
// ---------------------------------------------------------------------------

export const SIGNUP_TENANT_A = 'a0000000-0000-0000-0000-000000000001';
export const SIGNUP_TENANT_B = 'b0000000-0000-0000-0000-000000000001';

export const SIGNUP_ORG_A = 'a1000000-0000-0000-0000-000000000001'; // Acme Corp — email-verification
export const SIGNUP_ORG_B = 'b1000000-0000-0000-0000-000000000001'; // Beta Inc  — SSO-enabled

// ---------------------------------------------------------------------------
// Organization domain resolution fixtures
// ---------------------------------------------------------------------------

/** Single match — email-verification flow (no SSO) */
export const DOMAIN_MATCH_EMAIL_VERIFICATION = [
  {
    tenantId: SIGNUP_TENANT_A,
    organizationId: SIGNUP_ORG_A,
    hasSsoConnection: false,
  },
];

/** Single match — SSO flow */
export const DOMAIN_MATCH_SSO = [
  {
    tenantId: SIGNUP_TENANT_B,
    organizationId: SIGNUP_ORG_B,
    hasSsoConnection: true,
  },
];

/** Zero matches — pending_admin_approval flow */
export const DOMAIN_NO_MATCH: typeof DOMAIN_MATCH_EMAIL_VERIFICATION = [];

/** Ambiguous — two orgs claim the same domain */
export const DOMAIN_MATCH_AMBIGUOUS = [
  { tenantId: SIGNUP_TENANT_A, organizationId: SIGNUP_ORG_A, hasSsoConnection: false },
  { tenantId: SIGNUP_TENANT_B, organizationId: SIGNUP_ORG_B, hasSsoConnection: false },
];

// ---------------------------------------------------------------------------
// Blocklist fixtures
// ---------------------------------------------------------------------------

/** Domains that appear in signup_blocked_domains */
export const BLOCKED_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'mailinator.com',
];

export const BLOCKED_DOMAINS_DB_ROWS = BLOCKED_DOMAINS.map((domain) => ({
  domain,
  reason: domain.includes('mailinator') ? 'disposable' : 'free_mail',
  created_at: new Date('2026-01-01T00:00:00Z'),
}));

// ---------------------------------------------------------------------------
// Signup request row factories
// ---------------------------------------------------------------------------

export function makeSignupRequestRow(overrides: {
  id?: string;
  tenantId?: string | null;
  organizationId?: string | null;
  email?: string;
  emailHash?: string;
  fullName?: string;
  status?: 'pending_verification' | 'pending_admin_approval' | 'verified' | 'rejected' | 'expired';
  sourceIp?: string;
  userAgent?: string;
} = {}) {
  return {
    id: overrides.id ?? 'req-00000000-0000-0000-0000-000000000001',
    tenant_id: overrides.tenantId ?? SIGNUP_TENANT_A,
    organization_id: overrides.organizationId ?? SIGNUP_ORG_A,
    email: overrides.email ?? 'alice@acmecorp.com',
    email_hash: overrides.emailHash ?? 'sha256-placeholder',
    full_name: overrides.fullName ?? 'Alice Tester',
    status: overrides.status ?? 'pending_verification',
    source_ip: overrides.sourceIp ?? '192.0.2.1',
    user_agent: overrides.userAgent ?? 'test-agent/1.0',
    created_at: new Date('2026-01-15T10:00:00Z'),
    updated_at: new Date('2026-01-15T10:00:00Z'),
    expires_at: new Date('2026-01-18T10:00:00Z'),
  };
}

/** Factory for a pending_admin_approval request (unmatched domain) */
export function makePendingApprovalRequest(email = 'alice@unknowncorp.com') {
  return makeSignupRequestRow({
    tenantId: null,
    organizationId: null,
    email,
    status: 'pending_admin_approval',
  });
}

/** Factory for a verified signup request */
export function makeVerifiedSignupRequest(email = 'alice@acmecorp.com') {
  return makeSignupRequestRow({
    email,
    status: 'verified',
  });
}

// ---------------------------------------------------------------------------
// HTTP request body factories
// ---------------------------------------------------------------------------

export function makeSignupBody(overrides: {
  email?: string;
  fullName?: string;
} = {}) {
  return {
    email: overrides.email ?? 'alice@acmecorp.com',
    ...(overrides.fullName !== undefined ? { fullName: overrides.fullName } : {}),
  };
}

export const VALID_SIGNUP_BODY = makeSignupBody();

export const VALID_SIGNUP_BODY_WITH_NAME = makeSignupBody({ fullName: 'Alice Tester' });

export const SIGNUP_BODY_FREE_MAIL = makeSignupBody({ email: 'alice@gmail.com' });

export const SIGNUP_BODY_INVALID_EMAIL = { email: 'not-an-email' };

export const SIGNUP_BODY_UNKNOWN_PROPS = {
  email: 'alice@acmecorp.com',
  unknownField: 'should-be-rejected',
};

export const SIGNUP_BODY_EMAIL_TOO_LONG = {
  email: 'a'.repeat(310) + '@acmecorp.com',
};

export const SIGNUP_BODY_FULLNAME_TOO_LONG = {
  email: 'alice@acmecorp.com',
  fullName: 'A'.repeat(121),
};
