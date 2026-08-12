/**
 * Unit tests for AdminPortalSignupsService — WO-014 AC8.
 *
 * Covers:
 *   approve() —
 *     - happy path, unverified applicant → activationPath='verification_email'
 *     - happy path, already-verified applicant → activationPath='active', no token issued
 *     - 404 when signup not found in tenant
 *     - 409 SIGNUP_ALREADY_DECIDED when status != pending_admin_approval
 *     - concurrent race: conditional UPDATE returns 0 rows → 409
 *     - org not found → 404 ORGANIZATION_NOT_FOUND
 *     - inactive org → 422 ORGANIZATION_INACTIVE
 *     - addVerifiedDomain=true delegates to OrganizationsService
 *
 *   reject() —
 *     - happy path with valid reason
 *     - 422 INVALID_REJECT_REASON for unknown reason
 *     - 409 SIGNUP_ALREADY_DECIDED when status != pending_admin_approval
 *     - concurrent race: conditional UPDATE returns 0 rows → 409
 *     - notifyApplicant=true: notification row inserted
 *     - note HTML-stripped before storage
 *
 *   list() —
 *     - email is masked in response
 *     - pagination: nextCursor set when more rows exist
 *     - nextCursor null on last page
 *
 * All DB interactions are mocked — no real infrastructure required.
 */

import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AdminPortalSignupsService } from './admin-portal-signups.service';
import { PortalVerificationService } from '../portal-signup/portal-verification.service';
import { OrganizationsService } from '../../organizations/organizations.service';

// ---------------------------------------------------------------------------
// Mock the @opsninja/db pool
// ---------------------------------------------------------------------------

const mockPoolClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('@opsninja/db', () => ({
  pool: { connect: jest.fn().mockResolvedValue(mockPoolClient) },
}));

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

const TENANT_ID  = '10000000-0000-0000-0000-000000000001';
const ORG_ID     = '20000000-0000-0000-0000-000000000001';
const SIGNUP_ID  = '30000000-0000-0000-0000-000000000001';
const ACTOR_ID   = '40000000-0000-0000-0000-000000000001';
const EMAIL      = 'alice@acmecorp.com';

// ---------------------------------------------------------------------------
// Dependency factories
// ---------------------------------------------------------------------------

function makeVerificationService(): PortalVerificationService {
  return {
    issue: jest.fn().mockResolvedValue(undefined),
  } as unknown as PortalVerificationService;
}

function makeOrganizationsService(): OrganizationsService {
  return {
    addVerifiedDomain: jest.fn().mockResolvedValue(undefined),
    findByVerifiedDomain: jest.fn().mockResolvedValue([]),
  } as unknown as OrganizationsService;
}

function makeService(
  verSvc?: PortalVerificationService,
  orgsSvc?: OrganizationsService,
): AdminPortalSignupsService {
  return new AdminPortalSignupsService(
    verSvc ?? makeVerificationService(),
    orgsSvc ?? makeOrganizationsService(),
  );
}

// ---------------------------------------------------------------------------
// DB mock helpers
// ---------------------------------------------------------------------------

/** Pending signup row returned for the initial SELECT */
const PENDING_SIGNUP_ROW = {
  id:             SIGNUP_ID,
  tenant_id:      TENANT_ID,
  email:          EMAIL,
  full_name:      'Alice',
  applicant_name: 'Alice',
  status:         'pending_admin_approval',
  verified_at:    null,
};

const VERIFIED_SIGNUP_ROW = {
  ...PENDING_SIGNUP_ROW,
  verified_at: new Date('2026-06-01T10:00:00Z'),
};

const ACTIVE_ORG_ROW = {
  id:     ORG_ID,
  status: 'active',
  name:   'Acme Corp',
};

const INACTIVE_ORG_ROW = {
  ...ACTIVE_ORG_ROW,
  status: 'inactive',
};

/**
 * Set up mockPoolClient.query for a standard approve() happy-path run.
 * @param opts.signupRow  — signup row to return (default: PENDING_SIGNUP_ROW)
 * @param opts.orgRow     — org row to return (default: ACTIVE_ORG_ROW)
 * @param opts.transitionRows — rows returned by the conditional UPDATE (1 = success, 0 = race)
 */
