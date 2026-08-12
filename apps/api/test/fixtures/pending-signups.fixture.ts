/**
 * Test fixtures for WO-091 admin portal signup approval queue.
 *
 * Covers:
 *   - Pending signup requests across statuses (pending_admin_approval, approved,
 *     rejected, expired) and varying ages
 *   - Organization fixtures including a duplicate-domain conflict pair
 *   - Factory helpers for integration test assertions
 */

// ---------------------------------------------------------------------------
// Fixed UUIDs (deterministic across runs)
// ---------------------------------------------------------------------------

export const ADMIN_TENANT_ID  = 'aa000000-0000-0000-0000-000000000001';
export const OTHER_TENANT_ID  = 'bb000000-0000-0000-0000-000000000001';

export const ADMIN_ORG_A      = 'aa100000-0000-0000-0000-000000000001'; // Acme Corp — active
export const ADMIN_ORG_B      = 'aa100000-0000-0000-0000-000000000002'; // Beta Inc  — active
export const ADMIN_ORG_INACTIVE = 'aa100000-0000-0000-0000-000000000003'; // Gamma Ltd — inactive

export const ADMIN_SIGNUP_PENDING    = 'aa200000-0000-0000-0000-000000000001';
export const ADMIN_SIGNUP_PENDING_2  = 'aa200000-0000-0000-0000-000000000002';
export const ADMIN_SIGNUP_APPROVED   = 'aa200000-0000-0000-0000-000000000003';
export const ADMIN_SIGNUP_REJECTED   = 'aa200000-0000-0000-0000-000000000004';
export const ADMIN_SIGNUP_EXPIRED    = 'aa200000-0000-0000-0000-000000000005';
export const ADMIN_SIGNUP_OLD        = 'aa200000-0000-0000-0000-000000000006'; // > 30 days old
export const ADMIN_SIGNUP_OTHER_TENANT = 'bb200000-0000-0000-0000-000000000001'; // different tenant

export const ADMIN_ACTOR_ID = 'aa300000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Reference timestamps (deterministic — not Date.now())
// ---------------------------------------------------------------------------

/** 2026-08-12 10:00:00 UTC — the "now" reference for fixture ages */
export const FIXTURE_NOW = '2026-08-12T10:00:00.000Z';
/** Recent request — 2 days old */
export const FIXTURE_CREATED_RECENT  = '2026-08-10T08:00:00.000Z';
/** Approaching expiry — 28 days old */
export const FIXTURE_CREATED_NEAR_EXPIRY = '2026-07-15T08:00:00.000Z';
/** Over the 30-day expiry threshold */
export const FIXTURE_CREATED_EXPIRED = '2026-07-01T08:00:00.000Z';
/** Over the 37-day (30 + 7) hard-delete threshold */
export const FIXTURE_CREATED_DELETABLE = '2026-06-20T08:00:00.000Z';

// ---------------------------------------------------------------------------
// Database row factories
// ---------------------------------------------------------------------------

export interface SignupRequestRow {
  id: string;
  tenant_id: string | null;
  email: string;
  full_name: string | null;
  domain: string;
  status: string;
  created_at: Date;
  updated_at: Date;
  decided_by_user_id: string | null;
  decided_at: Date | null;
  decision_reason: string | null;
  decision_note: string | null;
  expires_at: Date;
  verified_at: Date | null;
  verification_email_status: string | null;
}

