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
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    findById: vi.fn(async () => org),
    findByName: vi.fn(async () => nameConflict),
    isOrganizationActive: vi.fn(async () => org?.status === 'active'),
    deactivateOrganization: vi.fn(async (_t: string, _id: string) => {
      if (!org) return 'NOT_FOUND';
      if (org.status === 'inactive') return 'ALREADY_INACTIVE';
      const updated = { ...org, status: 'inactive', deactivatedAt: new Date(), version: org.version + 1 };
      emittedEvents.push('organization.deactivated');
      return updated;
    }),
    reactivateOrganization: vi.fn(async (_t: string, _id: string) => {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrganizationsService.isOrganizationActive()', () => {
  it('returns true for an active org', async () => {
    const svc = new OrganizationsService(makeRepoDouble(makeOrg()) as never);
    expect(await svc.isOrganizationActive('ten-001', 'org-001')).toBe(true);
  });

  it('returns false for an inactive org', async () => {
    const svc = new OrganizationsService(makeRepoDouble(makeOrg({ status: 'inactive' })) as never);
    expect(await svc.isOrganizationActive('ten-001', 'org-001')).toBe(false);
  });

  it('returns false for an unknown org', async () => {
    const svc = new OrganizationsService(makeRepoDouble(null) as never);
    expect(await svc.isOrganizationActive('ten-001', 'org-xxx')).toBe(false);
  });
});

describe('OrganizationsService.deactivate()', () => {
  it('deactivates an active org', async () => {
    const repo = makeRepoDouble(makeOrg());
    const svc = new OrganizationsService(repo as never);
    const result = await svc.deactivate('ten-001', 'org-001', { confirmName: 'Acme Corp', reason: 'Contract ended' }, 'actor-1');
    expect(result.status).toBe('inactive');
    expect(repo.deactivateOrganization).toHaveBeenCalledOnce();
  });

  it('is idempotent for already-inactive org — returns 200 without duplicate outbox', async () => {
    const inactiveOrg = makeOrg({ status: 'inactive' });
    const repo = makeRepoDouble(inactiveOrg);
    const svc = new OrganizationsService(repo as never);
    const result = await svc.deactivate('ten-001', 'org-001', { confirmName: 'Acme Corp', reason: 'Repeat call' }, 'actor-1');
    expect(result.status).toBe('inactive');
    // ALREADY_INACTIVE path: deactivateOrganization was called but emitted no event
    expect(repo._emittedEvents).toHaveLength(0);
  });

  it('throws 400 on confirmation name mismatch', async () => {
    const svc = new OrganizationsService(makeRepoDouble(makeOrg()) as never);
    await expect(
      svc.deactivate('ten-001', 'org-001', { confirmName: 'Wrong Name', reason: 'test' }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws 404 for unknown org', async () => {
    const svc = new OrganizationsService(makeRepoDouble(null) as never);
    await expect(
      svc.deactivate('ten-001', 'org-missing', { confirmName: 'X', reason: 'test' }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OrganizationsService.reactivate()', () => {
  it('reactivates an inactive org', async () => {
    const repo = makeRepoDouble(makeOrg({ status: 'inactive' }));
    const svc = new OrganizationsService(repo as never);
    const result = await svc.reactivate('ten-001', 'org-001', { reason: 'Re-signed' }, 'actor-1');
    expect(result.status).toBe('active');
  });

  it('is idempotent for already-active org', async () => {
    const repo = makeRepoDouble(makeOrg({ status: 'active' }));
    const svc = new OrganizationsService(repo as never);
    const result = await svc.reactivate('ten-001', 'org-001', { reason: 'Idempotent' }, 'actor-1');
    expect(result.status).toBe('active');
    expect(repo.reactivateOrganization).not.toHaveBeenCalled();
  });

  it('throws 409 when another active org has taken the same name', async () => {
    const inactiveOrg = makeOrg({ status: 'inactive' });
    const conflictOrg = makeOrg({ id: 'org-002', name: 'Acme Corp', status: 'active' });
    const repo = makeRepoDouble(inactiveOrg, conflictOrg);
    const svc = new OrganizationsService(repo as never);
    await expect(
      svc.reactivate('ten-001', 'org-001', { reason: 'Re-signed' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws 404 for unknown org', async () => {
    const svc = new OrganizationsService(makeRepoDouble(null) as never);
    await expect(
      svc.reactivate('ten-001', 'org-missing', { reason: 'test' }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
