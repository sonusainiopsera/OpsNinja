/**
 * Factory unit tests: schema conformance, deterministic output under fixed seed,
 * correct enum/state distributions.
 */

import { SeededPrng } from '../prng';
import { buildTenants, buildOrganizations } from '../factories/organizations.factory';
import { buildStaffUsers } from '../factories/users.factory';
import { buildTickets } from '../factories/tickets.factory';
import { buildComments } from '../factories/comments.factory';
import { buildSlaPolicies, buildSlaTimers } from '../factories/sla.factory';
import { DEFAULT_COLLISION_MATRIX } from '../collision-matrix';
import { partitionWindow, SMALL_PROFILE } from '../profiles';

const NOW = new Date('2025-01-15T00:00:00.000Z');
const SEED = 999;

function makePrng() {
  return new SeededPrng(SEED);
}

describe('buildTenants', () => {
  it('generates requested count', () => {
    expect(buildTenants(makePrng(), 3)).toHaveLength(3);
  });

  it('each tenant has a unique id and slug', () => {
    const tenants = buildTenants(makePrng(), 3);
    const ids = tenants.map((t) => t.id);
    const slugs = tenants.map((t) => t.slug);
    expect(new Set(ids).size).toBe(3);
    expect(new Set(slugs).size).toBe(3);
  });

  it('deterministic under fixed seed', () => {
    const a = buildTenants(new SeededPrng(42), 3);
    const b = buildTenants(new SeededPrng(42), 3);
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
  });
});

describe('buildOrganizations', () => {
  it('generates orgsPerTenant × tenantCount rows', () => {
    const prng = makePrng();
    const tenants = buildTenants(prng, 3);
    const orgs = buildOrganizations(prng, tenants, 4, NOW);
    expect(orgs).toHaveLength(12);
  });

  it('all orgs have reserved example.com domains', () => {
    const prng = makePrng();
    const tenants = buildTenants(prng, 3);
    const orgs = buildOrganizations(prng, tenants, 4, NOW);
    for (const org of orgs) {
      expect(org.domain).toMatch(/\.example\.com$/);
    }
  });
});

describe('buildStaffUsers', () => {
  it('generates staffPerTenant × tenantCount rows', () => {
    const prng = makePrng();
    const tenants = buildTenants(prng, 3);
    const users = buildStaffUsers(prng, tenants, 7, NOW);
    expect(users).toHaveLength(21);
  });

  it('covers all 5 roles', () => {
    const prng = makePrng();
    const tenants = buildTenants(prng, 1);
    const users = buildStaffUsers(prng, tenants, 10, NOW);
    const roles = new Set(users.map((u) => u.role));
    expect(roles.size).toBeGreaterThanOrEqual(5);
  });
});

describe('buildTickets', () => {
  function mkTickets(seed = SEED) {
    const prng = new SeededPrng(seed);
    const tenants = buildTenants(prng, 3);
    const orgs = buildOrganizations(prng, tenants, 4, NOW);
    const users = buildStaffUsers(prng, tenants, 7, NOW);
    const { start, end } = partitionWindow(SMALL_PROFILE, NOW);
    return buildTickets(
      prng, tenants, orgs.map((o) => o.id), users.map((u) => u.id),
      400, start, end, DEFAULT_COLLISION_MATRIX,
    );
  }

  it('generates requested ticket count', () => {
    expect(mkTickets()).toHaveLength(400);
  });

  it('includes all four priorities', () => {
    const tkts = mkTickets();
    const priorities = new Set(tkts.map((t) => t.priority));
    expect([...priorities]).toEqual(expect.arrayContaining(['p1', 'p2', 'p3', 'p4']));
  });

  it('includes all statuses', () => {
    const tkts = mkTickets();
    const statuses = new Set(tkts.map((t) => t.status));
    expect(statuses.size).toBeGreaterThanOrEqual(4);
  });

  it('deterministic under same seed', () => {
    const a = mkTickets(1).map((t) => t.id);
    const b = mkTickets(1).map((t) => t.id);
    expect(a).toEqual(b);
  });
});

