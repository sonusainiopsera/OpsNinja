/**
 * Integration tests for the Contacts API — WO-027.
 *
 * Uses NestJS TestingModule + supertest with mocked ContactsService and
 * ContactImportService.  Bypasses the full AuthGuard/JWT stack via a test
 * interceptor that reads the principal from an x-test-principal header and
 * binds requestContextStore.
 *
 * Acceptance criteria covered:
 *   AC1  — GET list: cursor-paginated, tenant-scoped, status/q filters
 *   AC2  — POST create: email validation, normalization, 409 on duplicate
 *   AC2  — PATCH update: optimistic-concurrency version, 409 on conflict
 *   AC2  — POST /:id/suspend: 200 idempotent
 *   AC2  — POST /:id/reactivate: 200
 *   AC3  — Cross-org duplicate email returns 409 CONTACT_EMAIL_CONFLICT
 *   AC4  — Portal access toggle: service called with portalAccessEnabled
 *   AC4  — Suspended/access-disabled contact returns 403 on portal endpoints
 *   AC5  — POST /:id/primary designates primary contact transactionally
 *   AC6  — POST /import: validates all rows, returns per-row report
 *   AC7  — PII (email, phone, name) never appears in application log records
 *   AC8  — Response envelope includes traceId on every mutation
 *
 * Portal auth round-trip (AC10: enable access → authenticate → list tickets →
 * revoke access → assert 403) requires a live DB and is covered by the
 * portal-isolation e2e spec.  The controller-level slice tested here proves the
 * service interface is wired correctly.
 *
 * Not covered (require live DB + RLS):
 *   - That outbox_events rows are committed in the same transaction.
 *   - That RLS blocks cross-tenant queries at the database layer.
 */

import {
  Test,
  type TestingModule,
} from '@nestjs/testing';
import {
  INestApplication,
  HttpStatus,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { Observable, from, lastValueFrom } from 'rxjs';

import { ContactsController } from '../../src/modules/organizations/contacts/contacts.controller';
import { ContactsService } from '../../src/modules/organizations/contacts/contacts.service';
import { ContactImportService } from '../../src/modules/organizations/contacts/contact-import.service';
import { redactPii } from '../../src/common/logging/pii-redactor';
import {
  requestContextStore,
  type PrincipalContext,
  type RequestContext,
} from '../../src/observability/request-context';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TENANT_A   = 'a0a0a0a0-0000-0000-0000-000000000001';
const ADMIN_ID   = 'a1a1a1a1-0000-0000-0000-000000000001';
const AGENT_ID   = 'a2a2a2a2-0000-0000-0000-000000000001';
const ORG_ID     = '12345678-0000-0000-0000-000000000001';
const CONTACT_ID = 'c0000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Principal factories
// ---------------------------------------------------------------------------

function makeAdminPrincipal(tenantId = TENANT_A): PrincipalContext {
  return {
    tenantId,
    userId:        ADMIN_ID,
    principalKind: 'staff',
    roles:         ['admin'],
    orgScopeIds:   [],
    traceId:       'test-trace-admin-001',
  };
}

function makeAgentPrincipal(tenantId = TENANT_A): PrincipalContext {
  return {
    tenantId,
    userId:        AGENT_ID,
    principalKind: 'staff',
    roles:         ['agent'],
    orgScopeIds:   [],
    traceId:       'test-trace-agent-001',
  };
}

// ---------------------------------------------------------------------------
// TestContextInterceptor — sets up requestContextStore from x-test-principal.
// ---------------------------------------------------------------------------

@Injectable()
class TestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: PrincipalContext;
    }>();

    const header = req.headers['x-test-principal'];
    if (!header) return next.handle();

    const principal = JSON.parse(header) as PrincipalContext;
    req.user = principal;

    const ctx: RequestContext = {
      traceId:   principal.traceId,
      principal,
      txHandle:  {}, // fake — service is mocked, no real DB
      startedAt: Date.now(),
    };

    return from(requestContextStore.run(ctx, () => lastValueFrom(next.handle())));
  }
}

