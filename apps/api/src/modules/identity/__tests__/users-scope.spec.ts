/**
 * Unit tests for UserScopeController (GET/PUT /api/v1/users/:userId/org-scope)
 * and the WO-013 additions to OrgScopeService.
 *
 * All tests run offline — no database or Redis required.
 */

import { UnprocessableEntityException } from '@nestjs/common';
import { UserScopeController } from '../users.controller';
import { OrgScopeService } from '../services/org-scope.service';
import { OrganizationsRepository } from '../../organizations/organizations.repository';
import { AuditWriter } from '../../../common/audit/audit-writer';
import { RequestContextStore } from '../../../observability/request-context';
import { ErrorCode } from '../../../common/errors/app-errors';
import {
  TENANT_A_ID,
  MANAGER_A_ID,
  ORG_A1_ID,
  ORG_A2_ID,
} from '../../../../test/fixtures/tenant-factory';
import {
  ORG_A3_ID,
  AGENT_ALPHA_ID,
  ALPHA_SCOPE_ROWS,
  MANAGER_PRINCIPAL,
} from '../../../../test/fixtures/org-scope.fixtures';

// ── Mock factories ─────────────────────────────────────────────────────────────

function makeOrgScopeService(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    listScopes: jest.fn().mockResolvedValue([]),
    replaceScopes: jest.fn().mockResolvedValue(1),
    readScopeVersion: jest.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as OrgScopeService;
}

function makeOrgsRepository(found: Array<{ id: string; name: string }> = []) {
  return {
    findByIds: jest.fn().mockResolvedValue(found),
    findById: jest.fn().mockResolvedValue(null),
  } as unknown as OrganizationsRepository;
}

function makeAuditWriter() {
  return { append: jest.fn().mockResolvedValue(undefined) } as unknown as AuditWriter;
}

function withPrincipal<T>(fn: () => Promise<T>): Promise<T> {
  return RequestContextStore.run(
    { principal: MANAGER_PRINCIPAL, tx: null as never },
    fn,
  );
}

// ── GET /api/v1/users/:userId/org-scope ────────────────────────────────────────

describe('UserScopeController.getUserOrgScope', () => {
  it('returns tenantWide=true and empty organizationIds when no scope rows exist', async () => {
    const svc = makeOrgScopeService({
      listScopes: jest.fn().mockResolvedValue([]),
      readScopeVersion: jest.fn().mockResolvedValue(0),
    });
    const ctrl = new UserScopeController(svc, makeOrgsRepository(), makeAuditWriter());

    const result = await withPrincipal(() => ctrl.getUserOrgScope(AGENT_ALPHA_ID));

    expect(result).toEqual({
      userId: AGENT_ALPHA_ID,
      tenantWide: true,
      organizationIds: [],
      scopeVersion: 0,
    });
  });

  it('returns tenantWide=false with populated organizationIds when scope rows exist', async () => {
    const svc = makeOrgScopeService({
      listScopes: jest.fn().mockResolvedValue(
        ALPHA_SCOPE_ROWS.map((r) => ({ organizationId: r.organizationId, accessLevel: r.accessLevel })),
      ),
      readScopeVersion: jest.fn().mockResolvedValue(2),
    });
    const ctrl = new UserScopeController(svc, makeOrgsRepository(), makeAuditWriter());

    const result = await withPrincipal(() => ctrl.getUserOrgScope(AGENT_ALPHA_ID));

    expect(result.userId).toBe(AGENT_ALPHA_ID);
    expect(result.tenantWide).toBe(false);
    expect(result.organizationIds).toEqual(expect.arrayContaining([ORG_A1_ID, ORG_A2_ID]));
    expect(result.organizationIds).toHaveLength(2);
    expect(result.scopeVersion).toBe(2);
  });

  it('calls listScopes with tenantId from principal context', async () => {
    const listScopes = jest.fn().mockResolvedValue([]);
    const svc = makeOrgScopeService({ listScopes, readScopeVersion: jest.fn().mockResolvedValue(0) });
    const ctrl = new UserScopeController(svc, makeOrgsRepository(), makeAuditWriter());

    await withPrincipal(() => ctrl.getUserOrgScope(AGENT_ALPHA_ID));

    expect(listScopes).toHaveBeenCalledWith(TENANT_A_ID, AGENT_ALPHA_ID);
  });
});

// ── PUT /api/v1/users/:userId/org-scope ────────────────────────────────────────