function setupApprovePool(opts: {
  signupRow?: object | null;
  orgRow?: object | null;
  transitionRows?: number;
} = {}) {
  const signupRow     = opts.signupRow !== undefined ? opts.signupRow : PENDING_SIGNUP_ROW;
  const orgRow        = opts.orgRow !== undefined ? opts.orgRow : ACTIVE_ORG_ROW;
  const transitionRows = opts.transitionRows ?? 1;

  mockPoolClient.query.mockImplementation((sql: string, params?: unknown[]) => {
    if (
      sql?.includes('BEGIN') ||
      sql?.includes('COMMIT') ||
      sql?.includes('ROLLBACK') ||
      sql?.includes('set_config')
    ) {
      return Promise.resolve({ rows: [] });
    }

    if (sql?.includes('portal_signup_requests') && sql?.includes('WHERE id') && sql?.includes('SELECT')) {
      return Promise.resolve({ rows: signupRow ? [signupRow] : [] });
    }

    if (sql?.includes('organizations') && sql?.includes('WHERE id') && sql?.includes('SELECT')) {
      return Promise.resolve({ rows: orgRow ? [orgRow] : [] });
    }

    if (sql?.includes('UPDATE portal_signup_requests') && sql?.includes("status = 'pending_admin_approval'")) {
      const rows = transitionRows === 1 ? [{ id: SIGNUP_ID }] : [];
      return Promise.resolve({ rows });
    }

    if (sql?.includes('INSERT INTO portal_users')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (sql?.includes('SELECT id FROM portal_users')) {
      // Resolve portal user id
      return Promise.resolve({ rows: [{ id: 'user-resolved-1' }] });
    }

    if (sql?.includes('INSERT INTO audit_logs')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (sql?.includes('INSERT INTO notifications')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

/**
 * Set up mockPoolClient.query for a standard reject() happy-path run.
 */
function setupRejectPool(opts: {
  signupRow?: object | null;
  transitionRows?: number;
  withNotification?: boolean;
} = {}) {
  const signupRow    = opts.signupRow !== undefined ? opts.signupRow : PENDING_SIGNUP_ROW;
  const transitionRows = opts.transitionRows ?? 1;

  mockPoolClient.query.mockImplementation((sql: string) => {
    if (
      sql?.includes('BEGIN') ||
      sql?.includes('COMMIT') ||
      sql?.includes('ROLLBACK') ||
      sql?.includes('set_config')
    ) {
      return Promise.resolve({ rows: [] });
    }

    if (sql?.includes('portal_signup_requests') && sql?.includes('WHERE id') && sql?.includes('SELECT')) {
      return Promise.resolve({ rows: signupRow ? [signupRow] : [] });
    }

    if (sql?.includes('UPDATE portal_signup_requests') && sql?.includes("status = 'pending_admin_approval'")) {
      const rows = transitionRows === 1 ? [{ id: SIGNUP_ID }] : [];
      return Promise.resolve({ rows });
    }

    if (sql?.includes('INSERT INTO audit_logs')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    if (sql?.includes('INSERT INTO notifications')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }

    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

// ---------------------------------------------------------------------------
// Tests — approve()
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AdminPortalSignupsService.approve()', () => {
  // ── Happy path: unverified applicant ─────────────────────────────────────

  it('returns activationPath=verification_email when applicant has not yet verified', async () => {
    const verSvc = makeVerificationService();
    const service = makeService(verSvc);
    setupApprovePool();

    const result = await service.approve(
      TENANT_ID,
      SIGNUP_ID,
      { organizationId: ORG_ID },
      ACTOR_ID,
    );

    expect(result.activationPath).toBe('verification_email');
    expect(result.userId).toBe('user-resolved-1');
    expect(result.organizationId).toBe(ORG_ID);
    expect(verSvc.issue).toHaveBeenCalledTimes(1);
  });

  // ── Happy path: already-verified applicant ────────────────────────────────

  it('returns activationPath=active when applicant has already verified email', async () => {
    const verSvc = makeVerificationService();
    const service = makeService(verSvc);
    setupApprovePool({ signupRow: VERIFIED_SIGNUP_ROW });

    const result = await service.approve(
      TENANT_ID,
      SIGNUP_ID,
      { organizationId: ORG_ID },
      ACTOR_ID,
    );

    expect(result.activationPath).toBe('active');
    // verification token should NOT be issued for already-verified applicant
    expect(verSvc.issue).not.toHaveBeenCalled();
  });

  // ── Signup not found ──────────────────────────────────────────────────────

  it('throws NotFoundException (SIGNUP_NOT_FOUND) when signup does not belong to tenant', async () => {
    const service = makeService();
    setupApprovePool({ signupRow: null });

    const err = await service
      .approve(TENANT_ID, SIGNUP_ID, { organizationId: ORG_ID }, ACTOR_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    const body = (err as NotFoundException).getResponse() as Record<string, Record<string, string>>;
    expect(body.error.code).toBe('SIGNUP_NOT_FOUND');
  });

  // ── Wrong status ──────────────────────────────────────────────────────────

  it('throws ConflictException (SIGNUP_ALREADY_DECIDED) when status is not pending_admin_approval', async () => {
    const service = makeService();
    setupApprovePool({
      signupRow: { ...PENDING_SIGNUP_ROW, status: 'verified' },
    });

    const err = await service
      .approve(TENANT_ID, SIGNUP_ID, { organizationId: ORG_ID }, ACTOR_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as Record<string, Record<string, string>>;
    expect(body.error.code).toBe('SIGNUP_ALREADY_DECIDED');
  });

  // ── Concurrent race ───────────────────────────────────────────────────────

  it('throws ConflictException (SIGNUP_ALREADY_DECIDED) when conditional UPDATE returns 0 rows', async () => {
    const service = makeService();
    setupApprovePool({ transitionRows: 0 });

    const err = await service
      .approve(TENANT_ID, SIGNUP_ID, { organizationId: ORG_ID }, ACTOR_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as Record<string, Record<string, string>>;
    expect(body.error.code).toBe('SIGNUP_ALREADY_DECIDED');
  });

  // ── Org not found ─────────────────────────────────────────────────────────

  it('throws NotFoundException (ORGANIZATION_NOT_FOUND) when org does not belong to tenant', async () => {
    const service = makeService();
    setupApprovePool({ orgRow: null });

    const err = await service
      .approve(TENANT_ID, SIGNUP_ID, { organizationId: ORG_ID }, ACTOR_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    const body = (err as NotFoundException).getResponse() as Record<string, Record<string, string>>;
    expect(body.error.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  // ── Inactive org ──────────────────────────────────────────────────────────

  it('throws UnprocessableEntityException (ORGANIZATION_INACTIVE) for inactive org', async () => {
    const service = makeService();
    setupApprovePool({ orgRow: INACTIVE_ORG_ROW });

    const err = await service
      .approve(TENANT_ID, SIGNUP_ID, { organizationId: ORG_ID }, ACTOR_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    const body = (err as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
    expect(body.error.code).toBe('ORGANIZATION_INACTIVE');
  });

  // ── addVerifiedDomain ─────────────────────────────────────────────────────

  it('calls organizationsService.addVerifiedDomain when addVerifiedDomain=true', async () => {
    const orgsSvc = makeOrganizationsService();
    const service = makeService(makeVerificationService(), orgsSvc);
    setupApprovePool();

    const result = await service.approve(
      TENANT_ID,
      SIGNUP_ID,
      { organizationId: ORG_ID, addVerifiedDomain: true },
      ACTOR_ID,
    );

    expect(orgsSvc.addVerifiedDomain).toHaveBeenCalledWith(
      TENANT_ID,
      ORG_ID,
      'acmecorp.com', // domain extracted from alice@acmecorp.com
      ACTOR_ID,
    );
    expect(result.verifiedDomainAdded).toBe(true);
  });

  it('returns verifiedDomainAdded=false when addVerifiedDomain not requested', async () => {
    const service = makeService();
    setupApprovePool();

    const result = await service.approve(
      TENANT_ID,
      SIGNUP_ID,
      { organizationId: ORG_ID },
      ACTOR_ID,
    );

    expect(result.verifiedDomainAdded).toBe(false);
  });

  // ── Audit log written ─────────────────────────────────────────────────────

  it('writes an audit_logs record in the same transaction (AC8)', async () => {
    const service = makeService();
    setupApprovePool();

    await service.approve(TENANT_ID, SIGNUP_ID, { organizationId: ORG_ID }, ACTOR_ID);

    const auditCall = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO audit_logs'),
    );
    expect(auditCall).toBeDefined();
    const params = auditCall[1] as unknown[];
    // event_type = 'portal_signup.approved' is at position 5 (index 4) based on the INSERT
    const sqlStr = auditCall[0] as string;
    expect(sqlStr).toContain('portal_signup.approved');
    expect(params[2]).toBe(ACTOR_ID); // actor_id
  });
});

// ---------------------------------------------------------------------------
// Tests — reject()
// ---------------------------------------------------------------------------

describe('AdminPortalSignupsService.reject()', () => {
  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns { status: rejected } for valid reason', async () => {
    const service = makeService();
    setupRejectPool();

    const result = await service.reject(
      TENANT_ID,
      SIGNUP_ID,
      { reason: 'not_a_customer' },
      ACTOR_ID,
    );

    expect(result.status).toBe('rejected');
  });

  // ── Invalid reason ────────────────────────────────────────────────────────

  it('throws UnprocessableEntityException (INVALID_REJECT_REASON) for unknown reason', async () => {
    const service = makeService();

    const err = await service
      .reject(TENANT_ID, SIGNUP_ID, { reason: 'bad_reason' as never }, ACTOR_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnprocessableEntityException);
    const body = (err as UnprocessableEntityException).getResponse() as Record<string, Record<string, string>>;
    expect(body.error.code).toBe('INVALID_REJECT_REASON');
    // Should not have touched the DB
    expect(mockPoolClient.query).not.toHaveBeenCalled();
  });

  // ── Signup not found ──────────────────────────────────────────────────────

  it('throws NotFoundException (SIGNUP_NOT_FOUND) when signup does not exist', async () => {
    const service = makeService();
    setupRejectPool({ signupRow: null });

    const err = await service
      .reject(TENANT_ID, SIGNUP_ID, { reason: 'not_a_customer' }, ACTOR_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    const body = (err as NotFoundException).getResponse() as Record<string, Record<string, string>>;
    expect(body.error.code).toBe('SIGNUP_NOT_FOUND');
  });

  // ── Wrong status ──────────────────────────────────────────────────────────

  it('throws ConflictException (SIGNUP_ALREADY_DECIDED) when status is already rejected', async () => {
    const service = makeService();
    setupRejectPool({ signupRow: { ...PENDING_SIGNUP_ROW, status: 'rejected' } });

    const err = await service
      .reject(TENANT_ID, SIGNUP_ID, { reason: 'duplicate_request' }, ACTOR_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as Record<string, Record<string, string>>;
    expect(body.error.code).toBe('SIGNUP_ALREADY_DECIDED');
  });

  // ── Concurrent race ───────────────────────────────────────────────────────

  it('throws ConflictException (SIGNUP_ALREADY_DECIDED) when conditional UPDATE returns 0 rows', async () => {
    const service = makeService();
    setupRejectPool({ transitionRows: 0 });

    const err = await service
      .reject(TENANT_ID, SIGNUP_ID, { reason: 'other' }, ACTOR_ID)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as Record<string, Record<string, string>>;
    expect(body.error.code).toBe('SIGNUP_ALREADY_DECIDED');
  });

  // ── Notification queued for applicant ─────────────────────────────────────

  it('inserts a notification row when notifyApplicant=true', async () => {
    const service = makeService();
    setupRejectPool();

    await service.reject(
      TENANT_ID,
      SIGNUP_ID,
      { reason: 'security_concern', notifyApplicant: true },
      ACTOR_ID,
    );

    const notifCall = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('portal_signup_rejected_neutral'),
    );
    expect(notifCall).toBeDefined();
  });

  it('does NOT insert a notification row when notifyApplicant is not set', async () => {
    const service = makeService();
    setupRejectPool();

    await service.reject(
      TENANT_ID,
      SIGNUP_ID,
      { reason: 'not_a_customer' },
      ACTOR_ID,
    );

    const notifCall = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('portal_signup_rejected_neutral'),
    );
    expect(notifCall).toBeUndefined();
  });

  // ── HTML note sanitisation ────────────────────────────────────────────────

  it('strips HTML tags from the note before storage', async () => {
    const service = makeService();
    setupRejectPool();

    await service.reject(
      TENANT_ID,
      SIGNUP_ID,
      { reason: 'other', note: '<script>alert(1)</script>Plain note' },
      ACTOR_ID,
    );

    // The UPDATE call should have the sanitised note (no HTML) as a param
    const updateCall = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes("status = 'rejected'"),
    );
    expect(updateCall).toBeDefined();
    const params = updateCall[1] as string[];
    const noteParam = params[3]; // 4th param is decision_note
    expect(noteParam).not.toContain('<script>');
    expect(noteParam).toContain('Plain note');
  });

  // ── Audit record ──────────────────────────────────────────────────────────

  it('writes an audit_logs record with portal_signup.rejected event type (AC8)', async () => {
    const service = makeService();
    setupRejectPool();

    await service.reject(
      TENANT_ID,
      SIGNUP_ID,
      { reason: 'unrecognised_domain' },
      ACTOR_ID,
    );

    const auditCall = mockPoolClient.query.mock.calls.find(
      ([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('portal_signup.rejected'),
    );
    expect(auditCall).toBeDefined();
    const params = auditCall[1] as unknown[];
    expect(params[2]).toBe(ACTOR_ID); // actor_id
  });
});

// ---------------------------------------------------------------------------
// Tests — list()
// ---------------------------------------------------------------------------

describe('AdminPortalSignupsService.list()', () => {
  it('masks email addresses in the response', async () => {
    const service = makeService();

    mockPoolClient.query.mockImplementation((sql: string) => {
      if (sql?.includes('set_config')) return Promise.resolve({ rows: [] });
      if (sql?.includes('portal_signup_requests')) {
        return Promise.resolve({
          rows: [
            {
              id: SIGNUP_ID,
              email: 'alice@acmecorp.com',
              full_name: 'Alice',
              status: 'pending_admin_approval',
              created_at: new Date('2026-06-01T00:00:00Z'),
              verification_email_status: null,
            },
          ],
        });
      }
      if (sql?.includes('organization_verified_domains')) return Promise.resolve({ rows: [] });
      if (sql?.includes('organizations')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const page = await service.list(TENANT_ID, {});
    expect(page.data).toHaveLength(1);
    const item = page.data[0]!;
    expect(item.maskedEmail).not.toBe('alice@acmecorp.com');
    expect(item.maskedEmail).toContain('@acmecorp.com');
    // Local part must be partially masked
    expect(item.maskedEmail).toMatch(/^a\*+e@acmecorp\.com$/);
  });

  it('sets nextCursor when there are more items than the requested limit', async () => {
    const service = makeService();

    // Return limit+1 rows to trigger pagination
    const rows = Array.from({ length: 26 }, (_, i) => ({
      id:                       `30000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
      email:                    `user${i}@acmecorp.com`,
      full_name:                null,
      status:                   'pending_admin_approval',
      created_at:               new Date(`2026-06-${String(i + 1).padStart(2, '0')}T00:00:00Z`),
      verification_email_status: null,
    }));

    mockPoolClient.query.mockImplementation((sql: string) => {
      if (sql?.includes('set_config')) return Promise.resolve({ rows: [] });
      if (sql?.includes('portal_signup_requests')) return Promise.resolve({ rows });
      if (sql?.includes('organization_verified_domains')) return Promise.resolve({ rows: [] });
      if (sql?.includes('organizations')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const page = await service.list(TENANT_ID, { limit: 25 });
    expect(page.data).toHaveLength(25);
    expect(page.nextCursor).not.toBeNull();
  });

  it('sets nextCursor=null when all items fit on one page', async () => {
    const service = makeService();

    mockPoolClient.query.mockImplementation((sql: string) => {
      if (sql?.includes('set_config')) return Promise.resolve({ rows: [] });
      if (sql?.includes('portal_signup_requests')) {
        return Promise.resolve({
          rows: [{
            id: SIGNUP_ID,
            email: EMAIL,
            full_name: null,
            status: 'pending_admin_approval',
            created_at: new Date('2026-06-01T00:00:00Z'),
            verification_email_status: null,
          }],
        });
      }
      if (sql?.includes('organization_verified_domains')) return Promise.resolve({ rows: [] });
      if (sql?.includes('organizations')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    const page = await service.list(TENANT_ID, { limit: 25 });
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });
});
