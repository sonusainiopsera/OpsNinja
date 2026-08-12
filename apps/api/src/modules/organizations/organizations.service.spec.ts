/**
 * Unit tests for OrganizationsService — CRUD and business rule validation.
 *
 * Uses in-memory repository and service doubles. No database or NestJS DI required.
 *
 * Covers (per AC#8):
 *   - list() delegates to repo and propagates CURSOR_INVALID as 400
 *   - create() enforces per-tenant name uniqueness → 409
 *   - create() validates custom field values → 400 on failure
 *   - create() succeeds when no active org with the same name exists
 *   - update() enforces optimistic version check → 409
 *   - update() rejects edits on inactive orgs → 422
 *   - update() returns 404 for unknown org
 *   - update() enforces name uniqueness on rename → 409
 *   - DTO validation: CreateOrganizationSchema rejects unknown fields
 *   - DTO validation: UpdateOrganizationSchema requires version
 *   - DTO validation: limit clamping in ListOrganizationsQuerySchema
 *   - DTO validation: customField must be "key:value" format
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationSchema } from './dto/create-organization.dto';
import { UpdateOrganizationSchema } from './dto/update-organization.dto';
import { ListOrganizationsQuerySchema, DEFAULT_LIMIT, MAX_LIMIT } from './dto/list-organizations.query';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeOrg(overrides: Partial<Record<string, unknown>> = {}) {
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

function makeRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    findPaginated: jest.fn().mockResolvedValue({ data: [], nextCursor: null }),
    findById: jest.fn().mockResolvedValue(null),
    findByIdWithDetail: jest.fn().mockResolvedValue(null),
    findByName: jest.fn().mockResolvedValue(null),
    createOrganization: jest.fn().mockImplementation((_tenantId: string, data: Record<string, unknown>) =>
      Promise.resolve(makeOrg({ ...data, id: 'org-new', createdAt: new Date(), updatedAt: new Date() })),
    ),
    updateOrganization: jest.fn().mockResolvedValue(makeOrg({ version: 2 })),
    isOrganizationActive: jest.fn().mockResolvedValue(true),
    deactivateOrganization: jest.fn().mockResolvedValue(makeOrg({ status: 'inactive' })),
    reactivateOrganization: jest.fn().mockResolvedValue(makeOrg({ status: 'active' })),
    ...overrides,
  };
}

function makeCustomFieldSvc(valid = true) {
  return {
    validateValues: jest.fn().mockResolvedValue(
      valid
        ? { valid: true, errors: [] }
        : { valid: false, errors: [{ fieldKey: 'cloud_provider', message: 'invalid value' }] },
    ),
  };
}

function makeVerifiedDomainSvc() {
  return {
    resolveOrganizationByEmailDomain: jest.fn().mockResolvedValue(null),
    register: jest.fn().mockResolvedValue({ domain: { id: 'dom-001' } }),
    adminOverride: jest.fn().mockResolvedValue(undefined),
  };
}

function makeAuditWriter() {
  return {
    append: jest.fn().mockResolvedValue(undefined),
  };
}

function buildService(repoOverrides: Partial<Record<string, unknown>> = {}, cfValid = true) {
  return new OrganizationsService(
    makeRepo(repoOverrides) as never,
    makeCustomFieldSvc(cfValid) as never,
    makeVerifiedDomainSvc() as never,
    makeAuditWriter() as never,
  );
}

// ---------------------------------------------------------------------------
// list()
// ---------------------------------------------------------------------------

describe('OrganizationsService.list()', () => {
  it('delegates to repo.findPaginated and returns the result', async () => {
    const expected = { data: [makeOrg()], nextCursor: 'cursor-abc' };
    const svc = buildService({
      findPaginated: jest.fn().mockResolvedValue(expected),
    });
    const result = await svc.list('ten-001', { limit: 25 });
    expect(result).toEqual(expected);
  });

  it('converts CURSOR_INVALID repo error to 400 BadRequestException', async () => {
    const cursorError = Object.assign(new Error('bad cursor'), { code: 'CURSOR_INVALID' });
    const svc = buildService({
      findPaginated: jest.fn().mockRejectedValue(cursorError),
    });
    await expect(svc.list('ten-001', { cursor: 'bad-cursor', limit: 25 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('re-throws unknown errors from repo.findPaginated', async () => {
    const dbError = new Error('connection refused');
    const svc = buildService({
      findPaginated: jest.fn().mockRejectedValue(dbError),
    });
    await expect(svc.list('ten-001', { limit: 25 })).rejects.toBe(dbError);
  });

  it('passes filters through to repo', async () => {
    const mockFindPaginated = jest.fn().mockResolvedValue({ data: [], nextCursor: null });
    const svc = buildService({ findPaginated: mockFindPaginated });
    await svc.list('ten-001', { limit: 10, tier: 'premium', region: 'eu-west-1', status: 'active', q: 'acme' });
    expect(mockFindPaginated).toHaveBeenCalledWith('ten-001', {
      limit: 10,
      tier: 'premium',
      region: 'eu-west-1',
      status: 'active',
      q: 'acme',
    });
  });
});

// ---------------------------------------------------------------------------
// getById()
// ---------------------------------------------------------------------------

describe('OrganizationsService.getById()', () => {
  it('returns the org detail when found', async () => {
    const detail = { ...makeOrg(), verifiedDomainCount: 2, contactCount: 5 };
    const svc = buildService({ findByIdWithDetail: jest.fn().mockResolvedValue(detail) });
    const result = await svc.getById('ten-001', 'org-001');
    expect(result).toEqual(detail);
  });

  it('throws 404 NotFoundException when org not found', async () => {
    const svc = buildService({ findByIdWithDetail: jest.fn().mockResolvedValue(null) });
    await expect(svc.getById('ten-001', 'org-missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 error has correct error code', async () => {
    const svc = buildService({ findByIdWithDetail: jest.fn().mockResolvedValue(null) });
    try {
      await svc.getById('ten-001', 'org-missing');
    } catch (err) {
      const httpErr = err as { response: { error: { code: string } } };
      expect(httpErr.response.error.code).toBe('ORGANIZATION_NOT_FOUND');
    }
  });
});

// ---------------------------------------------------------------------------
// create()
// ---------------------------------------------------------------------------

describe('OrganizationsService.create()', () => {
  it('creates an org when no conflict exists', async () => {
    const mockCreate = jest.fn().mockResolvedValue(makeOrg({ name: 'New Corp', version: 1 }));
    const svc = buildService({
      findByName: jest.fn().mockResolvedValue(null),
      createOrganization: mockCreate,
    });

    const result = await svc.create('ten-001', { name: 'New Corp', slaTier: 'standard', customFieldValues: {} }, 'user-001');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.name).toBe('New Corp');
  });

  it('throws 409 ConflictException on active name conflict', async () => {
    const svc = buildService({
      findByName: jest.fn().mockResolvedValue(makeOrg()),
    });
    await expect(
      svc.create('ten-001', { name: 'Acme Corp', slaTier: 'standard', customFieldValues: {} }, 'user-001'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 carries ORGANIZATION_NAME_CONFLICT code', async () => {
    const svc = buildService({ findByName: jest.fn().mockResolvedValue(makeOrg()) });
    try {
      await svc.create('ten-001', { name: 'Acme Corp', slaTier: 'standard', customFieldValues: {} }, 'user-001');
    } catch (err) {
      const httpErr = err as { response: { error: { code: string } } };
      expect(httpErr.response.error.code).toBe('ORGANIZATION_NAME_CONFLICT');
    }
  });

  it('allows creating org whose name matches an INACTIVE org (uniqueness is active-only)', async () => {
    // findByName returns null because uniqueness applies to active rows only
    const mockCreate = jest.fn().mockResolvedValue(makeOrg({ name: 'Old Horizon' }));
    const svc = buildService({
      findByName: jest.fn().mockResolvedValue(null), // inactive not returned by findByName
      createOrganization: mockCreate,
    });

    await expect(
      svc.create('ten-001', { name: 'Old Horizon', slaTier: 'standard', customFieldValues: {} }, 'user-001'),
    ).resolves.toBeDefined();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('throws 400 when custom field validation fails', async () => {
    const svc = new OrganizationsService(
      makeRepo({ findByName: jest.fn().mockResolvedValue(null) }) as never,
      makeCustomFieldSvc(false) as never,  // validation fails
      makeVerifiedDomainSvc() as never,
      makeAuditWriter() as never,
    );

    await expect(
      svc.create('ten-001', {
        name: 'New Corp',
        slaTier: 'standard',
        customFieldValues: { cloud_provider: 'invalid-value' },
      }, 'user-001'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('auto-generates slug when not supplied', async () => {
    const mockCreate = jest.fn().mockImplementation(
      (_tenantId: string, data: Record<string, unknown>) =>
        Promise.resolve(makeOrg({ slug: data['slug'] as string })),
    );
    const svc = buildService({
      findByName: jest.fn().mockResolvedValue(null),
      createOrganization: mockCreate,
    });

    await svc.create('ten-001', { name: 'My New Company', slaTier: 'standard', customFieldValues: {} }, 'u1');
    const callArg = mockCreate.mock.calls[0]![1] as Record<string, unknown>;
    expect(callArg['slug']).toBe('my-new-company');
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('OrganizationsService.update()', () => {
  it('throws 404 when org not found', async () => {
    const svc = buildService({ findById: jest.fn().mockResolvedValue(null) });
    await expect(
      svc.update('ten-001', 'org-missing', { version: 1 }, 'user-001'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws 422 when org is inactive', async () => {
    const svc = buildService({
      findById: jest.fn().mockResolvedValue(makeOrg({ status: 'inactive' })),
    });
    await expect(
      svc.update('ten-001', 'org-001', { version: 1, name: 'New Name' }, 'user-001'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('422 carries ORGANIZATION_INACTIVE code', async () => {
    const svc = buildService({
      findById: jest.fn().mockResolvedValue(makeOrg({ status: 'inactive' })),
    });
    try {
      await svc.update('ten-001', 'org-001', { version: 1, name: 'New Name' }, 'user-001');
    } catch (err) {
      const e = err as { response: { error: { code: string } } };
      expect(e.response.error.code).toBe('ORGANIZATION_INACTIVE');
    }
  });

  it('throws 409 on version conflict (repo returns VERSION_CONFLICT)', async () => {
    const fresh = makeOrg({ version: 3 });
    const svc = buildService({
      findById: jest.fn()
        .mockResolvedValueOnce(makeOrg({ version: 1 }))   // initial load
        .mockResolvedValueOnce(fresh),                    // re-fetch for current version
      findByName: jest.fn().mockResolvedValue(null),
      updateOrganization: jest.fn().mockResolvedValue('VERSION_CONFLICT'),
    });
    await expect(
      svc.update('ten-001', 'org-001', { version: 1 }, 'user-001'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('409 VERSION_CONFLICT contains currentVersion in details', async () => {
    const fresh = makeOrg({ version: 5 });
    const svc = buildService({
      findById: jest.fn()
        .mockResolvedValueOnce(makeOrg({ version: 1 }))
        .mockResolvedValueOnce(fresh),
      findByName: jest.fn().mockResolvedValue(null),
      updateOrganization: jest.fn().mockResolvedValue('VERSION_CONFLICT'),
    });
    try {
      await svc.update('ten-001', 'org-001', { version: 1 }, 'user-001');
    } catch (err) {
      const e = err as { response: { error: { code: string; details: Array<{ currentVersion: number }> } } };
      expect(e.response.error.code).toBe('ORGANIZATION_VERSION_CONFLICT');
      expect(e.response.error.details[0]?.currentVersion).toBe(5);
    }
  });

  it('throws 409 on name conflict during rename', async () => {
    const conflictOrg = makeOrg({ id: 'org-002', name: 'Beta Corp' });
    const svc = buildService({
      findById: jest.fn().mockResolvedValue(makeOrg({ status: 'active' })),
      findByName: jest.fn().mockResolvedValue(conflictOrg),
      updateOrganization: jest.fn().mockResolvedValue(makeOrg({ name: 'Beta Corp', version: 2 })),
    });
    await expect(
      svc.update('ten-001', 'org-001', { version: 1, name: 'Beta Corp' }, 'user-001'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('succeeds on valid partial update with matching version', async () => {
    const updated = makeOrg({ name: 'Renamed Corp', version: 2 });
    const svc = buildService({
      findById: jest.fn().mockResolvedValue(makeOrg({ status: 'active' })),
      findByName: jest.fn().mockResolvedValue(null),
      updateOrganization: jest.fn().mockResolvedValue(updated),
    });
    const result = await svc.update(
      'ten-001', 'org-001', { version: 1, name: 'Renamed Corp' }, 'user-001',
    );
    expect(result.name).toBe('Renamed Corp');
    expect(result.version).toBe(2);
  });

  it('throws 400 when custom field validation fails on update', async () => {
    const svc = new OrganizationsService(
      makeRepo({
        findById: jest.fn().mockResolvedValue(makeOrg({ status: 'active' })),
        findByName: jest.fn().mockResolvedValue(null),
      }) as never,
      makeCustomFieldSvc(false) as never,  // invalid cf values
      makeVerifiedDomainSvc() as never,
      makeAuditWriter() as never,
    );
    await expect(
      svc.update('ten-001', 'org-001', {
        version: 1,
        customFieldValues: { cloud_provider: 'invalid' },
      }, 'user-001'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// DTO validation — CreateOrganizationSchema
// ---------------------------------------------------------------------------

describe('CreateOrganizationSchema', () => {
  it('accepts a valid minimal payload', () => {
    const result = CreateOrganizationSchema.safeParse({ name: 'Acme Corp', slaTier: 'standard' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown properties (strict mode)', () => {
    const result = CreateOrganizationSchema.safeParse({
      name: 'Acme Corp',
      slaTier: 'standard',
      unknownField: 'should be rejected',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing name', () => {
    const result = CreateOrganizationSchema.safeParse({ slaTier: 'standard' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    const result = CreateOrganizationSchema.safeParse({ name: '', slaTier: 'standard' });
    expect(result.success).toBe(false);
  });

  it('rejects a name exceeding 200 chars', () => {
    const result = CreateOrganizationSchema.safeParse({ name: 'A'.repeat(201), slaTier: 'standard' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid slaTier', () => {
    const result = CreateOrganizationSchema.safeParse({ name: 'Corp', slaTier: 'gold' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid region', () => {
    const result = CreateOrganizationSchema.safeParse({ name: 'Corp', slaTier: 'standard', region: 'invalid-region' });
    expect(result.success).toBe(false);
  });

  it('rejects customFieldValues exceeding 32 KB', () => {
    const bigPayload = { key: 'x'.repeat(35_000) };
    const result = CreateOrganizationSchema.safeParse({
      name: 'Corp',
      slaTier: 'standard',
      customFieldValues: bigPayload,
    });
    expect(result.success).toBe(false);
  });

  it('defaults slaTier to standard when omitted', () => {
    const result = CreateOrganizationSchema.safeParse({ name: 'Corp' });
    if (result.success) {
      expect(result.data.slaTier).toBe('standard');
    } else {
      // If name alone is sufficient, slaTier defaults
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid slug pattern', () => {
    const result = CreateOrganizationSchema.safeParse({
      name: 'Corp',
      slaTier: 'standard',
      slug: 'UPPERCASE-SLUG',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DTO validation — UpdateOrganizationSchema
// ---------------------------------------------------------------------------

describe('UpdateOrganizationSchema', () => {
  it('accepts a valid partial update with version', () => {
    const result = UpdateOrganizationSchema.safeParse({ version: 1, name: 'Renamed' });
    expect(result.success).toBe(true);
  });

  it('requires version field', () => {
    const result = UpdateOrganizationSchema.safeParse({ name: 'Renamed' });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer version', () => {
    const result = UpdateOrganizationSchema.safeParse({ version: 1.5, name: 'Renamed' });
    expect(result.success).toBe(false);
  });

  it('rejects non-positive version (zero)', () => {
    const result = UpdateOrganizationSchema.safeParse({ version: 0, name: 'Renamed' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown properties (strict mode)', () => {
    const result = UpdateOrganizationSchema.safeParse({ version: 1, unexpectedProp: 'bad' });
    expect(result.success).toBe(false);
  });

  it('allows version-only payload (no-op update)', () => {
    const result = UpdateOrganizationSchema.safeParse({ version: 1 });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DTO validation — ListOrganizationsQuerySchema
// ---------------------------------------------------------------------------

describe('ListOrganizationsQuerySchema', () => {
  it('defaults limit to 25 when not provided', () => {
    const result = ListOrganizationsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(DEFAULT_LIMIT);
    }
  });

  it('clamps limit=0 to 1', () => {
    const result = ListOrganizationsQuerySchema.safeParse({ limit: '0' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(1);
  });

  it('clamps limit=-1 to 1', () => {
    const result = ListOrganizationsQuerySchema.safeParse({ limit: '-1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(1);
  });

  it(`clamps limit=1000 to ${MAX_LIMIT}`, () => {
    const result = ListOrganizationsQuerySchema.safeParse({ limit: '1000' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(MAX_LIMIT);
  });

  it('accepts limit=100 (hard cap)', () => {
    const result = ListOrganizationsQuerySchema.safeParse({ limit: '100' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(MAX_LIMIT);
  });

  it('accepts all valid tier values', () => {
    for (const tier of ['standard', 'premium', 'enterprise']) {
      const result = ListOrganizationsQuerySchema.safeParse({ tier });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an invalid tier', () => {
    const result = ListOrganizationsQuerySchema.safeParse({ tier: 'gold' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid status', () => {
    const result = ListOrganizationsQuerySchema.safeParse({ status: 'pending' });
    expect(result.success).toBe(false);
  });

  it('rejects customField without colon separator', () => {
    const result = ListOrganizationsQuerySchema.safeParse({ customField: 'nokeyvalue' });
    expect(result.success).toBe(false);
  });

  it('accepts customField in key:value format', () => {
    const result = ListOrganizationsQuerySchema.safeParse({ customField: 'cloud_provider:aws' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown query parameters (strict mode)', () => {
    const result = ListOrganizationsQuerySchema.safeParse({ unknown: 'param' });
    expect(result.success).toBe(false);
  });

  it('rejects q exceeding 200 chars', () => {
    const result = ListOrganizationsQuerySchema.safeParse({ q: 'x'.repeat(201) });
    expect(result.success).toBe(false);
  });
});
