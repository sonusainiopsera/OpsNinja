/**
 * Integration tests for the Organization Audit API — WO-030.
 *
 * Uses NestJS TestingModule + supertest with mocked AuditQueryService and
 * OrganizationsRepository.  TestContextInterceptor provides principal context
 * via x-test-principal header so the full AuthGuard/JWT stack is bypassed.
 *
 * Covers per acceptance criteria:
 *   AC3  — GET list: 200, cursor-paginated, filtered by operation/actorId/actorType/from/to
 *   AC4  — Diff payloads mask PII fields (email, phone, name) with redacted marker
 *   AC7  — GET export: CSV stream with headers + rows; 422 AUDIT_EXPORT_TOO_LARGE on cap
 *   AC10 — Immutability (no DB → stub-enforced); cross-tenant 404 non-disclosure
 *   AC11 — Multi-operation, multi-actor, multi-date fixtures exercised by filter tests
 *
 * AC2 (DB grants), AC6 (transactional atomicity), and the partition-management
 * tests require a live database and are skipped here; they belong in the
 * end-to-end DB integration suite (apps/api/test/e2e/).
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
  NotFoundException,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import * as request from 'supertest';
import { Observable, from, lastValueFrom } from 'rxjs';

import { OrganizationAuditController, AUDIT_EXPORT_ROW_CAP } from '../../src/modules/organizations/audit/organization-audit.controller';
import { AuditQueryService } from '../../src/modules/audit/audit-query.service';
import { OrganizationsRepository } from '../../src/modules/organizations/organizations.repository';
import { REDACTED_MARKER } from '../../src/modules/organizations/audit/org-audit-diff';
import {
  requestContextStore,
  type PrincipalContext,
  type RequestContext,
} from '../../src/observability/request-context';
import {
  ORG_AUDIT_TENANT_A,
  ORG_AUDIT_TENANT_B,
  ORG_AUDIT_ORG_ID,
  AUDIT_ACTOR_STAFF,
  AUDIT_ACTOR_MACHINE,
  ALL_AUDIT_ROWS,
  MACHINE_ACTOR_ROWS,
  ORG_UPDATE_ROWS,
  JANUARY_ROWS,
  ROW_ORG_UPDATE_NAME,
  ROW_ORG_UPDATE_SLA,
  ROW_CONTACT_UPDATE_EMAIL,
  buildExportCapRows,
} from '../fixtures/audit-logs.seed';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNKNOWN_ORG_ID = 'ffffffff-ffff-0000-0000-000000000099';

// ---------------------------------------------------------------------------
// Test principal helpers
// ---------------------------------------------------------------------------

function makeAdminPrincipal(tenantId: string = ORG_AUDIT_TENANT_A): PrincipalContext {
  return {
    tenantId,
    userId:        AUDIT_ACTOR_STAFF,
    principalKind: 'staff',
    roles:         ['admin'],
    orgScopeIds:   [],
    traceId:       'trace-test-audit-admin',
  };
}

// ---------------------------------------------------------------------------
// TestContextInterceptor (same pattern as organizations.api.spec.ts)
// ---------------------------------------------------------------------------

@Injectable()
class TestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string>;
      user?: PrincipalContext;
    }>();

    const principalHeader = req.headers['x-test-principal'];
    if (!principalHeader) {
      return next.handle();
    }

    const principal = JSON.parse(principalHeader) as PrincipalContext;
    req.user = principal;

    const ctx: RequestContext = {
      traceId:   principal.traceId,
      principal,
      txHandle:  {},
      startedAt: Date.now(),
    };

    return from(requestContextStore.run(ctx, () => lastValueFrom(next.handle())));
  }
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

const ORG_STUB = { id: ORG_AUDIT_ORG_ID, tenantId: ORG_AUDIT_TENANT_A };

async function buildApp(overrides: {
  auditList?: jest.Mock;
  orgFindById?: jest.Mock;
}): Promise<{ app: INestApplication; auditMock: jest.Mock; orgMock: jest.Mock }> {
  const auditMock = overrides.auditList ??
    jest.fn().mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
  const orgMock = overrides.orgFindById ??
    jest.fn().mockResolvedValue(ORG_STUB);

  const moduleRef: TestingModule = await Test.createTestingModule({
    controllers: [OrganizationAuditController],
    providers: [
      { provide: AuditQueryService,       useValue: { list: auditMock } },
      { provide: OrganizationsRepository, useValue: { findById: orgMock } },
      { provide: APP_INTERCEPTOR, useClass: TestContextInterceptor },
    ],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, auditMock, orgMock };
}

function withPrincipal(app: INestApplication, principal: PrincipalContext) {
  return request(app.getHttpServer()).set(
    'x-test-principal',
    JSON.stringify(principal),
  );
}

// ---------------------------------------------------------------------------
// GET /organizations/:orgId/audit — list
// ---------------------------------------------------------------------------

describe('GET /organizations/:orgId/audit', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  // -- AC3: basic shape --

  it('AC3 — returns 200 with data array, nextCursor and traceId', async () => {
    const result = { data: ALL_AUDIT_ROWS.slice(0, 2), nextCursor: 'cursor-abc', hasMore: true };
    ({ app } = await buildApp({ auditList: jest.fn().mockResolvedValue(result) }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.nextCursor).toBe('cursor-abc');
    expect(res.body.hasMore).toBe(true);
    expect(res.body.traceId).toBeDefined();
  });

  it('AC3 — response entries have the AuditEntryDto shape', async () => {
    const result = { data: [ROW_ORG_UPDATE_NAME], nextCursor: null, hasMore: false };
    ({ app } = await buildApp({ auditList: jest.fn().mockResolvedValue(result) }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`);

    expect(res.status).toBe(HttpStatus.OK);
    const entry = res.body.data[0];
    expect(entry.id).toBe(ROW_ORG_UPDATE_NAME.id);
    expect(entry.occurredAt).toBe(ROW_ORG_UPDATE_NAME.occurredAt.toISOString());
    expect(entry.actor.id).toBe(AUDIT_ACTOR_STAFF);
    expect(entry.actor.type).toBe('staff');
    expect(entry.actor.displayName).toBe('Alice Admin');
    expect(entry.operation).toBe('organization.update');
    expect(entry.resourceType).toBe('organization');
    expect(entry.resourceId).toBe(ORG_AUDIT_ORG_ID);
    expect(Array.isArray(entry.diff)).toBe(true);
    expect(entry.traceId).toBe(ROW_ORG_UPDATE_NAME.traceId);
  });

  it('AC3 — returns 200 with empty data and null nextCursor when no records', async () => {
    ({ app } = await buildApp({}));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.hasMore).toBe(false);
  });

  // -- AC4: PII masking in diff --

  it('AC4 — diff masks name field with redacted marker, redacted=true', async () => {
    const result = { data: [ROW_ORG_UPDATE_NAME], nextCursor: null, hasMore: false };
    ({ app } = await buildApp({ auditList: jest.fn().mockResolvedValue(result) }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`);

    expect(res.status).toBe(HttpStatus.OK);
    const diffEntry = res.body.data[0].diff.find((d: { field: string }) => d.field === 'name');
    expect(diffEntry).toBeDefined();
    expect(diffEntry.before).toBe(REDACTED_MARKER);
    expect(diffEntry.after).toBe(REDACTED_MARKER);
    expect(diffEntry.redacted).toBe(true);
  });

  it('AC4 — diff masks email field (contact row) with redacted marker', async () => {
    const result = { data: [ROW_CONTACT_UPDATE_EMAIL], nextCursor: null, hasMore: false };
    ({ app } = await buildApp({ auditList: jest.fn().mockResolvedValue(result) }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`);

    expect(res.status).toBe(HttpStatus.OK);
    const emailDiff = res.body.data[0].diff.find((d: { field: string }) => d.field === 'email');
    expect(emailDiff).toBeDefined();
    expect(emailDiff.before).toBe(REDACTED_MARKER);
    expect(emailDiff.after).toBe(REDACTED_MARKER);
    expect(emailDiff.redacted).toBe(true);
  });

  it('AC4 — non-PII diff field is NOT redacted', async () => {
    const result = { data: [ROW_ORG_UPDATE_SLA], nextCursor: null, hasMore: false };
    ({ app } = await buildApp({ auditList: jest.fn().mockResolvedValue(result) }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`);

    expect(res.status).toBe(HttpStatus.OK);
    const slaDiff = res.body.data[0].diff.find((d: { field: string }) => d.field === 'slaTier');
    expect(slaDiff).toBeDefined();
    expect(slaDiff.before).toBe('standard');
    expect(slaDiff.after).toBe('premium');
    expect(slaDiff.redacted).toBe(false);
  });

  // -- AC3: filter parameters forwarded to AuditQueryService --

  it('AC3 — passes resourceType=organization and resourceId=orgId to service (scope is pinned)', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`);

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'organization',
        resourceId:   ORG_AUDIT_ORG_ID,
      }),
    );
  });

  it('AC3 — passes operation filter as action to service', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: ORG_UPDATE_ROWS, nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`)
      .query({ operation: 'organization.update' });

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'organization.update' }),
    );
  });

  it('AC3 — passes actorId filter to service (multi-actor fixture)', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: MACHINE_ACTOR_ROWS, nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`)
      .query({ actorId: AUDIT_ACTOR_MACHINE });

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: AUDIT_ACTOR_MACHINE }),
    );
  });

  it('AC3 — passes actorType filter to service', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: MACHINE_ACTOR_ROWS, nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`)
      .query({ actorType: 'machine' });

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'machine' }),
    );
  });

  it('AC3 — passes from/to date filters to service (multi-month fixture)', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: JANUARY_ROWS, nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`)
      .query({ from: '2024-01-01', to: '2024-01-31' });

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.any(Date),
        to:   expect.any(Date),
      }),
    );
  });

  it('AC3 — passes cursor and limit to service', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`)
      .query({ cursor: 'opaque-cursor-xyz', limit: '10' });

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'opaque-cursor-xyz', limit: 10 }),
    );
  });

  it('AC3 — default limit is 50 when omitted', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`);

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('AC3 — rejects limit > 100 with 400', async () => {
    ({ app } = await buildApp({}));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`)
      .query({ limit: '101' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC10 — rejects unknown query fields (strict schema) with 400', async () => {
    ({ app } = await buildApp({}));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`)
      .query({ unknownField: 'injection-attempt' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('AC10 — rejects invalid actorType value with 400', async () => {
    ({ app } = await buildApp({}));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`)
      .query({ actorType: 'invalid-type' });

    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  // -- AC10: 404 for missing / cross-tenant org --

  it('AC10 — returns 404 when org does not exist in tenant', async () => {
    const orgMock = jest.fn().mockResolvedValue(null);
    ({ app } = await buildApp({ orgFindById: orgMock }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${UNKNOWN_ORG_ID}/audit`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    expect(res.body.error?.code).toBe('ORGANIZATION_NOT_FOUND');
  });

  it('AC10 — cross-tenant org returns 404 (non-disclosure)', async () => {
    // Tenant B principal cannot see Tenant A's org — orgRepo returns null for wrong tenant
    const orgMock = jest.fn().mockResolvedValue(null);
    ({ app } = await buildApp({ orgFindById: orgMock }));

    const tenantBPrincipal = makeAdminPrincipal(ORG_AUDIT_TENANT_B);
    const res = await withPrincipal(app, tenantBPrincipal)
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
    // orgRepo is called with TENANT_B's tenantId so cross-tenant lookup fails
    expect(orgMock).toHaveBeenCalledWith(ORG_AUDIT_TENANT_B, ORG_AUDIT_ORG_ID);
  });
});

// ---------------------------------------------------------------------------
// GET /organizations/:orgId/audit/export — CSV export
// ---------------------------------------------------------------------------

describe('GET /organizations/:orgId/audit/export', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('AC7 — returns 200 with Content-Type text/csv', async () => {
    const result = { data: ALL_AUDIT_ROWS, nextCursor: null, hasMore: false };
    ({ app } = await buildApp({ auditList: jest.fn().mockResolvedValue(result) }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit/export`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('AC7 — CSV response starts with correct header row', async () => {
    const result = { data: [], nextCursor: null, hasMore: false };
    ({ app } = await buildApp({ auditList: jest.fn().mockResolvedValue(result) }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit/export`);

    expect(res.status).toBe(HttpStatus.OK);
    const firstLine = (res.text as string).split('\r\n')[0];
    expect(firstLine).toBe(
      'id,occurredAt,actorId,actorType,operation,resourceType,resourceId,fields,traceId',
    );
  });

  it('AC7 — CSV response has one data row per audit entry plus header', async () => {
    const result = { data: ALL_AUDIT_ROWS, nextCursor: null, hasMore: false };
    ({ app } = await buildApp({ auditList: jest.fn().mockResolvedValue(result) }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit/export`);

    expect(res.status).toBe(HttpStatus.OK);
    // header + 7 rows + trailing empty string from final \r\n
    const lines = (res.text as string).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(1 + ALL_AUDIT_ROWS.length);
  });

  it('AC7 — CSV row contains expected field values', async () => {
    const result = { data: [ROW_ORG_UPDATE_NAME], nextCursor: null, hasMore: false };
    ({ app } = await buildApp({ auditList: jest.fn().mockResolvedValue(result) }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit/export`);

    expect(res.status).toBe(HttpStatus.OK);
    const dataLine = (res.text as string).split('\r\n')[1]!;
    expect(dataLine).toContain(ROW_ORG_UPDATE_NAME.id);
    expect(dataLine).toContain('organization.update');
    expect(dataLine).toContain(ORG_AUDIT_ORG_ID);
  });

  it('AC7 — includes Content-Disposition attachment header', async () => {
    const result = { data: [], nextCursor: null, hasMore: false };
    ({ app } = await buildApp({ auditList: jest.fn().mockResolvedValue(result) }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit/export`);

    expect(res.status).toBe(HttpStatus.OK);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.headers['content-disposition']).toMatch(/filename="org-.*-audit-.*\.csv"/);
  });

  it('AC7 — passes filters (operation, actorId, from, to) to service for export', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: ORG_UPDATE_ROWS, nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit/export`)
      .query({ operation: 'organization.update', actorId: AUDIT_ACTOR_STAFF });

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action:  'organization.update',
        actorId: AUDIT_ACTOR_STAFF,
        resourceType: 'organization',
        resourceId:   ORG_AUDIT_ORG_ID,
      }),
    );
  });

  it('AC7 — returns 422 AUDIT_EXPORT_TOO_LARGE when row count exceeds cap', async () => {
    // Probe fetch returns AUDIT_EXPORT_ROW_CAP + 1 rows → controller throws 422
    const overCapRows = buildExportCapRows(AUDIT_EXPORT_ROW_CAP + 1);
    const auditMock = jest.fn().mockResolvedValue({
      data:       overCapRows,
      nextCursor: null,
      hasMore:    true,
    });
    ({ app } = await buildApp({ auditList: auditMock }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit/export`);

    expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(res.body.error?.code).toBe('AUDIT_EXPORT_TOO_LARGE');
    expect(res.body.error?.message).toMatch(/10,000/);
    expect(res.body.error?.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ rowCap: AUDIT_EXPORT_ROW_CAP })]),
    );
  });

  it('AC7 — export probe requests AUDIT_EXPORT_ROW_CAP + 1 rows (overflow detection)', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit/export`);

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: AUDIT_EXPORT_ROW_CAP + 1 }),
    );
  });

  it('AC7 — export 404 when org not found', async () => {
    const orgMock = jest.fn().mockResolvedValue(null);
    ({ app } = await buildApp({ orgFindById: orgMock }));

    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${UNKNOWN_ORG_ID}/audit/export`);

    expect(res.status).toBe(HttpStatus.NOT_FOUND);
  });
});

// ---------------------------------------------------------------------------
// Scope pinning: service always called with resourceType + resourceId
// ---------------------------------------------------------------------------

describe('Scope pinning — resourceType and resourceId cannot be widened by caller', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app?.close();
    jest.clearAllMocks();
  });

  it('list — resourceType is always "organization" regardless of query params', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    // Caller cannot pass resourceType in query (strict schema rejects it)
    const res = await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`)
      .query({ resourceType: 'ticket' }); // unknown field → rejected by strict schema

    // Strict Zod schema rejects the unknown field
    expect(res.status).toBe(HttpStatus.BAD_REQUEST);
  });

  it('list — resourceId is always the path param orgId, not a query param', async () => {
    const auditMock = jest.fn().mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
    ({ app } = await buildApp({ auditList: auditMock }));

    await withPrincipal(app, makeAdminPrincipal())
      .get(`/organizations/${ORG_AUDIT_ORG_ID}/audit`);

    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ resourceId: ORG_AUDIT_ORG_ID }),
    );
    // Must NOT have been called with a different resourceId
    const callArg = auditMock.mock.calls[0][0] as Record<string, unknown>;
    expect(callArg['resourceId']).toBe(ORG_AUDIT_ORG_ID);
  });
});
