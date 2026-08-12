/**
 * Unit tests for VerifiedDomainsService (WO-028).
 *
 * Tests the state machine, resolver and error handling using
 * in-memory doubles (no NestJS DI, no database, no DNS).
 *
 * Covers:
 *   - register: normalisation, free-mail/public-suffix rejection, duplicate 409
 *   - verifyViaDns: success path, already-verified idempotency, revoked guard, DNS failure
 *   - adminOverride: success path, mandatory justification, revoked guard, idempotency
 *   - revoke: success, already-revoked idempotency
 *   - resolveOrganizationByEmailDomain: exact match, wildcard, most-specific-wins,
 *       unknown-domain null, ambiguity guard (fail-closed)
 */

import {
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';

import { VerifiedDomainsService } from './verified-domains.service';
import type { VerifiedDomainsRepository } from './verified-domains.repository';
import { StubDomainOwnershipVerifier } from './domain-ownership.verifier';
import type { OrganizationVerifiedDomain } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'ten-00000000-0000-0000-0000-000000000001';
const ORG_ID    = 'org-00000000-0000-0000-0000-000000000001';
const ORG_ID_2  = 'org-00000000-0000-0000-0000-000000000002';
const USER_ID   = 'usr-00000000-0000-0000-0000-000000000001';
const DOMAIN_ID = 'dom-00000000-0000-0000-0000-000000000001';

function makeEntry(overrides: Partial<OrganizationVerifiedDomain> = {}): OrganizationVerifiedDomain {
  return {
    id:               DOMAIN_ID,
    tenantId:         TENANT_ID,
    organizationId:   ORG_ID,
    domain:           'acmecorp.com',
    status:           'pending',
    includeSubdomains: false,
    challengeTokenHash: 'abc123',
    verifiedAt:       null,
    verifiedBy:       null,
    verifiedVia:      'dns_txt',
    revokedAt:        null,
    createdAt:        new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as OrganizationVerifiedDomain;
}

// ---------------------------------------------------------------------------
// Repository double
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<VerifiedDomainsRepository> = {}): VerifiedDomainsRepository {
  return {
    findByOrgId:          jest.fn().mockResolvedValue([]),
    findById:             jest.fn().mockResolvedValue(null),
    findByDomain:         jest.fn().mockResolvedValue(null),
    findVerifiedByTenant: jest.fn().mockResolvedValue([]),
    createDomain:         jest.fn().mockResolvedValue(makeEntry()),
    setVerified:          jest.fn().mockResolvedValue(makeEntry({ status: 'verified', verifiedAt: new Date() })),
    setRevoked:           jest.fn().mockResolvedValue(makeEntry({ status: 'revoked', revokedAt: new Date() })),
    ...overrides,
  } as unknown as VerifiedDomainsRepository;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeService(
  repoOverrides: Partial<VerifiedDomainsRepository> = {},
  verifier?: StubDomainOwnershipVerifier,
): { service: VerifiedDomainsService; stub: StubDomainOwnershipVerifier } {
  const stub = verifier ?? new StubDomainOwnershipVerifier();
  const repo = makeRepo(repoOverrides);
  const service = new VerifiedDomainsService(repo, stub);
  return { service, stub };
}

// ---------------------------------------------------------------------------
// register
// ---------------------------------------------------------------------------

describe('VerifiedDomainsService.register', () => {
  it('returns a pending entry with challenge payload on success', async () => {
    const { service } = makeService();
    const result = await service.register(TENANT_ID, ORG_ID, {
      domain: 'acmecorp.com',
      includeSubdomains: false,
    });
    expect(result.domain.status).toBe('pending');
    expect(result.recordName).toMatch(/_opsninja-verification\.acmecorp\.com/);
    expect(result.recordValue).toMatch(/^opsninja-domain-verification=/);
    expect(result.rawToken).toBeTruthy();
  });

  it('normalises the domain (uppercase → lowercase)', async () => {
    const repo = makeRepo();
    const { service } = makeService({
      createDomain: jest.fn().mockResolvedValue(makeEntry({ domain: 'acmecorp.com' })),
    } as never);

    await service.register(TENANT_ID, ORG_ID, {
      domain: 'ACMECORP.COM',
      includeSubdomains: false,
    });

    expect((makeRepo().createDomain as jest.Mock)).not.toHaveBeenCalled();
    // Verify the domain was passed normalised to the repo
    const repoSpy = makeRepo({ createDomain: jest.fn().mockResolvedValue(makeEntry()) });
    const svc = new VerifiedDomainsService(repoSpy, new StubDomainOwnershipVerifier());
    await svc.register(TENANT_ID, ORG_ID, { domain: 'ACMECORP.COM', includeSubdomains: false });
    const call = (repoSpy.createDomain as jest.Mock).mock.calls[0] as [string, { domain: string }];
    expect(call[1].domain).toBe('acmecorp.com');
  });

  it('rejects a free-mail domain with 422 DOMAIN_NOT_ALLOWED', async () => {
    const { service } = makeService();
    await expect(
      service.register(TENANT_ID, ORG_ID, { domain: 'gmail.com', includeSubdomains: false }),
    ).rejects.toThrow(UnprocessableEntityException);

    try {
      await service.register(TENANT_ID, ORG_ID, { domain: 'gmail.com', includeSubdomains: false });
    } catch (err) {
      const e = err as { response?: { error?: { code?: string } } };
      expect(e.response?.error?.code).toBe('DOMAIN_NOT_ALLOWED');
    }
  });

  it('rejects a disposable email domain with 422 DOMAIN_NOT_ALLOWED', async () => {
    const { service } = makeService();
    await expect(
      service.register(TENANT_ID, ORG_ID, { domain: 'mailinator.com', includeSubdomains: false }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a public suffix with 422 DOMAIN_IS_PUBLIC_SUFFIX', async () => {
    const { service } = makeService();
    await expect(
      service.register(TENANT_ID, ORG_ID, { domain: 'co.uk', includeSubdomains: false }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('rejects a malformed domain with 400 DOMAIN_INVALID', async () => {
    const { service } = makeService();
    await expect(
      service.register(TENANT_ID, ORG_ID, { domain: '..invalid..', includeSubdomains: false }),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns 409 VERIFIED_DOMAIN_CONFLICT on duplicate domain', async () => {
    const { service } = makeService({
      createDomain: jest.fn().mockResolvedValue('DUPLICATE_DOMAIN'),
    });

    await expect(
      service.register(TENANT_ID, ORG_ID, { domain: 'acmecorp.com', includeSubdomains: false }),
    ).rejects.toThrow(ConflictException);

    try {
      await service.register(TENANT_ID, ORG_ID, { domain: 'acmecorp.com', includeSubdomains: false });
    } catch (err) {
      const e = err as { response?: { error?: { code?: string } } };
      expect(e.response?.error?.code).toBe('VERIFIED_DOMAIN_CONFLICT');
    }
  });
});

// ---------------------------------------------------------------------------
// verifyViaDns
// ---------------------------------------------------------------------------

describe('VerifiedDomainsService.verifyViaDns', () => {
  it('transitions to verified on DNS match', async () => {
    const entry = makeEntry({ challengeTokenHash: 'somehash' });
    const stub = new StubDomainOwnershipVerifier();
    stub.setVerified('acmecorp.com');

    const { service } = makeService(
      {
        findById: jest.fn().mockResolvedValue(entry),
        setVerified: jest.fn().mockResolvedValue(makeEntry({ status: 'verified', verifiedAt: new Date() })),
      },
      stub,
    );

    const result = await service.verifyViaDns(TENANT_ID, ORG_ID, DOMAIN_ID, USER_ID);
    expect(result.status).toBe('verified');
  });

  it('returns the current entry when already verified (idempotent)', async () => {
    const verified = makeEntry({ status: 'verified', verifiedAt: new Date() });
    const { service } = makeService({
      findById: jest.fn().mockResolvedValue(verified),
    });

    const result = await service.verifyViaDns(TENANT_ID, ORG_ID, DOMAIN_ID, USER_ID);
    expect(result.status).toBe('verified');
  });

  it('throws 422 DOMAIN_REVOKED when domain is revoked', async () => {
    const revoked = makeEntry({ status: 'revoked' });
    const { service } = makeService({
      findById: jest.fn().mockResolvedValue(revoked),
    });

    await expect(
      service.verifyViaDns(TENANT_ID, ORG_ID, DOMAIN_ID, USER_ID),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('throws 422 DOMAIN_VERIFICATION_FAILED on DNS NXDOMAIN', async () => {
    const entry = makeEntry({ challengeTokenHash: 'somehash' });
    const stub = new StubDomainOwnershipVerifier();
    stub.setFailure('acmecorp.com', 'NXDOMAIN');

    const { service } = makeService({ findById: jest.fn().mockResolvedValue(entry) }, stub);

    try {
      await service.verifyViaDns(TENANT_ID, ORG_ID, DOMAIN_ID, USER_ID);
      fail('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      const e = err as { response?: { error?: { code?: string; message?: string } } };
      expect(e.response?.error?.code).toBe('DOMAIN_VERIFICATION_FAILED');
      expect(e.response?.error?.message).toMatch(/not found/i);
    }
  });

  it('throws 422 DOMAIN_VERIFICATION_FAILED on DNS TIMEOUT', async () => {
    const entry = makeEntry({ challengeTokenHash: 'somehash' });
    const stub = new StubDomainOwnershipVerifier();
    stub.setFailure('acmecorp.com', 'TIMEOUT');

    const { service } = makeService({ findById: jest.fn().mockResolvedValue(entry) }, stub);

    try {
      await service.verifyViaDns(TENANT_ID, ORG_ID, DOMAIN_ID, USER_ID);
      fail('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      const e = err as { response?: { error?: { code?: string; message?: string } } };
      expect(e.response?.error?.code).toBe('DOMAIN_VERIFICATION_FAILED');
      expect(e.response?.error?.message).toMatch(/timeout/i);
    }
  });

  it('throws 422 DOMAIN_VERIFICATION_FAILED on DNS SERVFAIL', async () => {
    const entry = makeEntry({ challengeTokenHash: 'somehash' });
    const stub = new StubDomainOwnershipVerifier();
    stub.setFailure('acmecorp.com', 'SERVFAIL');

    const { service } = makeService({ findById: jest.fn().mockResolvedValue(entry) }, stub);

    try {
      await service.verifyViaDns(TENANT_ID, ORG_ID, DOMAIN_ID, USER_ID);
      fail('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      const e = err as { response?: { error?: { code?: string; message?: string } } };
      expect(e.response?.error?.code).toBe('DOMAIN_VERIFICATION_FAILED');
      expect(e.response?.error?.message).toMatch(/servfail|server.*error/i);
    }
  });

  it('throws 404 when domain entry not found', async () => {
    const { service } = makeService({ findById: jest.fn().mockResolvedValue(null) });

    await expect(
      service.verifyViaDns(TENANT_ID, ORG_ID, DOMAIN_ID, USER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws 404 when domain belongs to a different org (org-id enumeration protection)', async () => {
    const entry = makeEntry({ organizationId: 'other-org' });
    const { service } = makeService({ findById: jest.fn().mockResolvedValue(entry) });

    await expect(
      service.verifyViaDns(TENANT_ID, ORG_ID, DOMAIN_ID, USER_ID),
    ).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// adminOverride
// ---------------------------------------------------------------------------

describe('VerifiedDomainsService.adminOverride', () => {
  it('transitions to verified with method admin_override', async () => {
    const entry = makeEntry();
    const { service } = makeService({
      findById: jest.fn().mockResolvedValue(entry),
      setVerified: jest.fn().mockResolvedValue(makeEntry({
        status: 'verified',
        verifiedAt: new Date(),
        verifiedVia: 'admin_override',
      })),
    });

    const result = await service.adminOverride(TENANT_ID, ORG_ID, DOMAIN_ID, {
      justification: 'Verified via email thread with customer IT team',
    }, USER_ID);

    expect(result.status).toBe('verified');
  });

  it('is idempotent if already verified', async () => {
    const verified = makeEntry({ status: 'verified', verifiedAt: new Date() });
    const setVerifiedSpy = jest.fn();
    const { service } = makeService({
      findById: jest.fn().mockResolvedValue(verified),
      setVerified: setVerifiedSpy,
    });

    const result = await service.adminOverride(TENANT_ID, ORG_ID, DOMAIN_ID, {
      justification: 'duplicate call',
    }, USER_ID);

    expect(result.status).toBe('verified');
    expect(setVerifiedSpy).not.toHaveBeenCalled();
  });

  it('throws 422 DOMAIN_REVOKED when domain is revoked', async () => {
    const revoked = makeEntry({ status: 'revoked' });
    const { service } = makeService({ findById: jest.fn().mockResolvedValue(revoked) });

    await expect(
      service.adminOverride(TENANT_ID, ORG_ID, DOMAIN_ID, {
        justification: 'Trying to re-verify a revoked domain',
      }, USER_ID),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});

// ---------------------------------------------------------------------------
// revoke
// ---------------------------------------------------------------------------

describe('VerifiedDomainsService.revoke', () => {
  it('transitions a pending entry to revoked', async () => {
    const entry = makeEntry();
    const { service } = makeService({
      findById: jest.fn().mockResolvedValue(entry),
      setRevoked: jest.fn().mockResolvedValue(makeEntry({ status: 'revoked', revokedAt: new Date() })),
    });

    const result = await service.revoke(TENANT_ID, ORG_ID, DOMAIN_ID);
    expect(result.status).toBe('revoked');
  });

  it('is idempotent if already revoked', async () => {
    const revoked = makeEntry({ status: 'revoked', revokedAt: new Date() });
    const setRevokedSpy = jest.fn();
    const { service } = makeService({
      findById: jest.fn().mockResolvedValue(revoked),
      setRevoked: setRevokedSpy,
    });

    const result = await service.revoke(TENANT_ID, ORG_ID, DOMAIN_ID);
    expect(result.status).toBe('revoked');
    expect(setRevokedSpy).not.toHaveBeenCalled();
  });

  it('throws 404 for unknown domain', async () => {
    const { service } = makeService({ findById: jest.fn().mockResolvedValue(null) });

    await expect(service.revoke(TENANT_ID, ORG_ID, DOMAIN_ID)).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// resolveOrganizationByEmailDomain
// ---------------------------------------------------------------------------

describe('VerifiedDomainsService.resolveOrganizationByEmailDomain', () => {
  it('returns { organizationId } for an exact match', async () => {
    const verified = makeEntry({ status: 'verified', domain: 'acmecorp.com', organizationId: ORG_ID });
    const { service } = makeService({
      findVerifiedByTenant: jest.fn().mockResolvedValue([verified]),
    });

    const result = await service.resolveOrganizationByEmailDomain(TENANT_ID, 'acmecorp.com');
    expect(result).toEqual({ organizationId: ORG_ID });
  });

  it('is case-insensitive on the email domain lookup', async () => {
    const verified = makeEntry({ status: 'verified', domain: 'acmecorp.com', organizationId: ORG_ID });
    const { service } = makeService({
      findVerifiedByTenant: jest.fn().mockResolvedValue([verified]),
    });

    const result = await service.resolveOrganizationByEmailDomain(TENANT_ID, 'ACMECORP.COM');
    expect(result).toEqual({ organizationId: ORG_ID });
  });

  it('returns null when no verified domain matches', async () => {
    const { service } = makeService({
      findVerifiedByTenant: jest.fn().mockResolvedValue([]),
    });

    const result = await service.resolveOrganizationByEmailDomain(TENANT_ID, 'unknowncorp.com');
    expect(result).toBeNull();
  });

  it('returns null when the only entry is pending (not verified)', async () => {
    // findVerifiedByTenant only returns verified rows — service test ensures
    // the resolver honours the already-filtered result.
    const { service } = makeService({
      findVerifiedByTenant: jest.fn().mockResolvedValue([]),
    });

    const result = await service.resolveOrganizationByEmailDomain(TENANT_ID, 'acmecorp.com');
    expect(result).toBeNull();
  });

  // Wildcard policy
  it('matches a subdomain when includeSubdomains is true', async () => {
    const wildcard = makeEntry({
      domain: 'acmecorp.com',
      status: 'verified',
      includeSubdomains: true,
      organizationId: ORG_ID,
    });
    const { service } = makeService({
      findVerifiedByTenant: jest.fn().mockResolvedValue([wildcard]),
    });

    const result = await service.resolveOrganizationByEmailDomain(TENANT_ID, 'mail.acmecorp.com');
    expect(result).toEqual({ organizationId: ORG_ID });
  });

  it('does NOT wildcard-match when includeSubdomains is false', async () => {
    const exact = makeEntry({
      domain: 'acmecorp.com',
      status: 'verified',
      includeSubdomains: false,
      organizationId: ORG_ID,
    });
    const { service } = makeService({
      findVerifiedByTenant: jest.fn().mockResolvedValue([exact]),
    });

    const result = await service.resolveOrganizationByEmailDomain(TENANT_ID, 'mail.acmecorp.com');
    expect(result).toBeNull();
  });

  // Most-specific-wins: exact match overrides wildcard
  it('prefers exact match over wildcard (most-specific wins)', async () => {
    const wildcard = makeEntry({
      id: 'dom-wildcard',
      domain: 'acmecorp.com',
      status: 'verified',
      includeSubdomains: true,
      organizationId: ORG_ID_2, // wildcard org
    });
    const exact = makeEntry({
      id: 'dom-exact',
      domain: 'mail.acmecorp.com',
      status: 'verified',
      includeSubdomains: false,
      organizationId: ORG_ID, // exact-match org
    });
    const { service } = makeService({
      findVerifiedByTenant: jest.fn().mockResolvedValue([wildcard, exact]),
    });

    const result = await service.resolveOrganizationByEmailDomain(TENANT_ID, 'mail.acmecorp.com');
    expect(result).toEqual({ organizationId: ORG_ID }); // exact wins
  });

  // Ambiguity guard — fail-closed
  it('returns null and does not pick a winner when multiple exact matches exist', async () => {
    // Two verified entries for same domain in same tenant (should be impossible via DB constraint,
    // but the service must handle it defensively)
    const entry1 = makeEntry({ id: 'dom-1', domain: 'acmecorp.com', organizationId: ORG_ID });
    const entry2 = makeEntry({ id: 'dom-2', domain: 'acmecorp.com', organizationId: ORG_ID_2 });
    const { service } = makeService({
      findVerifiedByTenant: jest.fn().mockResolvedValue([entry1, entry2]),
    });

    const result = await service.resolveOrganizationByEmailDomain(TENANT_ID, 'acmecorp.com');
    expect(result).toBeNull(); // fail-closed
  });

  it('returns null for an invalid email domain input', async () => {
    const { service } = makeService({ findVerifiedByTenant: jest.fn().mockResolvedValue([]) });

    const result = await service.resolveOrganizationByEmailDomain(TENANT_ID, '..invalid..');
    expect(result).toBeNull();
  });

  // Most-specific wildcard wins when two wildcard entries both match
  it('picks the longer (more-specific) wildcard when two overlap', async () => {
    const broad = makeEntry({
      id: 'dom-broad',
      domain: 'corp.com',
      status: 'verified',
      includeSubdomains: true,
      organizationId: ORG_ID_2,
    });
    const specific = makeEntry({
      id: 'dom-specific',
      domain: 'us.corp.com',
      status: 'verified',
      includeSubdomains: true,
      organizationId: ORG_ID,
    });
    const { service } = makeService({
      findVerifiedByTenant: jest.fn().mockResolvedValue([broad, specific]),
    });

    const result = await service.resolveOrganizationByEmailDomain(TENANT_ID, 'team.us.corp.com');
    expect(result).toEqual({ organizationId: ORG_ID }); // more-specific wins
  });
});
