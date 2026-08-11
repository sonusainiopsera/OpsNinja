import type { PrincipalContext } from '../../observability/request-context';
import { buildOrgScopePredicate, isTenantWide } from '../scope-predicate';

function makePrincipal(overrides: Partial<PrincipalContext> = {}): PrincipalContext {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: [],
    traceId: 'trace-1',
    ...overrides,
  };
}

describe('buildOrgScopePredicate', () => {
  describe('tenant-wide roles', () => {
    it('returns undefined for admin', () => {
      const p = makePrincipal({ roles: ['admin'] });
      expect(buildOrgScopePredicate(p)).toBeUndefined();
    });

    it('returns undefined for supervisor', () => {
      const p = makePrincipal({ roles: ['supervisor'] });
      expect(buildOrgScopePredicate(p)).toBeUndefined();
    });

    it('returns undefined for manager', () => {
      const p = makePrincipal({ roles: ['manager'] });
      expect(buildOrgScopePredicate(p)).toBeUndefined();
    });

    it('returns undefined for lead', () => {
      const p = makePrincipal({ roles: ['lead'] });
      expect(buildOrgScopePredicate(p)).toBeUndefined();
    });

    it('returns undefined for analyst', () => {
      const p = makePrincipal({ roles: ['analyst'] });
      expect(buildOrgScopePredicate(p)).toBeUndefined();
    });
  });

  describe('empty scope set (scoped agent)', () => {
    it('returns a non-undefined predicate (always-false)', () => {
      const p = makePrincipal({ roles: ['agent'], orgScopeIds: [] });
      const pred = buildOrgScopePredicate(p);
      expect(pred).not.toBeUndefined();
    });

    it('contains the always-false sentinel "1 = 0"', () => {
      const p = makePrincipal({ roles: ['agent'], orgScopeIds: [] });
      const pred = buildOrgScopePredicate(p)!;
      // SQL template literal serialises to something containing "1 = 0"
      const serialised = JSON.stringify(pred);
      expect(serialised).toContain('1 = 0');
    });
  });

  describe('small scope set (≤50 orgs)', () => {
    it('returns a non-undefined predicate', () => {
      const p = makePrincipal({ roles: ['agent'], orgScopeIds: ['org-1', 'org-2'] });
      const pred = buildOrgScopePredicate(p);
      expect(pred).not.toBeUndefined();
    });

    it('contains the org IDs in the SQL', () => {
      const orgIds = ['org-aaa', 'org-bbb'];
      const p = makePrincipal({ roles: ['agent'], orgScopeIds: orgIds });
      const pred = buildOrgScopePredicate(p)!;
      const serialised = JSON.stringify(pred);
      for (const id of orgIds) {
        expect(serialised).toContain(id);
      }
    });
  });

  describe('large scope set (>50 orgs)', () => {
    it('returns a non-undefined predicate', () => {
      const orgIds = Array.from({ length: 51 }, (_, i) => `org-${i}`);
      const p = makePrincipal({ roles: ['agent'], orgScopeIds: orgIds });
      expect(buildOrgScopePredicate(p)).not.toBeUndefined();
    });

    it('uses EXISTS subquery (not IN list)', () => {
      const orgIds = Array.from({ length: 51 }, (_, i) => `org-${i}`);
      const p = makePrincipal({ roles: ['agent'], orgScopeIds: orgIds });
      const pred = buildOrgScopePredicate(p)!;
      const serialised = JSON.stringify(pred);
      expect(serialised).toContain('EXISTS');
      expect(serialised).toContain('agent_org_scopes');
    });
  });

  describe('portal principal', () => {
    it('returns always-false predicate when portal user has no bound org', () => {
      const p = makePrincipal({ principalKind: 'portal', roles: ['portal_user'], orgScopeIds: [] });
      const pred = buildOrgScopePredicate(p)!;
      const serialised = JSON.stringify(pred);
      expect(serialised).toContain('1 = 0');
    });

    it('returns an org-equality predicate for a portal user with a bound org', () => {
      const p = makePrincipal({
        principalKind: 'portal',
        roles: ['portal_user'],
        orgScopeIds: ['org-portal-1'],
      });
      const pred = buildOrgScopePredicate(p)!;
      expect(pred).not.toBeUndefined();
      const serialised = JSON.stringify(pred);
      expect(serialised).toContain('org-portal-1');
    });
  });
});

describe('isTenantWide', () => {
  it('returns true for tenant-wide roles', () => {
    for (const role of ['admin', 'supervisor', 'manager', 'lead', 'analyst', 'readonly']) {
      expect(isTenantWide(makePrincipal({ roles: [role] }))).toBe(true);
    }
  });

  it('returns false for agent', () => {
    expect(isTenantWide(makePrincipal({ roles: ['agent'] }))).toBe(false);
  });

  it('returns false for portal principal', () => {
    expect(isTenantWide(makePrincipal({ principalKind: 'portal', roles: ['portal_user'] }))).toBe(false);
  });

  it('returns false for machine principal', () => {
    expect(isTenantWide(makePrincipal({ principalKind: 'machine', roles: ['worker'] }))).toBe(false);
  });
});