describe('UserScopeController.putUserOrgScope', () => {
  it('returns added/removed diff and new scopeVersion', async () => {
    const svc = makeOrgScopeService({
      listScopes: jest.fn().mockResolvedValue([
        { organizationId: ORG_A1_ID, accessLevel: 'full' },
      ]),
      replaceScopes: jest.fn().mockResolvedValue(3),
    });
    const orgsRepo = makeOrgsRepository([
      { id: ORG_A1_ID, name: 'Org A1' },
      { id: ORG_A2_ID, name: 'Org A2' },
    ]);
    const audit = makeAuditWriter();
    const ctrl = new UserScopeController(svc, orgsRepo, audit);

    const result = await withPrincipal(() =>
      ctrl.putUserOrgScope(AGENT_ALPHA_ID, {
        tenantWide: false,
        organizationIds: [ORG_A1_ID, ORG_A2_ID],
      }),
    );

    expect(result.scopeVersion).toBe(3);
    expect(result.added).toEqual([ORG_A2_ID]);     // A2 is new
    expect(result.removed).toHaveLength(0);         // A1 stays
  });

  it('reports removed orgs when scope is narrowed', async () => {
    const svc = makeOrgScopeService({
      listScopes: jest.fn().mockResolvedValue([
        { organizationId: ORG_A1_ID, accessLevel: 'full' },
        { organizationId: ORG_A2_ID, accessLevel: 'full' },
      ]),
      replaceScopes: jest.fn().mockResolvedValue(4),
    });
    const orgsRepo = makeOrgsRepository([{ id: ORG_A1_ID, name: 'Org A1' }]);
    const ctrl = new UserScopeController(svc, orgsRepo, makeAuditWriter());

    const result = await withPrincipal(() =>
      ctrl.putUserOrgScope(AGENT_ALPHA_ID, {
        tenantWide: false,
        organizationIds: [ORG_A1_ID],
      }),
    );

    expect(result.removed).toEqual([ORG_A2_ID]);
    expect(result.added).toHaveLength(0);
  });

  it('tenantWide=true clears all org scopes (empty replacement)', async () => {
    const listScopes = jest.fn().mockResolvedValue([
      { organizationId: ORG_A1_ID, accessLevel: 'full' },
    ]);
    const replaceScopes = jest.fn().mockResolvedValue(5);
    const svc = makeOrgScopeService({ listScopes, replaceScopes });
    const ctrl = new UserScopeController(svc, makeOrgsRepository(), makeAuditWriter());

    const result = await withPrincipal(() =>
      ctrl.putUserOrgScope(AGENT_ALPHA_ID, { tenantWide: true, organizationIds: [] }),
    );

    // replaceScopes must be called with empty list
    expect(replaceScopes).toHaveBeenCalledWith(TENANT_A_ID, AGENT_ALPHA_ID, []);
    expect(result.removed).toEqual([ORG_A1_ID]);
    expect(result.added).toHaveLength(0);
  });

  it('rejects an org ID not belonging to the caller tenant (422 ORG_SCOPE_INVALID_ORGANIZATION)', async () => {
    const svc = makeOrgScopeService({
      listScopes: jest.fn().mockResolvedValue([]),
    });
    // findByIds returns only ORG_A1 — ORG_A3 is "not found" simulating cross-tenant
    const orgsRepo = makeOrgsRepository([{ id: ORG_A1_ID, name: 'Org A1' }]);
    const ctrl = new UserScopeController(svc, orgsRepo, makeAuditWriter());

    await expect(
      withPrincipal(() =>
        ctrl.putUserOrgScope(AGENT_ALPHA_ID, {
          tenantWide: false,
          organizationIds: [ORG_A1_ID, ORG_A3_ID],
        }),
      ),
    ).rejects.toMatchObject({
      response: {
        code: ErrorCode.ORG_SCOPE_INVALID_ORGANIZATION,
      },
    });
  });

  it('throws UnprocessableEntityException for invalid UUID in body', async () => {
    const ctrl = new UserScopeController(
      makeOrgScopeService(),
      makeOrgsRepository(),
      makeAuditWriter(),
    );

    await expect(
      withPrincipal(() =>
        ctrl.putUserOrgScope(AGENT_ALPHA_ID, {
          tenantWide: false,
          organizationIds: ['not-a-uuid'],
        }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('writes an audit record with added/removed diff', async () => {
    const svc = makeOrgScopeService({
      listScopes: jest.fn().mockResolvedValue([{ organizationId: ORG_A1_ID, accessLevel: 'full' }]),
      replaceScopes: jest.fn().mockResolvedValue(2),
    });
    const orgsRepo = makeOrgsRepository([
      { id: ORG_A1_ID, name: 'Org A1' },
      { id: ORG_A2_ID, name: 'Org A2' },
    ]);
    const auditWriter = makeAuditWriter();
    const ctrl = new UserScopeController(svc, orgsRepo, auditWriter);

    await withPrincipal(() =>
      ctrl.putUserOrgScope(AGENT_ALPHA_ID, {
        tenantWide: false,
        organizationIds: [ORG_A1_ID, ORG_A2_ID],
      }),
    );

    expect(auditWriter.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.org_scope.replaced',
        resourceId: AGENT_ALPHA_ID,
        afterState: expect.objectContaining({
          added: [ORG_A2_ID],
          removed: [],
        }),
      }),
    );
  });

  it('empty body uses default values (tenantWide=false, organizationIds=[])', async () => {
    const replaceScopes = jest.fn().mockResolvedValue(1);
    const svc = makeOrgScopeService({
      listScopes: jest.fn().mockResolvedValue([]),
      replaceScopes,
    });
    const ctrl = new UserScopeController(svc, makeOrgsRepository(), makeAuditWriter());

    const result = await withPrincipal(() =>
      ctrl.putUserOrgScope(AGENT_ALPHA_ID, {}),
    );

    expect(replaceScopes).toHaveBeenCalledWith(TENANT_A_ID, AGENT_ALPHA_ID, []);
    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
  });
});

// ── OrgScopeService.readScopeVersion (new method) ─────────────────────────────

describe('OrgScopeService.readScopeVersion', () => {
  function makeRedis(overrides: Partial<Record<string, jest.Mock>> = {}) {
    return { get: jest.fn().mockResolvedValue(null), ...overrides };
  }

  it('returns 0 when Redis key is absent (cold start)', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue(null) });
    const svc = new OrgScopeService(redis as never);
    const v = await svc.readScopeVersion(TENANT_A_ID, MANAGER_A_ID);
    expect(v).toBe(0);
  });

  it('returns parsed integer from Redis', async () => {
    const redis = makeRedis({ get: jest.fn().mockResolvedValue('7') });
    const svc = new OrgScopeService(redis as never);
    const v = await svc.readScopeVersion(TENANT_A_ID, MANAGER_A_ID);
    expect(v).toBe(7);
  });

  it('returns 0 when Redis throws (fail-open)', async () => {
    const redis = makeRedis({ get: jest.fn().mockRejectedValue(new Error('connection refused')) });
    const svc = new OrgScopeService(redis as never);
    const v = await svc.readScopeVersion(TENANT_A_ID, MANAGER_A_ID);
    expect(v).toBe(0);
  });
});

