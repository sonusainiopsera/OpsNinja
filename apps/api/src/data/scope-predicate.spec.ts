/**
 * Unit tests for buildOrgScopePredicate and withOrgScope.
 */

import { buildOrgScopePredicate } from './scope-predicate';
import type { PrincipalContext } from '../observability/request-context';

// Minimal column stub with the shape Drizzle provides
const stubColumn = {
  name: 'organization_id',
  table: { name: 'tickets' },
} as never;

function makePrincipal(overrides: Partial<PrincipalContext>): PrincipalContext {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    principalKind: 'staff',
    roles: ['agent'],
    orgScopeIds: ['org-a'],
    traceId: 'trace-1',
    ...overrides,
  };
}

describe('buildOrgScopePredicate', () => {
  it('returns null for admin (tenant-wide role)', () => {
    const p = makePrincipal({ roles: ['admin'] });
    expect(buildOrgScopePredicate(p, stubColumn)).toBeNull();
  });

  it('returns null for lead_analyst (tenant-wide role)', () => {
    const p = makePrincipal({ roles: ['lead_analyst'] });
    expect(buildOrgScopePredicate(p, stubColumn)).toBeNull();
  });

  it('returns null for machine principal', () => {
    const p = makePrincipal({ principalKind: 'machine', roles: ['machine'] });
    expect(buildOrgScopePredicate(p, stubColumn)).toBeNull();
  });

  it('returns sql`false` for empty scope set (agent with no orgs)', () => {
    const p = makePrincipal({ orgScopeIds: [] });
    const result = buildOrgScopePredicate(p, stubColumn);
    // The result should be a Drizzle sql expression (truthy but not null)
    expect(result).not.toBeNull();
    // Verify it's the always-false sql expression by checking its toString
    expect(String(result)).toContain('false');
  });

  it('returns sql`false` for portal principal with no boundOrganizationId', () => {
    const p = makePrincipal({
      principalKind: 'portal',
      boundOrganizationId: undefined,
    });
    const result = buildOrgScopePredicate(p, stubColumn);
    expect(result).not.toBeNull();
    expect(String(result)).toContain('false');
  });

  it('returns an eq predicate for portal principal with boundOrganizationId', () => {
    const p = makePrincipal({
      principalKind: 'portal',
      boundOrganizationId: 'org-portal',
    });
    const result = buildOrgScopePredicate(p, stubColumn);
    expect(result).not.toBeNull();
    // Should be an eq expression referencing the org id
    expect(String(result)).toContain('org-portal');
  });

  it('returns inArray predicate for normal scope set', () => {
    const p = makePrincipal({ orgScopeIds: ['org-a', 'org-b'] });
    const result = buildOrgScopePredicate(p, stubColumn);
    expect(result).not.toBeNull();
    const str = String(result);
    expect(str).toContain('org-a');
    expect(str).toContain('org-b');
  });
});