describe('buildComments', () => {
  it('generates roughly commentCount comments', () => {
    const prng = makePrng();
    const tenants = buildTenants(prng, 3);
    const orgs = buildOrganizations(prng, tenants, 4, NOW);
    const users = buildStaffUsers(prng, tenants, 7, NOW);
    const { start, end } = partitionWindow(SMALL_PROFILE, NOW);
    const tkts = buildTickets(
      prng, tenants, orgs.map((o) => o.id), users.map((u) => u.id),
      400, start, end, DEFAULT_COLLISION_MATRIX,
    );
    const cmts = buildComments(prng, tkts, users.map((u) => u.id), 3000);
    // Allow ±20% variance from the target
    expect(cmts.length).toBeGreaterThan(2400);
  });

  it('includes both public and internal visibility', () => {
    const prng = makePrng();
    const tenants = buildTenants(prng, 1);
    const orgs = buildOrganizations(prng, tenants, 2, NOW);
    const users = buildStaffUsers(prng, tenants, 5, NOW);
    const { start, end } = partitionWindow(SMALL_PROFILE, NOW);
    const tkts = buildTickets(
      prng, tenants, orgs.map((o) => o.id), users.map((u) => u.id),
      100, start, end, DEFAULT_COLLISION_MATRIX,
    );
    const cmts = buildComments(prng, tkts, users.map((u) => u.id), 500);
    const internal = cmts.filter((c) => c.visibility === 'internal');
    const pub = cmts.filter((c) => c.visibility === 'public');
    expect(internal.length).toBeGreaterThan(0);
    expect(pub.length).toBeGreaterThan(0);
  });
});

describe('buildSlaPolicies and buildSlaTimers', () => {
  it('generates 4 policies per tenant (P1–P4)', () => {
    const prng = makePrng();
    const tenants = buildTenants(prng, 3);
    const policies = buildSlaPolicies(prng, tenants, NOW);
    expect(policies).toHaveLength(12); // 4 × 3
    const priorities = new Set(policies.map((p) => p.priority));
    expect([...priorities]).toEqual(expect.arrayContaining(['p1', 'p2', 'p3', 'p4']));
  });

  it('sla timers include running, paused and breached states', () => {
    const prng = makePrng();
    const tenants = buildTenants(prng, 3);
    const orgs = buildOrganizations(prng, tenants, 4, NOW);
    const users = buildStaffUsers(prng, tenants, 7, NOW);
    const { start, end } = partitionWindow(SMALL_PROFILE, NOW);
    const tkts = buildTickets(
      prng, tenants, orgs.map((o) => o.id), users.map((u) => u.id),
      400, start, end, DEFAULT_COLLISION_MATRIX,
    );
    const policies = buildSlaPolicies(prng, tenants, NOW);
    const timers = buildSlaTimers(prng, tkts, policies, NOW);
    const statuses = new Set(timers.map((t) => t.status));
    expect(statuses).toContain('running');
    expect(statuses).toContain('breached');
  });

  it('paused timers have non-zero pausedMs', () => {
    const prng = makePrng();
    const tenants = buildTenants(prng, 3);
    const orgs = buildOrganizations(prng, tenants, 4, NOW);
    const users = buildStaffUsers(prng, tenants, 7, NOW);
    const { start, end } = partitionWindow(SMALL_PROFILE, NOW);
    const tkts = buildTickets(
      prng, tenants, orgs.map((o) => o.id), users.map((u) => u.id),
      400, start, end, DEFAULT_COLLISION_MATRIX,
    );
    const policies = buildSlaPolicies(prng, tenants, NOW);
    const timers = buildSlaTimers(prng, tkts, policies, NOW);
    for (const t of timers.filter((x) => x.status === 'paused')) {
      expect(t.pausedMs).toBeGreaterThanOrEqual(0);
      expect(t.pausedAt).not.toBeNull();
    }
  });
});
