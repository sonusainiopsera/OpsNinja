/**
 * Pure factory for organizations and tenants.
 * No database access — returns plain typed objects.
 */

import type { SeededPrng } from '../prng';

export interface SeedTenant {
  id: string;
  slug: string;
  name: string;
}

export interface SeedOrganization {
  id: string;
  tenantId: string;
  name: string;
  domain: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Deterministic slugs for the first N tenants (beyond 3 are generated).
const TENANT_SLUGS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa'];

const ORG_NAME_PARTS = [
  ['Apex', 'Nova', 'Stellar', 'Prime', 'Vertex', 'Summit', 'Cascade', 'Horizon', 'Zenith', 'Aurora'],
  ['Systems', 'Technologies', 'Solutions', 'Dynamics', 'Analytics', 'Platforms', 'Networks', 'Ventures', 'Labs', 'Group'],
];

export function buildTenants(prng: SeededPrng, count: number): SeedTenant[] {
  return Array.from({ length: count }, (_, i) => {
    const slug = TENANT_SLUGS[i] ?? `tenant-${i + 1}`;
    const id = prng.uuid();
    return {
      id,
      slug,
      name: `Tenant ${slug.charAt(0).toUpperCase() + slug.slice(1)}`,
    };
  });
}

export function buildOrganizations(
  prng: SeededPrng,
  tenants: SeedTenant[],
  orgsPerTenant: number,
  now: Date,
): SeedOrganization[] {
  const orgs: SeedOrganization[] = [];
  for (const tenant of tenants) {
    for (let i = 0; i < orgsPerTenant; i++) {
      const namePart1 = prng.pick(ORG_NAME_PARTS[0]);
      const namePart2 = prng.pick(ORG_NAME_PARTS[1]);
      const name = `${namePart1} ${namePart2}`;
      // reserved domain so no PII leakage
      const domain = `${namePart1.toLowerCase()}-${namePart2.toLowerCase()}.example.com`;
      const createdAt = new Date(now);
      createdAt.setMonth(createdAt.getMonth() - prng.int(1, 14));
      orgs.push({
        id: prng.uuid(),
        tenantId: tenant.id,
        name,
        domain,
        isActive: prng.chance(0.9),
        createdAt,
        updatedAt: new Date(createdAt.getTime() + prng.int(0, 30) * 86_400_000),
      });
    }
  }
  return orgs;
}