// ── OrgScopeService.assertScopeVersionFresh — AUTH_REAUTHORIZE_REQUIRED ───────

describe('OrgScopeService.assertScopeVersionFresh returns AUTH_REAUTHORIZE_REQUIRED', () => {
  function makeRedis(currentVersion: number) {
    return { get: jest.fn().mockResolvedValue(String(currentVersion)), set: jest.fn() };
  }

  it('throws AUTH_REAUTHORIZE_REQUIRED with reason scope_changed when token version is stale', async () => {
    const redis = makeRedis(5); // server is at v5
    const svc = new OrgScopeService(redis as never);

    await expect(
      svc.assertScopeVersionFresh(TENANT_A_ID, AGENT_ALPHA_ID, 3), // token is at v3
    ).rejects.toMatchObject({
      response: {
        code: ErrorCode.AUTH_REAUTHORIZE_REQUIRED,
        details: [{ reason: 'scope_changed' }],
      },
    });
  });

  it('does NOT throw when token version matches server version', async () => {
    const redis = makeRedis(5);
    const svc = new OrgScopeService(redis as never);
    await expect(
      svc.assertScopeVersionFresh(TENANT_A_ID, AGENT_ALPHA_ID, 5),
    ).resolves.toBeUndefined();
  });

  it('does NOT throw when token version is ahead (e.g. issued during INCR gap)', async () => {
    const redis = makeRedis(4);
    const svc = new OrgScopeService(redis as never);
    await expect(
      svc.assertScopeVersionFresh(TENANT_A_ID, AGENT_ALPHA_ID, 5),
    ).resolves.toBeUndefined();
  });
});