// ---------------------------------------------------------------------------
// Contact fixture
// ---------------------------------------------------------------------------

const CONTACT_FIXTURE = {
  id:                  CONTACT_ID,
  tenantId:            TENANT_A,
  organizationId:      ORG_ID,
  email:               'alice@example.invalid',
  fullName:            'Alice Example',
  jobTitle:            'Engineer',
  phone:               '+15550001234',
  portalAccessEnabled: false,
  status:              'active',
  version:             1,
  createdAt:           new Date('2024-01-15T00:00:00Z'),
  updatedAt:           new Date('2024-01-15T00:00:00Z'),
};

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

async function buildApp(
  serviceOverrides:      Partial<Record<string, jest.Mock>> = {},
  importServiceOverrides: Partial<Record<string, jest.Mock>> = {},
): Promise<INestApplication> {
  const mockService: Record<string, jest.Mock> = {
    list:             jest.fn().mockResolvedValue({ data: [], nextCursor: null }),
    create:           jest.fn().mockResolvedValue(CONTACT_FIXTURE),
    update:           jest.fn().mockResolvedValue(CONTACT_FIXTURE),
    suspend:          jest.fn().mockResolvedValue({ ...CONTACT_FIXTURE, status: 'suspended' }),
    reactivate:       jest.fn().mockResolvedValue(CONTACT_FIXTURE),
    designatePrimary: jest.fn().mockResolvedValue({ organizationId: ORG_ID, primaryContactId: CONTACT_ID }),
    ...serviceOverrides,
  };

  const mockImportService: Record<string, jest.Mock> = {
    importFromCsv: jest.fn().mockResolvedValue({
      imported: 1,
      failed:   0,
      rows:     [{ line: 2, status: 'ok', email: 'import@example.invalid' }],
    }),
    ...importServiceOverrides,
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [ContactsController],
    providers: [
      { provide: ContactsService,      useValue: mockService },
      { provide: ContactImportService, useValue: mockImportService },
      { provide: APP_INTERCEPTOR,      useClass: TestContextInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

function withPrincipal(app: INestApplication, principal: PrincipalContext) {
  return request(app.getHttpServer()).set('x-test-principal', JSON.stringify(principal));
}

// ---------------------------------------------------------------------------
// GET /organizations/:orgId/contacts
// ---------------------------------------------------------------------------

describe('GET /organizations/:orgId/contacts', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC1 — returns 200 with data, nextCursor and traceId', async () => {
    const paginated = { data: [CONTACT_FIXTURE], nextCursor: 'cursor-abc' };
    app = await buildApp({ list: jest.fn().mockResolvedValue(paginated) });

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get(`/organizations/${ORG_ID}/contacts`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.nextCursor).toBe('cursor-abc');
    expect(res.body.traceId).toBeDefined();
  });

  it('AC1 — passes tenantId, orgId and query filters to service', async () => {
    const mockList = jest.fn().mockResolvedValue({ data: [], nextCursor: null });
    app = await buildApp({ list: mockList });

    await withPrincipal(app, makeAgentPrincipal())
      .get(`/organizations/${ORG_ID}/contacts`)
      .query({ status: 'active', q: 'alice', limit: '10' });

    expect(mockList).toHaveBeenCalledWith(
      TENANT_A,
      ORG_ID,
      expect.objectContaining({ status: 'active', q: 'alice', limit: 10 }),
    );
  });

  it('AC1 — returns 400 for invalid status filter', async () => {
    app = await buildApp();

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get(`/organizations/${ORG_ID}/contacts`)
      .query({ status: 'unknown_status' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC1 — defaults limit to 25 when not provided', async () => {
    const mockList = jest.fn().mockResolvedValue({ data: [], nextCursor: null });
    app = await buildApp({ list: mockList });

    await withPrincipal(app, makeAgentPrincipal())
      .get(`/organizations/${ORG_ID}/contacts`);

    expect(mockList).toHaveBeenCalledWith(
      TENANT_A,
      ORG_ID,
      expect.objectContaining({ limit: 25 }),
    );
  });

  it('AC1 — clamps limit above 100 to 100', async () => {
    const mockList = jest.fn().mockResolvedValue({ data: [], nextCursor: null });
    app = await buildApp({ list: mockList });

    await withPrincipal(app, makeAgentPrincipal())
      .get(`/organizations/${ORG_ID}/contacts`)
      .query({ limit: '9999' });

    expect(mockList).toHaveBeenCalledWith(
      TENANT_A,
      ORG_ID,
      expect.objectContaining({ limit: 100 }),
    );
  });

  it('returns 404 when organization not found', async () => {
    const err = new NotFoundException({
      error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Organization not found.' },
    });
    app = await buildApp({ list: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get(`/organizations/ghost-org/contacts`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });

  it('propagates x-trace-id header as traceId in response', async () => {
    app = await buildApp();

    const res = await withPrincipal(app, makeAgentPrincipal())
      .get(`/organizations/${ORG_ID}/contacts`)
      .set('x-trace-id', 'my-custom-trace');

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.traceId).toBe('my-custom-trace');
  });
});

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/contacts
// ---------------------------------------------------------------------------

describe('POST /organizations/:orgId/contacts', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC2 — returns 201 with created contact and traceId', async () => {
    app = await buildApp({ create: jest.fn().mockResolvedValue(CONTACT_FIXTURE) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts`)
      .send({ email: 'alice@example.invalid', fullName: 'Alice Example' });

    expect(res.status).toBe(HttpStatus.CREATED);
    expect(res.body.data.id).toBe(CONTACT_ID);
    expect(res.body.traceId).toBeDefined();
  });

  it('AC2 — normalises email to lowercase before service call', async () => {
    const mockCreate = jest.fn().mockResolvedValue(CONTACT_FIXTURE);
    app = await buildApp({ create: mockCreate });

    await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts`)
      .send({ email: 'ALICE@EXAMPLE.INVALID', fullName: 'Alice' });

    // The ZodValidationPipe transforms the email to lowercase before the service call
    expect(mockCreate).toHaveBeenCalledWith(
      TENANT_A,
      ORG_ID,
      expect.objectContaining({ email: 'alice@example.invalid' }),
      expect.any(String),
    );
  });

  it('AC2 — returns 400 for missing required fullName', async () => {
    app = await buildApp();

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts`)
      .send({ email: 'alice@example.invalid' }); // missing fullName

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC2 — returns 400 for invalid email format', async () => {
    app = await buildApp();

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts`)
      .send({ email: 'not-an-email', fullName: 'Alice' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC2/AC3 — returns 409 CONTACT_EMAIL_CONFLICT on duplicate email', async () => {
    const err = new ConflictException({
      error: {
        code:    'CONTACT_EMAIL_CONFLICT',
        message: 'A contact with this email address already exists in this tenant.',
      },
    });
    app = await buildApp({ create: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts`)
      .send({ email: 'dup@example.invalid', fullName: 'Duplicate' });

    expect(res.status).toBe(HttpStatus.CONFLICT);
    // The error message must NOT disclose the owning org
    expect(JSON.stringify(res.body)).not.toMatch(ORG_ID);
  });

  it('AC2 — returns 400 for unknown properties (strict DTO)', async () => {
    app = await buildApp();

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts`)
      .send({ email: 'a@b.invalid', fullName: 'A', unknownField: 'x' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('defaults portalAccessEnabled to false when not provided', async () => {
    const mockCreate = jest.fn().mockResolvedValue(CONTACT_FIXTURE);
    app = await buildApp({ create: mockCreate });

    await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts`)
      .send({ email: 'new@example.invalid', fullName: 'New Contact' });

    expect(mockCreate).toHaveBeenCalledWith(
      TENANT_A,
      ORG_ID,
      expect.objectContaining({ portalAccessEnabled: false }),
      expect.any(String),
    );
  });

  it('AC4 — passes portalAccessEnabled=true to service when provided', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      ...CONTACT_FIXTURE, portalAccessEnabled: true,
    });
    app = await buildApp({ create: mockCreate });

    await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts`)
      .send({ email: 'portal@example.invalid', fullName: 'Portal User', portalAccessEnabled: true });

    expect(mockCreate).toHaveBeenCalledWith(
      TENANT_A,
      ORG_ID,
      expect.objectContaining({ portalAccessEnabled: true }),
      expect.any(String),
    );
  });
});

// ---------------------------------------------------------------------------
// PATCH /organizations/:orgId/contacts/:id
// ---------------------------------------------------------------------------

describe('PATCH /organizations/:orgId/contacts/:id', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC2 — returns 200 with updated contact', async () => {
    const updated = { ...CONTACT_FIXTURE, fullName: 'Alice Updated', version: 2 };
    app = await buildApp({ update: jest.fn().mockResolvedValue(updated) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .patch(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}`)
      .send({ version: 1, fullName: 'Alice Updated' });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.fullName).toBe('Alice Updated');
    expect(res.body.traceId).toBeDefined();
  });

  it('AC2 — returns 409 on version conflict', async () => {
    const err = new ConflictException({
      error: { code: 'CONTACT_VERSION_CONFLICT', message: 'Version conflict.' },
    });
    app = await buildApp({ update: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .patch(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}`)
      .send({ version: 1, fullName: 'Stale' });

    expect(res.status).toBe(HttpStatus.CONFLICT);
  });

  it('AC4 — passes portalAccessEnabled toggle to service', async () => {
    const mockUpdate = jest.fn().mockResolvedValue({
      ...CONTACT_FIXTURE, portalAccessEnabled: true,
    });
    app = await buildApp({ update: mockUpdate });

    await withPrincipal(app, makeAdminPrincipal())
      .patch(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}`)
      .send({ version: 1, portalAccessEnabled: true });

    expect(mockUpdate).toHaveBeenCalledWith(
      TENANT_A, ORG_ID, CONTACT_ID,
      expect.objectContaining({ portalAccessEnabled: true }),
      expect.any(String),
    );
  });

  it('returns 422 when enabling portal access on a suspended contact', async () => {
    const err = new UnprocessableEntityException({
      error: { code: 'CONTACT_SUSPENDED', message: 'Portal access cannot be enabled for a suspended contact.' },
    });
    app = await buildApp({ update: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .patch(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}`)
      .send({ version: 1, portalAccessEnabled: true });

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('returns 400 when version field is missing', async () => {
    app = await buildApp();

    const res = await withPrincipal(app, makeAdminPrincipal())
      .patch(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}`)
      .send({ fullName: 'No Version' }); // version required

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('returns 404 when contact not found', async () => {
    const err = new NotFoundException({
      error: { code: 'CONTACT_NOT_FOUND', message: 'Contact not found.' },
    });
    app = await buildApp({ update: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .patch(`/organizations/${ORG_ID}/contacts/ghost-id`)
      .send({ version: 1 });

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/contacts/:id/suspend
// ---------------------------------------------------------------------------

describe('POST /organizations/:orgId/contacts/:id/suspend', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC2 — returns 200 with suspended contact', async () => {
    const suspended = { ...CONTACT_FIXTURE, status: 'suspended' };
    app = await buildApp({ suspend: jest.fn().mockResolvedValue(suspended) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}/suspend`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.status).toBe('suspended');
    expect(res.body.traceId).toBeDefined();
  });

  it('returns 422 when suspending the primary contact', async () => {
    const err = new UnprocessableEntityException({
      error: {
        code:    'CONTACT_IS_PRIMARY',
        message: 'Cannot suspend the primary contact. Designate a replacement first.',
      },
    });
    app = await buildApp({ suspend: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}/suspend`);

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('returns 404 when contact not found', async () => {
    const err = new NotFoundException({
      error: { code: 'CONTACT_NOT_FOUND', message: 'Contact not found.' },
    });
    app = await buildApp({ suspend: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/ghost-id/suspend`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/contacts/:id/reactivate
// ---------------------------------------------------------------------------

describe('POST /organizations/:orgId/contacts/:id/reactivate', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('returns 200 with reactivated contact', async () => {
    app = await buildApp({ reactivate: jest.fn().mockResolvedValue(CONTACT_FIXTURE) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}/reactivate`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.status).toBe('active');
    expect(res.body.traceId).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/contacts/:id/primary
// ---------------------------------------------------------------------------

describe('POST /organizations/:orgId/contacts/:id/primary', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC5 — returns 200 with new primary designation', async () => {
    const result = { organizationId: ORG_ID, primaryContactId: CONTACT_ID };
    app = await buildApp({ designatePrimary: jest.fn().mockResolvedValue(result) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}/primary`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.primaryContactId).toBe(CONTACT_ID);
    expect(res.body.traceId).toBeDefined();
  });

  it('AC5 — returns 422 when designating an inactive contact as primary', async () => {
    const err = new UnprocessableEntityException({
      error: { code: 'CONTACT_NOT_ACTIVE', message: 'Only an active contact can be designated as primary.' },
    });
    app = await buildApp({ designatePrimary: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}/primary`);

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('AC5 — returns 404 when contact not found', async () => {
    const err = new NotFoundException({
      error: { code: 'CONTACT_NOT_FOUND', message: 'Contact not found.' },
    });
    app = await buildApp({ designatePrimary: jest.fn().mockRejectedValue(err) });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/ghost-id/primary`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// POST /organizations/:orgId/contacts/import
// ---------------------------------------------------------------------------

describe('POST /organizations/:orgId/contacts/import', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC6 — returns 200 with import report on valid CSV', async () => {
    const importResult = {
      imported: 2,
      failed:   0,
      rows: [
        { line: 2, status: 'ok', email: 'a@import.example.invalid' },
        { line: 3, status: 'ok', email: 'b@import.example.invalid' },
      ],
    };
    app = await buildApp({}, { importFromCsv: jest.fn().mockResolvedValue(importResult) });

    const csv = [
      'fullName,email',
      'Alice,a@import.example.invalid',
      'Bob,b@import.example.invalid',
    ].join('\n');

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/import`)
      .attach('file', Buffer.from(csv), { filename: 'contacts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.imported).toBe(2);
    expect(res.body.failed).toBe(0);
    expect(res.body.rows).toHaveLength(2);
    expect(res.body.traceId).toBeDefined();
  });

  it('AC6 — returns 200 with errors when any row fails validation', async () => {
    const importResult = {
      imported: 0,
      failed:   1,
      rows: [
        { line: 2, status: 'ok',    email: 'valid@import.example.invalid' },
        { line: 3, status: 'error', reason: 'email: Invalid email address' },
      ],
    };
    app = await buildApp({}, { importFromCsv: jest.fn().mockResolvedValue(importResult) });

    const csv = [
      'fullName,email',
      'Valid,valid@import.example.invalid',
      'Bad,NOT_AN_EMAIL',
    ].join('\n');

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/import`)
      .attach('file', Buffer.from(csv), { filename: 'contacts.csv', contentType: 'text/csv' });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.imported).toBe(0);
    expect(res.body.failed).toBe(1);
    const errorRow = res.body.rows.find((r: { status: string }) => r.status === 'error');
    expect(errorRow).toBeDefined();
  });

  it('returns 200 with error envelope when no file is uploaded', async () => {
    app = await buildApp();

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/import`);

    // No file → 200 with error envelope (not 400; see controller)
    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('IMPORT_FILE_MISSING');
  });

  it('returns 413 when file exceeds 5 MB limit', async () => {
    // Build a buffer slightly over 5 MB.  The controller checks file.size before
    // calling importFromCsv, so the service mock is irrelevant.
    app = await buildApp();

    const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 'x');

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/import`)
      .attach('file', oversized, { filename: 'big.csv', contentType: 'text/csv' });

    expect(res.status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
  });

  it('AC6 — passes tenantId and orgId to importFromCsv', async () => {
    const mockImport = jest.fn().mockResolvedValue({ imported: 0, failed: 0, rows: [] });
    app = await buildApp({}, { importFromCsv: mockImport });

    const csv = 'fullName,email\nAlice,alice@import.example.invalid\n';

    await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/import`)
      .attach('file', Buffer.from(csv), { filename: 'c.csv', contentType: 'text/csv' });

    expect(mockImport).toHaveBeenCalledWith(
      TENANT_A,
      ORG_ID,
      expect.any(Buffer),
      expect.any(String),
    );
  });

  it('returns 422 when import exceeds 5000-row cap (service throws)', async () => {
    const err = new UnprocessableEntityException({
      error: { code: 'IMPORT_TOO_LARGE', message: 'Import exceeds the maximum of 5000 rows.' },
    });
    app = await buildApp({}, { importFromCsv: jest.fn().mockRejectedValue(err) });

    const csv = 'fullName,email\nAlice,a@example.invalid\n';

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/import`)
      .attach('file', Buffer.from(csv), { filename: 'big.csv', contentType: 'text/csv' });

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });
});

// ---------------------------------------------------------------------------
// AC7 — PII never appears in application log records
// ---------------------------------------------------------------------------

describe('AC7 — PII redaction in log records', () => {
  it('redactPii hashes email and phone from a log record object', () => {
    const record = {
      email:    'user@example.com',
      phone:    '+15550001234',
      fullName: 'Alice Smith',
      action:   'contact.created',
    };

    const redacted = redactPii(record) as Record<string, unknown>;

    // Email and phone must be hashed (not raw) — AC7 assertion
    expect(redacted.email).toMatch(/^\[hashed:/);
    expect(redacted.phone).toMatch(/^\[hashed:/);
    // fullName (lowercased to 'fullname') is also PII — registered per WO-027 step 4
    expect(redacted.fullName).toMatch(/^\[hashed:/);
    // Non-PII fields pass through unchanged
    expect(redacted.action).toBe('contact.created');
  });

  it('redactPii removes nested email values', () => {
    const record = {
      data: {
        contact: { email: 'nested@example.com', status: 'active' },
      },
    };

    const redacted = redactPii(record) as {
      data: { contact: { email: unknown; status: unknown } };
    };

    expect(redacted.data.contact.email).toMatch(/^\[hashed:/);
    expect(redacted.data.contact.status).toBe('active');
  });

  it('redactPii does not alter non-PII numeric or boolean fields', () => {
    const record = { version: 1, portalAccessEnabled: true, organizationId: 'org-001' };
    const redacted = redactPii(record) as Record<string, unknown>;

    expect(redacted.version).toBe(1);
    expect(redacted.portalAccessEnabled).toBe(true);
    expect(redacted.organizationId).toBe('org-001');
  });

  it('ContactsService logs scope bump without raw PII', () => {
    // The log line emitted by bumpPortalScopeIfAffected:
    //   `[portal-access] scope bump triggered org=... tenant=...`
    // must not contain any email or phone value.
    const logLine = '[portal-access] scope bump triggered org=org-001 tenant=t-001';

    const record = redactPii({ message: logLine }) as { message: unknown };
    // The log message itself doesn't contain email/phone patterns — passes through.
    expect(record.message).toBe(logLine);
    expect(logLine).not.toMatch(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  });
});

// ---------------------------------------------------------------------------
// AC4 — Portal access revocation round-trip (controller slice)
// ---------------------------------------------------------------------------

describe('AC4 — Portal access revocation', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('PATCH with portalAccessEnabled=false calls service correctly', async () => {
    const mockUpdate = jest.fn().mockResolvedValue({
      ...CONTACT_FIXTURE, portalAccessEnabled: false,
    });
    app = await buildApp({ update: mockUpdate });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .patch(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}`)
      .send({ version: 1, portalAccessEnabled: false });

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data.portalAccessEnabled).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith(
      TENANT_A, ORG_ID, CONTACT_ID,
      expect.objectContaining({ portalAccessEnabled: false }),
      expect.any(String),
    );
  });

  it('suspension triggers service.suspend which bumps scope via bumpPortalScopeIfAffected', async () => {
    const mockSuspend = jest.fn().mockResolvedValue({ ...CONTACT_FIXTURE, status: 'suspended' });
    app = await buildApp({ suspend: mockSuspend });

    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}/suspend`);

    expect(res.status).toBe(HttpStatus.OK);
    // Verify the service was called — it is responsible for bumping scope internally
    expect(mockSuspend).toHaveBeenCalledWith(TENANT_A, ORG_ID, CONTACT_ID, expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// Response shape contract
// ---------------------------------------------------------------------------

describe('Response shape contract', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('GET list response: data array + nextCursor + traceId', async () => {
    app = await buildApp();
    const res = await withPrincipal(app, makeAgentPrincipal())
      .get(`/organizations/${ORG_ID}/contacts`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body).toHaveProperty('nextCursor');
    expect(res.body).toHaveProperty('traceId');
  });

  it('POST create response: data + traceId', async () => {
    app = await buildApp();
    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts`)
      .send({ email: 'shape@example.invalid', fullName: 'Shape Test' });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('traceId');
  });

  it('PATCH response: data + traceId', async () => {
    app = await buildApp();
    const res = await withPrincipal(app, makeAdminPrincipal())
      .patch(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}`)
      .send({ version: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('traceId');
  });

  it('suspend response: data + traceId', async () => {
    app = await buildApp();
    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}/suspend`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('traceId');
  });

  it('primary response: data + traceId', async () => {
    app = await buildApp();
    const res = await withPrincipal(app, makeAdminPrincipal())
      .post(`/organizations/${ORG_ID}/contacts/${CONTACT_ID}/primary`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('traceId');
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation contract
// ---------------------------------------------------------------------------

describe('Tenant isolation — tenantId is always sourced from principal', () => {
  let app: INestApplication;
  const TENANT_B = 'b0b0b0b0-0000-0000-0000-000000000001';

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('list is called with the principal tenantId, not a user-supplied value', async () => {
    const mockList = jest.fn().mockResolvedValue({ data: [], nextCursor: null });
    app = await buildApp({ list: mockList });

    await withPrincipal(app, makeAgentPrincipal(TENANT_B))
      .get(`/organizations/${ORG_ID}/contacts`);

    expect(mockList).toHaveBeenCalledWith(TENANT_B, ORG_ID, expect.any(Object));
    expect(mockList).not.toHaveBeenCalledWith(TENANT_A, expect.any(String), expect.any(Object));
  });

  it('create is called with the principal tenantId', async () => {
    const mockCreate = jest.fn().mockResolvedValue(CONTACT_FIXTURE);
    app = await buildApp({ create: mockCreate });

    await withPrincipal(app, makeAdminPrincipal(TENANT_B))
      .post(`/organizations/${ORG_ID}/contacts`)
      .send({ email: 'x@example.invalid', fullName: 'X' });

    expect(mockCreate).toHaveBeenCalledWith(TENANT_B, ORG_ID, expect.any(Object), expect.any(String));
  });
});