export function makeSignupRow(overrides: Partial<SignupRequestRow> & { id: string }): SignupRequestRow {
  const createdAt = new Date(FIXTURE_CREATED_RECENT);
  return {
    tenant_id: ADMIN_TENANT_ID,
    email: `alice@acmecorp.com`,
    full_name: 'Alice Example',
    domain: 'acmecorp.com',
    status: 'pending_admin_approval',
    created_at: createdAt,
    updated_at: createdAt,
    decided_by_user_id: null,
    decided_at: null,
    decision_reason: null,
    decision_note: null,
    expires_at: new Date(createdAt.getTime() + 30 * 24 * 3600 * 1000),
    verified_at: null,
    verification_email_status: 'delivered',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Standard fixture rows
// ---------------------------------------------------------------------------

/** Pending request — unverified applicant, 2 days old */
export const PENDING_SIGNUP_ROW = makeSignupRow({
  id: ADMIN_SIGNUP_PENDING,
  email: 'alice@acmecorp.com',
  full_name: 'Alice Example',
  domain: 'acmecorp.com',
  status: 'pending_admin_approval',
  created_at: new Date(FIXTURE_CREATED_RECENT),
  verified_at: null,
});

/** Pending request — already-verified applicant */
export const PENDING_SIGNUP_VERIFIED_ROW = makeSignupRow({
  id: ADMIN_SIGNUP_PENDING_2,
  email: 'bob@betainc.com',
  full_name: 'Bob Beta',
  domain: 'betainc.com',
  status: 'pending_admin_approval',
  created_at: new Date(FIXTURE_CREATED_RECENT),
  verified_at: new Date('2026-08-09T10:00:00.000Z'),
  verification_email_status: 'delivered',
});

/** Already-approved request */
export const APPROVED_SIGNUP_ROW = makeSignupRow({
  id: ADMIN_SIGNUP_APPROVED,
  email: 'carol@approved.com',
  full_name: 'Carol Approved',
  domain: 'approved.com',
  status: 'approved',
  decided_by_user_id: ADMIN_ACTOR_ID,
  decided_at: new Date('2026-08-11T09:00:00.000Z'),
  decision_reason: null,
  decision_note: null,
});

/** Already-rejected request */
export const REJECTED_SIGNUP_ROW = makeSignupRow({
  id: ADMIN_SIGNUP_REJECTED,
  email: 'dave@rejected.org',
  full_name: 'Dave Rejected',
  domain: 'rejected.org',
  status: 'rejected',
  decided_by_user_id: ADMIN_ACTOR_ID,
  decided_at: new Date('2026-08-11T11:00:00.000Z'),
  decision_reason: 'not_a_customer',
  decision_note: null,
});

/** Expired request — 31 days old, should be marked expired on next worker run */
export const NEAR_EXPIRY_SIGNUP_ROW = makeSignupRow({
  id: ADMIN_SIGNUP_OLD,
  email: 'eve@oldcorp.com',
  full_name: 'Eve Old',
  domain: 'oldcorp.com',
  status: 'pending_admin_approval',
  created_at: new Date(FIXTURE_CREATED_NEAR_EXPIRY),
  expires_at: new Date(new Date(FIXTURE_CREATED_NEAR_EXPIRY).getTime() + 30 * 24 * 3600 * 1000),
});

/** Already-expired request — eligible for marking expired */
export const EXPIRED_SIGNUP_ROW = makeSignupRow({
  id: ADMIN_SIGNUP_EXPIRED,
  email: 'frank@expired.net',
  full_name: 'Frank Expired',
  domain: 'expired.net',
  status: 'pending_admin_approval',
  created_at: new Date(FIXTURE_CREATED_EXPIRED),
  expires_at: new Date(new Date(FIXTURE_CREATED_EXPIRED).getTime() + 30 * 24 * 3600 * 1000),
});

/** Cross-tenant request — must not be visible to ADMIN_TENANT_ID */
export const OTHER_TENANT_SIGNUP_ROW = makeSignupRow({
  id: ADMIN_SIGNUP_OTHER_TENANT,
  tenant_id: OTHER_TENANT_ID,
  email: 'ghost@othertenant.com',
  full_name: 'Ghost User',
  domain: 'othertenant.com',
  status: 'pending_admin_approval',
  created_at: new Date(FIXTURE_CREATED_RECENT),
});

// ---------------------------------------------------------------------------
// Organization fixtures
// ---------------------------------------------------------------------------

export interface OrgRow {
  id: string;
  tenant_id: string;
  name: string;
  status: 'active' | 'inactive' | 'suspended';
}

/** Active organization that pending signups can be approved into */
export const ORG_ACME: OrgRow = {
  id: ADMIN_ORG_A,
  tenant_id: ADMIN_TENANT_ID,
  name: 'Acme Corp',
  status: 'active',
};

/** Active organization — used for duplicate-domain conflict scenario */
export const ORG_BETA: OrgRow = {
  id: ADMIN_ORG_B,
  tenant_id: ADMIN_TENANT_ID,
  name: 'Beta Inc',
  status: 'active',
};

/** Inactive organization — approval into this must fail with 422 */
export const ORG_INACTIVE: OrgRow = {
  id: ADMIN_ORG_INACTIVE,
  tenant_id: ADMIN_TENANT_ID,
  name: 'Gamma Ltd',
  status: 'inactive',
};

// ---------------------------------------------------------------------------
// Duplicate-domain conflict pair
//
// CONFLICT_ORG_PRIMARY already has 'acmecorp.com' as a verified domain.
// Attempting to add 'acmecorp.com' via addVerifiedDomain on another request
// should trigger a 409 VERIFIED_DOMAIN_CONFLICT from OrganizationsService.
// ---------------------------------------------------------------------------

export const CONFLICT_DOMAIN = 'acmecorp.com';

export const CONFLICT_ORG_PRIMARY: OrgRow = {
  id: ADMIN_ORG_A,
  tenant_id: ADMIN_TENANT_ID,
  name: 'Acme Corp',
  status: 'active',
};

export const CONFLICT_ORG_CLAIMANT: OrgRow = {
  id: ADMIN_ORG_B,
  tenant_id: ADMIN_TENANT_ID,
  name: 'Beta Inc',
  status: 'active',
};

/** Verified-domain row representing the conflicting claim */
export const VERIFIED_DOMAIN_ROW = {
  id: 'aa400000-0000-0000-0000-000000000001',
  tenant_id: ADMIN_TENANT_ID,
  organization_id: ADMIN_ORG_A,
  domain: CONFLICT_DOMAIN,
  status: 'verified',
  created_at: new Date('2026-01-01T00:00:00Z'),
};

// ---------------------------------------------------------------------------
// Portal user row created by a successful approve()
// ---------------------------------------------------------------------------

export function makePortalUserRow(overrides: {
  id?: string;
  tenantId?: string;
  email?: string;
  organizationId?: string;
}) {
  return {
    id: overrides.id ?? 'aa500000-0000-0000-0000-000000000001',
    tenant_id: overrides.tenantId ?? ADMIN_TENANT_ID,
    email: overrides.email ?? 'alice@acmecorp.com',
    organization_id: overrides.organizationId ?? ADMIN_ORG_A,
    status: 'pending_verification',
    created_at: new Date(FIXTURE_CREATED_RECENT),
  };
}

// ---------------------------------------------------------------------------
// Expected masked-email shapes
// ---------------------------------------------------------------------------

/** alice@acmecorp.com → a***e@acmecorp.com */
export const MASKED_EMAIL_ALICE = 'a***e@acmecorp.com';

/** bob@betainc.com → b*b@betainc.com */
export const MASKED_EMAIL_BOB = 'b*b@betainc.com';
