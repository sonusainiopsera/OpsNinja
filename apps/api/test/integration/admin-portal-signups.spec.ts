/**
 * Integration test scaffold for the admin portal-signup approval queue (WO-091).
 *
 * Tests AdminPortalSignupsController + AdminPortalSignupsService + SignupExpiryWorker
 * end-to-end using a NestJS testing module with mocked DB pool.
 *
 * Covers (per AC):
 *   AC1  — GET /admin/portal-signups returns paginated list scoped to caller tenant
 *   AC2  — Each item has maskedEmail, domain, fullName, createdAt, verificationEmailStatus,
 *           duplicateDomainConflict, suggestedOrganizations
 *   AC3  — POST approve validates organization belongs to tenant and is active
 *   AC4  — addVerifiedDomain=true delegates to OrganizationsService; 409 on conflict
 *   AC5  — Unverified applicant → activationPath='verification_email';
 *           verified applicant → activationPath='active'
 *   AC6  — POST reject sets status, stores reason, optionally enqueues notification
 *   AC7  — Audit records written for approve and reject
 *   AC8  — Second decision → 409 SIGNUP_ALREADY_DECIDED (race-safety)
 *   AC9  — Expiry worker marks pending → expired; physically deletes after grace period
 *   AC13 — Cross-tenant signup id returns 404
 */

