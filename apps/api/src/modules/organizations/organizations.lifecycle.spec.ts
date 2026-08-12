/**
 * Unit tests for OrganizationsService lifecycle methods (WO-025).
 *
 * Uses an in-memory repository double. No database or NestJS DI required.
 *
 * Covers:
 *  - Deactivation happy path
 *  - Deactivation idempotency (already-inactive → 200, no duplicate outbox)
 *  - Confirmation name mismatch → 400
 *  - Deactivate unknown org → 404
 *  - Reactivation happy path
 *  - Reactivation idempotency (already-active → 200)
 *  - Reactivation name conflict (another active org took the name) → 409
 *  - isOrganizationActive returns correct boolean
 *  - Audit record includes reason field
 *  - Contact portal suspension verified via repo call
 */

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

// ---------------------------------------------------------------------------
// Minimal repository double
// ---------------------------------------------------------------------------

function makeOrg(overrides: Partial<{
  id: string; tenantId: string; name: string; status: string;
  version: number; deactivatedAt: Date | null; deactivatedBy: string | null;
}> = {}) {
  return {
    id: 'org-001',
    tenantId: 'ten-001',
    name: 'Acme Corp',
    slug: 'acme-corp',
    slaTier: 'standard',
    region: null,
    status: 'active',
    customFieldValues: {},
    primaryContactId: null,
    deactivatedAt: null,
    deactivatedBy: null,
    version: 1,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeRepoDouble(
  org: ReturnType<typeof makeOrg> | null,
  nameConflict: ReturnType<typeof makeOrg> | null = null,
) {
  const emittedEvents: string[] = [];
  const repo = {
    findById: jest.fn(async () => org),
    findByName: jest.fn(async () => nameConflict),
    isOrganizationActive: jest.fn(async () => org?.status === 'active'),
    deactivateOrganization: jest.fn(async (_t: string, _id: string) => {
      if (!org) return 'NOT_FOUND';
      if (org.status === 'inactive') return 'ALREADY_INACTIVE';
      const updated = { ...org, status: 'inactive', deactivatedAt: new Date(), version: org.version + 1 };
      emittedEvents.push('organization.deactivated');
      return updated;
    }),
    reactivateOrganization: jest.fn(async (_t: string, _id: string) => {
      if (!org) return 'NOT_FOUND';
      if (org.status === 'active') return 'ALREADY_ACTIVE';
      const updated = { ...org, status: 'active', deactivatedAt: null, version: org.version + 1 };
      emittedEvents.push('organization.reactivated');
      return updated;
    }),
    _emittedEvents: emittedEvents,
  };
  return repo;
}

function makeAuditWriterDouble() {
  return {
    append: jest.fn().mockResolvedValue(undefined),
  };
}

function makeOrgScopeDouble() {
  return {
    invalidateOrgScopes: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Build a minimal service with only the dependencies needed for lifecycle tests.
 * customFieldDefsService and verifiedDomainsService are stubbed as `undefined`
 * because lifecycle methods don't invoke them.
 */
function buildLifecycleSvc(
  repo: ReturnType<typeof makeRepoDouble>,
  auditWriter?: ReturnType<typeof makeAuditWriterDouble>,
  orgScopeService?: ReturnType<typeof makeOrgScopeDouble>,
) {
  return new OrganizationsService(
    repo as never,
    undefined as never,    // customFieldDefsService — not used by lifecycle paths
    undefined as never,    // verifiedDomainsService — not used by lifecycle paths
    (auditWriter ?? makeAuditWriterDouble()) as never,
    orgScopeService as never,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrganizationsService.isOrganizationActive()', () => {
  it('returns true for an active org', async () => {
    const svc = buildLifecycleSvc(makeRepoDouble(makeOrg()));
    expect(await svc.isOrganizationActive('ten-001', 'org-001')).toBe(true);
  });

  it('returns false for an inactive org', async () => {
    const svc = buildLifecycleSvc(makeRepoDouble(makeOrg({ status: 'inactive' })));
    expect(await svc.isOrganizationActive('ten-001', 'org-001')).toBe(false);
  });

  it('returns false for an unknown org', async () => {
    const svc = buildLifecycleSvc(makeRepoDouble(null));
    expect(await svc.isOrganizationActive('ten-001', 'org-xxx')).toBe(false);
  });
});

describe('OrganizationsService.deactivate()', () => {
  it('deactivates an active org', async () => {
    const repo = makeRepoDouble(makeOrg());
    const svc = buildLifecycleSvc(repo);
    const result = await svc.deactivate('ten-001', 'org-001', { confirmName: 'Acme Corp', reason: 'Contract ended' }, 'actor-1');
    expect(result.status).toBe('inactive');
    expect(repo.deactivateOrganization).toHaveBeenCalledTimes(1);
  });

  it('is idempotent for already-inactive org — returns 200 without duplicate outbox', async () => {
    const inactiveOrg = makeOrg({ status: 'inactive' });
    const repo = makeRepoDouble(inactiveOrg);
    const svc = buildLifecycleSvc(repo);
    const result = await svc.deactivate('ten-001', 'org-001', { confirmName: 'Acme Corp', reason: 'Repeat call' }, 'actor-1');
    expect(result.status).toBe('inactive');
    // ALREADY_INACTIVE path: deactivateOrganization was called but emitted no event
    expect(repo._emittedEvents).toHaveLength(0);
  });

  it('throws 400 on confirmation name mismatch', async () => {
    const svc = buildLifecycleSvc(makeRepoDouble(makeOrg()));
    await expect(
      svc.deactivate('ten-001', 'org-001', { confirmName: 'Wrong Name', reason: 'test' }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 400 with CONFIRMATION_NAME_MISMATCH code on name mismatch', async () => {
    const svc = buildLifecycleSvc(makeRepoDouble(makeOrg()));
    await expect(
      svc.deactivate('ten-001', 'org-001', { confirmName: 'wrong', reason: 'test' }, 'actor-1'),
    ).rejects.toMatchObject({ response: { error: { code: 'CONFIRMATION_NAME_MISMATCH' } } });
  });

  it('throws 404 for unknown org', async () => {
    const svc = buildLifecycleSvc(makeRepoDouble(null));
    await expect(
      svc.deactivate('ten-001', 'org-missing', { confirmName: 'X', reason: 'test' }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes audit record with reason in metadata', async () => {
    const repo = makeRepoDouble(makeOrg());
    const auditWriter = makeAuditWriterDouble();
    const svc = buildLifecycleSvc(repo, auditWriter);
    await svc.deactivate('ten-001', 'org-001', { confirmName: 'Acme Corp', reason: 'Ended contract' }, 'actor-1');
    expect(auditWriter.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deactivate',
        metadata: expect.objectContaining({ reason: 'Ended contract' }),
      }),
    );
  });

  it('suspends portal access via repo (contact bulk-update covered in repo)', async () => {
    // The repo.deactivateOrganization is the single transaction that also updates contacts.
    // We verify it was called with the correct tenant/org IDs.
    const repo = makeRepoDouble(makeOrg());
    const svc = buildLifecycleSvc(repo);
    await svc.deactivate('ten-001', 'org-001', { confirmName: 'Acme Corp', reason: 'Done' }, 'actor-1');
    expect(repo.deactivateOrganization).toHaveBeenCalledWith('ten-001', 'org-001', 'actor-1', undefined);
  });

  it('bumps Redis scope versions when OrgScopeService is provided', async () => {
    const repo = makeRepoDouble(makeOrg());
    const orgScopeService = makeOrgScopeDouble();
    const svc = buildLifecycleSvc(repo, makeAuditWriterDouble(), orgScopeService);
    await svc.deactivate('ten-001', 'org-001', { confirmName: 'Acme Corp', reason: 'Done' }, 'actor-1');
    expect(orgScopeService.invalidateOrgScopes).toHaveBeenCalledWith('ten-001', 'org-001');
  });

  it('does NOT bump Redis scope versions on idempotent repeat (already-inactive)', async () => {
    const repo = makeRepoDouble(makeOrg({ status: 'inactive' }));
    const orgScopeService = makeOrgScopeDouble();
    const svc = buildLifecycleSvc(repo, makeAuditWriterDouble(), orgScopeService);
    await svc.deactivate('ten-001', 'org-001', { confirmName: 'Acme Corp', reason: 'Repeat' }, 'actor-1');
    expect(orgScopeService.invalidateOrgScopes).not.toHaveBeenCalled();
  });
});

describe('OrganizationsService.reactivate()', () => {
  it('reactivates an inactive org', async () => {
    const repo = makeRepoDouble(makeOrg({ status: 'inactive' }));
    const svc = buildLifecycleSvc(repo);
    const result = await svc.reactivate('ten-001', 'org-001', { reason: 'Re-signed' }, 'actor-1');
    expect(result.status).toBe('active');
  });

  it('is idempotent for already-active org', async () => {
    const repo = makeRepoDouble(makeOrg({ status: 'active' }));
    const svc = buildLifecycleSvc(repo);
    const result = await svc.reactivate('ten-001', 'org-001', { reason: 'Idempotent' }, 'actor-1');
    expect(result.status).toBe('active');
    expect(repo.reactivateOrganization).not.toHaveBeenCalled();
  });

  it('throws 409 when another active org has taken the same name', async () => {
    const inactiveOrg = makeOrg({ status: 'inactive' });
    const conflictOrg = makeOrg({ id: 'org-002', name: 'Acme Corp', status: 'active' });
    const repo = makeRepoDouble(inactiveOrg, conflictOrg);
    const svc = buildLifecycleSvc(repo);
    await expect(
      svc.reactivate('ten-001', 'org-001', { reason: 'Re-signed' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws 409 with ORGANIZATION_NAME_CONFLICT code on name conflict', async () => {
    const inactiveOrg = makeOrg({ status: 'inactive' });
    const conflictOrg = makeOrg({ id: 'org-002', name: 'Acme Corp', status: 'active' });
    const repo = makeRepoDouble(inactiveOrg, conflictOrg);
    const svc = buildLifecycleSvc(repo);
    await expect(
      svc.reactivate('ten-001', 'org-001', { reason: 'Re-signed' }, 'actor-1'),
    ).rejects.toMatchObject({ response: { error: { code: 'ORGANIZATION_NAME_CONFLICT' } } });
  });

  it('throws 404 for unknown org', async () => {
    const svc = buildLifecycleSvc(makeRepoDouble(null));
    await expect(
      svc.reactivate('ten-001', 'org-missing', { reason: 'test' }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes audit record with reason in metadata', async () => {
    const repo = makeRepoDouble(makeOrg({ status: 'inactive' }));
    const auditWriter = makeAuditWriterDouble();
    const svc = buildLifecycleSvc(repo, auditWriter);
    await svc.reactivate('ten-001', 'org-001', { reason: 'New deal' }, 'actor-1');
    expect(auditWriter.append).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reactivate',
        metadata: expect.objectContaining({ reason: 'New deal' }),
      }),
    );
  });

  it('bumps Redis scope versions on successful reactivation', async () => {
    const repo = makeRepoDouble(makeOrg({ status: 'inactive' }));
    const orgScopeService = makeOrgScopeDouble();
    const svc = buildLifecycleSvc(repo, makeAuditWriterDouble(), orgScopeService);
    await svc.reactivate('ten-001', 'org-001', { reason: 'Done' }, 'actor-1');
    expect(orgScopeService.invalidateOrgScopes).toHaveBeenCalledWith('ten-001', 'org-001');
  });
});
