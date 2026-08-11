/**
 * Tenant factory — pure functional, no DB access.
 * Returns plain typed objects conforming to the Drizzle schema.
 */

import type { NewTenant } from '@opsninja/db';
import { SeededRandom } from '../prng';
import { SEED_TENANT_SLUGS } from '../collision-matrix';

const TENANT_NAMES: Record<(typeof SEED_TENANT_SLUGS)[number], string> = {
  'alpha-corp': 'Alpha Corporation',
  'beta-inc': 'Beta Industries',
  'gamma-llc': 'Gamma LLC',
};

export interface TenantSeed {
  id: string;
  slug: (typeof SEED_TENANT_SLUGS)[number];
  record: NewTenant;
}

export function buildTenants(rng: SeededRandom, now: Date): TenantSeed[] {
  return SEED_TENANT_SLUGS.map((slug, i) => {
    const r = rng.child(i + 1);
    const id = r.uuid();
    return {
      id,
      slug,
      record: {
        id,
        name: TENANT_NAMES[slug],
        slug,
        active: true,
        createdAt: new Date(now.getTime() - i * 30 * 24 * 60 * 60 * 1000),
        updatedAt: now,
      },
    };
  });
}