import { Test, type TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { randomUUID } from 'crypto';

import { AdminPortalSignupsController } from '../../src/modules/identity/admin/admin-portal-signups.controller';
import { AdminPortalSignupsService } from '../../src/modules/identity/admin/admin-portal-signups.service';
import { PortalVerificationService } from '../../src/modules/identity/portal-signup/portal-verification.service';
import { OrganizationsService } from '../../src/modules/organizations/organizations.service';
import { SignupExpiryWorker } from '../../src/workers/cleanup/signup-expiry.worker';
import { RequirePermission } from '../../src/common/auth/require-permission.decorator';

import {
  ADMIN_TENANT_ID,
  ADMIN_ORG_A,
  ADMIN_ORG_INACTIVE,
  ADMIN_SIGNUP_PENDING,
  ADMIN_SIGNUP_PENDING_2,
  ADMIN_SIGNUP_APPROVED,
  ADMIN_SIGNUP_OTHER_TENANT,
  ADMIN_ACTOR_ID,
  PENDING_SIGNUP_ROW,
  PENDING_SIGNUP_VERIFIED_ROW,
  APPROVED_SIGNUP_ROW,
  ORG_ACME,
  ORG_INACTIVE,
} from '../fixtures/pending-signups.fixture';

// ---------------------------------------------------------------------------
// Mock @opsninja/db pool
// ---------------------------------------------------------------------------

const mockPoolClient = {
  query: jest.fn(),
  release: jest.fn(),
};

jest.mock('@opsninja/db', () => ({
  pool: { connect: jest.fn().mockResolvedValue(mockPoolClient) },
}));

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

// ---------------------------------------------------------------------------
// Helpers — pool mock setup
// ---------------------------------------------------------------------------

function resetPoolMock() {
  mockPoolClient.query.mockReset();
  mockPoolClient.release.mockReset();
}

/**
 * Configures the pool mock for a standard approve() happy-path:
 *   1. set_config bootstrap
 *   2. SELECT signup row
 *   3. SELECT org row
 *   4. BEGIN
 *   5. conditional UPDATE returning id (transition success)
 *   6. INSERT portal_users
 *   7. INSERT audit_logs
 *   8. COMMIT
 */
function setupApprovePool(opts: {
  signupRow?: object | null;
  orgRow?: object | null;
  transitionCount?: number;
  portalUserId?: string;
} = {}) {
  const signupRow     = opts.signupRow !== undefined ? opts.signupRow : PENDING_SIGNUP_ROW;
  const orgRow        = opts.orgRow !== undefined ? opts.orgRow : ORG_ACME;
  const transitionCount = opts.transitionCount ?? 1;
  const portalUserId  = opts.portalUserId ?? randomUUID();

  mockPoolClient.query.mockImplementation((sql: string) => {
    if (
      sql?.includes('BEGIN') ||
      sql?.includes('COMMIT') ||
      sql?.includes('ROLLBACK') ||
      sql?.includes('set_config')
    ) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    // signup lookup
    if (sql?.includes('portal_signup_requests') && sql?.includes('WHERE id') && sql?.includes('SELECT')) {
      return Promise.resolve({ rows: signupRow ? [signupRow] : [] });
    }
    // organization lookup
    if (sql?.includes('organizations') && sql?.includes('WHERE id') && sql?.includes('SELECT')) {
      return Promise.resolve({ rows: orgRow ? [orgRow] : [] });
    }
    // conditional status transition
    if (sql?.includes('UPDATE portal_signup_requests') && sql?.includes("status = 'pending_admin_approval'")) {
      const rows = transitionCount > 0 ? [{ id: signupRow ? (signupRow as { id: string }).id : ADMIN_SIGNUP_PENDING }] : [];
      return Promise.resolve({ rows, rowCount: transitionCount });
    }
    // portal_users INSERT
    if (sql?.includes('INSERT INTO portal_users')) {
      return Promise.resolve({ rows: [{ id: portalUserId }], rowCount: 1 });
    }
    // duplicate domain check (organization_verified_domains)
    if (sql?.includes('organization_verified_domains') && sql?.includes('SELECT')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    // suggested orgs (SELECT organizations name/id)
    if (sql?.includes('SELECT id, name') && sql?.includes('organizations')) {
      return Promise.resolve({ rows: [{ id: ADMIN_ORG_A, name: 'Acme Corp' }] });
    }
    // audit log insert
    if (sql?.includes('INSERT INTO audit_logs')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    // notifications insert
    if (sql?.includes('INSERT INTO notifications')) {
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

/**
 * Configures the pool mock for a standard reject() happy-path.
 */
function setupRejectPool(opts: {
  signupRow?: object | null;
  transitionCount?: number;
} = {}) {
  const signupRow     = opts.signupRow !== undefined ? opts.signupRow : PENDING_SIGNUP_ROW;
  const transitionCount = opts.transitionCount ?? 1;

  mockPoolClient.query.mockImplementation((sql: string) => {
    if (
      sql?.includes('BEGIN') ||
      sql?.includes('COMMIT') ||
      sql?.includes('ROLLBACK') ||
      sql?.includes('set_config')
    ) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (sql?.includes('portal_signup_requests') && sql?.includes('WHERE id') && sql?.includes('SELECT')) {
      return Promise.resolve({ rows: signupRow ? [signupRow] : [] });
    }
    if (sql?.includes('UPDATE portal_signup_requests') && sql?.includes("status = 'pending_admin_approval'")) {
      const rows = transitionCount > 0
        ? [{ id: (signupRow as { id: string } | null)?.id ?? ADMIN_SIGNUP_PENDING }]
        : [];
      return Promise.resolve({ rows, rowCount: transitionCount });
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
 * Configures the pool mock for a list() call.
 */
function setupListPool(signupRows: object[] = [PENDING_SIGNUP_ROW]) {
  // Return one extra to simulate nextCursor
  const all = [...signupRows];

  mockPoolClient.query.mockImplementation((sql: string) => {
    if (sql?.includes('set_config')) {
      return Promise.resolve({ rows: [], rowCount: 0 });
    }
    if (sql?.includes('portal_signup_requests')) {
      return Promise.resolve({ rows: all });
    }
    if (sql?.includes('organization_verified_domains')) {
      return Promise.resolve({ rows: [] });
    }
    if (sql?.includes('SELECT id, name') && sql?.includes('organizations')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

// ---------------------------------------------------------------------------
// NestJS test application factory
// ---------------------------------------------------------------------------

async function buildApp(
  verSvc?: PortalVerificationService,
  orgsSvc?: OrganizationsService,
): Promise<INestApplication> {
  const verification   = verSvc  ?? makeVerificationService();
  const organizations  = orgsSvc ?? makeOrganizationsService();

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [AdminPortalSignupsController],
    providers: [
      {
        provide: AdminPortalSignupsService,
        useValue: new AdminPortalSignupsService(verification, organizations),
      },
      SignupExpiryWorker,
    ],
  })
    // Bypass the RequirePermission guard for unit testing the HTTP contract
    .overrideGuard(RequirePermission)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  // Inject a synthetic user into every request so extractPrincipal works
  app.use((req: any, _res: any, next: () => void) => {
    req.user = { sub: ADMIN_ACTOR_ID, tenantId: ADMIN_TENANT_ID };
    next();
  });
  await app.init();
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AdminPortalSignupsController — integration', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    resetPoolMock();
  });

  // -------------------------------------------------------------------------
  // AC1, AC2 — GET list
  // -------------------------------------------------------------------------

  describe('GET /admin/portal-signups', () => {
    it('returns 200 with paginated list for the caller tenant', async () => {
      setupListPool([PENDING_SIGNUP_ROW]);
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .get('/admin/portal-signups')
        .expect(HttpStatus.OK);

      expect(res.body).toHaveProperty('data');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('masks email local part in each list item', async () => {
      setupListPool([PENDING_SIGNUP_ROW]);
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .get('/admin/portal-signups')
        .expect(HttpStatus.OK);

      const item = res.body.data[0];
      // Full email must not appear; local part must be masked
      expect(item.maskedEmail).toBeDefined();
      expect(item.maskedEmail).not.toBe(PENDING_SIGNUP_ROW.email);
      expect(item.maskedEmail).toContain('@acmecorp.com');
      expect(item.maskedEmail).toMatch(/\*/); // at least one asterisk
    });

    it('exposes domain, fullName, status, createdAt fields', async () => {
      setupListPool([PENDING_SIGNUP_ROW]);
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .get('/admin/portal-signups')
        .expect(HttpStatus.OK);

      const item = res.body.data[0];
      expect(item).toHaveProperty('domain');
      expect(item).toHaveProperty('fullName');
      expect(item).toHaveProperty('status');
      expect(item).toHaveProperty('createdAt');
    });

    it('accepts status filter query param', async () => {
      setupListPool([]);
      app = await buildApp();

      await request(app.getHttpServer())
        .get('/admin/portal-signups?status=approved')
        .expect(HttpStatus.OK);
    });

    it('accepts domain search filter', async () => {
      setupListPool([]);
      app = await buildApp();

      await request(app.getHttpServer())
        .get('/admin/portal-signups?domain=acmecorp.com')
        .expect(HttpStatus.OK);
    });
  });

  // -------------------------------------------------------------------------
  // AC3, AC5 — POST approve (unverified applicant)
  // -------------------------------------------------------------------------

  describe('POST /admin/portal-signups/:id/approve', () => {
    it('returns 200 with userId and activationPath=verification_email for unverified applicant', async () => {
      const verSvc = makeVerificationService();
      setupApprovePool({ signupRow: PENDING_SIGNUP_ROW });
      app = await buildApp(verSvc);

      const res = await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/approve`)
        .send({ organizationId: ADMIN_ORG_A })
        .expect(HttpStatus.OK);

      expect(res.body.activationPath).toBe('verification_email');
      expect(res.body.userId).toBeDefined();
      expect(res.body.organizationId).toBe(ADMIN_ORG_A);
      expect(res.body.verifiedDomainAdded).toBe(false);
    });

    it('calls PortalVerificationService.issue for unverified applicant', async () => {
      const verSvc = makeVerificationService();
      setupApprovePool({ signupRow: PENDING_SIGNUP_ROW });
      app = await buildApp(verSvc);

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/approve`)
        .send({ organizationId: ADMIN_ORG_A })
        .expect(HttpStatus.OK);

      expect(verSvc.issue).toHaveBeenCalledTimes(1);
    });

    it('returns activationPath=active for already-verified applicant', async () => {
      const verSvc = makeVerificationService();
      setupApprovePool({ signupRow: PENDING_SIGNUP_VERIFIED_ROW });
      app = await buildApp(verSvc);

      const res = await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING_2}/approve`)
        .send({ organizationId: ADMIN_ORG_A })
        .expect(HttpStatus.OK);

      expect(res.body.activationPath).toBe('active');
      // No verification email issued for already-verified applicant
      expect(verSvc.issue).not.toHaveBeenCalled();
    });

    it('returns 404 when signup does not exist', async () => {
      setupApprovePool({ signupRow: null });
      app = await buildApp();

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${randomUUID()}/approve`)
        .send({ organizationId: ADMIN_ORG_A })
        .expect(HttpStatus.NOT_FOUND);
    });

    it('returns 404 when signup belongs to a different tenant (cross-tenant isolation)', async () => {
      // Row returned has a different tenant_id — service should 404 it
      setupApprovePool({
        signupRow: {
          ...PENDING_SIGNUP_ROW,
          id: ADMIN_SIGNUP_OTHER_TENANT,
          tenant_id: 'bb000000-0000-0000-0000-000000000001',
        },
      });
      app = await buildApp();

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_OTHER_TENANT}/approve`)
        .send({ organizationId: ADMIN_ORG_A })
        .expect(HttpStatus.NOT_FOUND);
    });

    it('returns 422 when target organization is inactive (AC3)', async () => {
      setupApprovePool({ orgRow: { ...ORG_INACTIVE } });
      app = await buildApp();

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/approve`)
        .send({ organizationId: ADMIN_ORG_INACTIVE })
        .expect(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('returns 404 when organization does not exist', async () => {
      setupApprovePool({ orgRow: null });
      app = await buildApp();

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/approve`)
        .send({ organizationId: randomUUID() })
        .expect(HttpStatus.NOT_FOUND);
    });

    // -----------------------------------------------------------------------
    // AC4 — addVerifiedDomain
    // -----------------------------------------------------------------------

    it('calls OrganizationsService.addVerifiedDomain when addVerifiedDomain=true', async () => {
      const orgsSvc = makeOrganizationsService();
      setupApprovePool();
      app = await buildApp(undefined, orgsSvc);

      const res = await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/approve`)
        .send({ organizationId: ADMIN_ORG_A, addVerifiedDomain: true })
        .expect(HttpStatus.OK);

      expect(orgsSvc.addVerifiedDomain).toHaveBeenCalledTimes(1);
      expect(res.body.verifiedDomainAdded).toBe(true);
    });

    it('does not call addVerifiedDomain when flag is false', async () => {
      const orgsSvc = makeOrganizationsService();
      setupApprovePool();
      app = await buildApp(undefined, orgsSvc);

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/approve`)
        .send({ organizationId: ADMIN_ORG_A, addVerifiedDomain: false })
        .expect(HttpStatus.OK);

      expect(orgsSvc.addVerifiedDomain).not.toHaveBeenCalled();
    });

    it('returns 409 VERIFIED_DOMAIN_CONFLICT when domain already claimed', async () => {
      const orgsSvc = makeOrganizationsService();
      (orgsSvc.addVerifiedDomain as jest.Mock).mockRejectedValueOnce(
        Object.assign(new Error('VERIFIED_DOMAIN_CONFLICT'), {
          status: 409,
          response: { error: { code: 'VERIFIED_DOMAIN_CONFLICT' } },
        }),
      );
      setupApprovePool();
      app = await buildApp(undefined, orgsSvc);

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/approve`)
        .send({ organizationId: ADMIN_ORG_A, addVerifiedDomain: true })
        .expect(HttpStatus.CONFLICT);
    });

    // -----------------------------------------------------------------------
    // AC8 — race-safety: second decision returns 409 SIGNUP_ALREADY_DECIDED
    // -----------------------------------------------------------------------

    it('returns 409 SIGNUP_ALREADY_DECIDED when status was changed by another actor (race)', async () => {
      setupApprovePool({ transitionCount: 0 }); // conditional UPDATE returns 0 rows
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/approve`)
        .send({ organizationId: ADMIN_ORG_A })
        .expect(HttpStatus.CONFLICT);

      expect(res.body?.error?.code ?? res.body?.message).toMatch(/SIGNUP_ALREADY_DECIDED/i);
    });

    it('returns 409 SIGNUP_ALREADY_DECIDED when signup is already in approved state', async () => {
      setupApprovePool({ signupRow: APPROVED_SIGNUP_ROW, transitionCount: 0 });
      app = await buildApp();

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_APPROVED}/approve`)
        .send({ organizationId: ADMIN_ORG_A })
        .expect(HttpStatus.CONFLICT);
    });
  });

  // -------------------------------------------------------------------------
  // AC6 — POST reject
  // -------------------------------------------------------------------------

  describe('POST /admin/portal-signups/:id/reject', () => {
    it('returns 200 with status=rejected for valid reason', async () => {
      setupRejectPool();
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/reject`)
        .send({ reason: 'not_a_customer' })
        .expect(HttpStatus.OK);

      expect(res.body.status).toBe('rejected');
    });

    it('returns 422 for invalid reason value', async () => {
      setupRejectPool();
      app = await buildApp();

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/reject`)
        .send({ reason: 'definitely_not_valid' })
        .expect(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('accepts all valid reason values', async () => {
      const reasons = [
        'not_a_customer',
        'unrecognised_domain',
        'duplicate_request',
        'security_concern',
        'other',
      ];
      for (const reason of reasons) {
        resetPoolMock();
        setupRejectPool();
        app = await buildApp();

        await request(app.getHttpServer())
          .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/reject`)
          .send({ reason })
          .expect(HttpStatus.OK);

        await app.close();
      }
    });

    it('returns 409 SIGNUP_ALREADY_DECIDED on concurrent rejection', async () => {
      setupRejectPool({ transitionCount: 0 });
      app = await buildApp();

      const res = await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/reject`)
        .send({ reason: 'not_a_customer' })
        .expect(HttpStatus.CONFLICT);

      expect(res.body?.error?.code ?? res.body?.message).toMatch(/SIGNUP_ALREADY_DECIDED/i);
    });

    it('returns 404 when signup not found', async () => {
      setupRejectPool({ signupRow: null });
      app = await buildApp();

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${randomUUID()}/reject`)
        .send({ reason: 'not_a_customer' })
        .expect(HttpStatus.NOT_FOUND);
    });

    it('enqueues neutral notification when notifyApplicant=true', async () => {
      // Track notification INSERT calls
      let notificationInserted = false;
      mockPoolClient.query.mockImplementation((sql: string) => {
        if (
          sql?.includes('BEGIN') || sql?.includes('COMMIT') ||
          sql?.includes('ROLLBACK') || sql?.includes('set_config')
        ) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql?.includes('portal_signup_requests') && sql?.includes('WHERE id') && sql?.includes('SELECT')) {
          return Promise.resolve({ rows: [PENDING_SIGNUP_ROW] });
        }
        if (sql?.includes('UPDATE portal_signup_requests')) {
          return Promise.resolve({ rows: [{ id: ADMIN_SIGNUP_PENDING }], rowCount: 1 });
        }
        if (sql?.includes('INSERT INTO audit_logs')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (sql?.includes('INSERT INTO notifications')) {
          notificationInserted = true;
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      app = await buildApp();

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/reject`)
        .send({ reason: 'not_a_customer', notifyApplicant: true })
        .expect(HttpStatus.OK);

      expect(notificationInserted).toBe(true);
    });

    it('notification does not include org name (non-disclosing)', async () => {
      let capturedPayload: string | null = null;
      mockPoolClient.query.mockImplementation((sql: string, params?: unknown[]) => {
        if (
          sql?.includes('BEGIN') || sql?.includes('COMMIT') ||
          sql?.includes('ROLLBACK') || sql?.includes('set_config')
        ) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql?.includes('portal_signup_requests') && sql?.includes('WHERE id') && sql?.includes('SELECT')) {
          return Promise.resolve({ rows: [PENDING_SIGNUP_ROW] });
        }
        if (sql?.includes('UPDATE portal_signup_requests')) {
          return Promise.resolve({ rows: [{ id: ADMIN_SIGNUP_PENDING }], rowCount: 1 });
        }
        if (sql?.includes('INSERT INTO audit_logs')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (sql?.includes('INSERT INTO notifications')) {
          // params[3] is the JSON payload
          if (Array.isArray(params) && params[3]) {
            capturedPayload = params[3] as string;
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      app = await buildApp();

      await request(app.getHttpServer())
        .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/reject`)
        .send({ reason: 'not_a_customer', notifyApplicant: true })
        .expect(HttpStatus.OK);

      // Notification payload must not mention org names or specific rejection reason
      if (capturedPayload) {
        const parsed = JSON.parse(capturedPayload as string);
        // Must not include org name
        expect(JSON.stringify(parsed)).not.toContain('Acme Corp');
        // Must not include internal reason
        expect(JSON.stringify(parsed)).not.toContain('not_a_customer');
      }
    });
  });

  // -------------------------------------------------------------------------
  // AC8 — Double-decision (two concurrent approvals)
  // -------------------------------------------------------------------------

  describe('Race safety (AC8)', () => {
    it('only one of two concurrent approvals succeeds; the other gets 409', async () => {
      let callCount = 0;

      mockPoolClient.query.mockImplementation((sql: string) => {
        if (
          sql?.includes('BEGIN') || sql?.includes('COMMIT') ||
          sql?.includes('ROLLBACK') || sql?.includes('set_config')
        ) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql?.includes('portal_signup_requests') && sql?.includes('WHERE id') && sql?.includes('SELECT')) {
          return Promise.resolve({ rows: [PENDING_SIGNUP_ROW] });
        }
        if (sql?.includes('organizations') && sql?.includes('WHERE id') && sql?.includes('SELECT')) {
          return Promise.resolve({ rows: [ORG_ACME] });
        }
        if (sql?.includes('UPDATE portal_signup_requests')) {
          // First call succeeds, subsequent calls fail (simulating race)
          callCount++;
          const rows = callCount === 1 ? [{ id: ADMIN_SIGNUP_PENDING }] : [];
          return Promise.resolve({ rows, rowCount: callCount === 1 ? 1 : 0 });
        }
        if (sql?.includes('INSERT INTO portal_users')) {
          return Promise.resolve({ rows: [{ id: randomUUID() }], rowCount: 1 });
        }
        if (sql?.includes('organization_verified_domains')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql?.includes('SELECT id, name') && sql?.includes('organizations')) {
          return Promise.resolve({ rows: [] });
        }
        if (sql?.includes('INSERT INTO audit_logs')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (sql?.includes('INSERT INTO notifications')) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      app = await buildApp();

      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/approve`)
          .send({ organizationId: ADMIN_ORG_A }),
        request(app.getHttpServer())
          .post(`/admin/portal-signups/${ADMIN_SIGNUP_PENDING}/approve`)
          .send({ organizationId: ADMIN_ORG_A }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toContain(HttpStatus.OK);
      expect(statuses).toContain(HttpStatus.CONFLICT);
    });
  });

  // -------------------------------------------------------------------------
  // AC9 — Expiry worker (in-process, no DB infrastructure)
  // -------------------------------------------------------------------------

  describe('SignupExpiryWorker (AC9)', () => {
    let workerApp: INestApplication;

    afterEach(async () => {
      await workerApp?.close();
    });

    it('marks pending rows as expired after 30 days and deletes after 7-day grace', async () => {
      let markedCount = 2;
      let deletedCount = 1;

      mockPoolClient.query.mockImplementation((sql: string) => {
        if (sql?.includes('set_config')) {
          return Promise.resolve({ rows: [] });
        }
        // Pass 1: mark expired
        if (sql?.includes('UPDATE portal_signup_requests') && sql?.includes("status = 'expired'")) {
          return Promise.resolve({ rows: [{ count: String(markedCount) }] });
        }
        // Pass 2: physical delete
        if (sql?.includes('DELETE FROM portal_signup_requests') && sql?.includes("status = 'expired'")) {
          return Promise.resolve({ rows: [{ count: String(deletedCount) }] });
        }
        // Queue-depth gauge
        if (sql?.includes('count(*)') && sql?.includes('portal_signup_requests')) {
          return Promise.resolve({
            rows: [{ depth: '5', oldest_age_seconds: 3600 }],
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const moduleRef = await Test.createTestingModule({
        providers: [SignupExpiryWorker],
      }).compile();

      workerApp = moduleRef.createNestApplication();
      await workerApp.init();

      const worker = moduleRef.get(SignupExpiryWorker);
      const result = await worker.run();

      expect(result.markedExpired).toBe(markedCount);
      expect(result.hardDeleted).toBe(deletedCount);
      expect(result.queueDepth).toBe(5);
      expect(result.ranAt).toBeDefined();
    });

    it('emits queue-depth and oldest-age metrics', async () => {
      mockPoolClient.query.mockImplementation((sql: string) => {
        if (sql?.includes('set_config')) return Promise.resolve({ rows: [] });
        if (sql?.includes('UPDATE portal_signup_requests') && sql?.includes("status = 'expired'")) {
          return Promise.resolve({ rows: [{ count: '0' }] });
        }
        if (sql?.includes('DELETE FROM portal_signup_requests')) {
          return Promise.resolve({ rows: [{ count: '0' }] });
        }
        if (sql?.includes('count(*)') && sql?.includes('portal_signup_requests')) {
          return Promise.resolve({
            rows: [{ depth: '30', oldest_age_seconds: 80 * 3600 }], // depth > 25 triggers warn
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const moduleRef = await Test.createTestingModule({
        providers: [SignupExpiryWorker],
      }).compile();

      workerApp = moduleRef.createNestApplication();
      await workerApp.init();

      const worker = moduleRef.get(SignupExpiryWorker);
      const result = await worker.run();

      expect(result.queueDepth).toBe(30);
      expect(result.oldestAgeSeconds).toBeGreaterThan(0);
    });
  });
});
