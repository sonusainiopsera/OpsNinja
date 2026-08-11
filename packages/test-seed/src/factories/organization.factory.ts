/**
 * Organization factory — pure functional, no DB access.
 */

import type { NewOrganization } from '@opsninja/db';
import { SeededRandom } from '../prng';
import { COLLISION_MATRIX } from '../collision-matrix';

const TIERS = ['standard', 'premium', 'enterprise'] as const;
const CLOUD_PROVIDERS = ['aws', 'gcp', 'azure', 'on-prem'] as const;
const REGIONS = ['us-east-1', 'eu-west-1', 'ap-southeast-1'] as const;

export interface OrgSeed {
  id: string;
  tenantId: string;
  record: NewOrganization;
}

export function buildOrganizations(
  rng: SeededRandom,
  tenantId: string,
  count: number,
  now: Date,
): OrgSeed[] {
  const orgs: OrgSeed[] = [];

  // First N orgs use shared names from collision matrix
  const sharedNames = COLLISION_MATRIX.sharedOrgNames;

  for (let i = 0; i < count; i++) {
    const r = rng.child(i + 100);
    const id = r.uuid();
    const isShared = i < sharedNames.length;
    const name = isShared
      ? sharedNames[i]!
      : `Org-${i + 1} (${tenantId.substring(0, 6)})`;

    orgs.push({
      id,
      tenantId,
      record: {
        id,
        tenantId,
        name,
        tier: rng.pick(TIERS),
        active: rng.nextBool(0.9),
        customFields: {
          cloud_provider: rng.pick(CLOUD_PROVIDERS),
          region: rng.pick(REGIONS),
          contract_tier: rng.pick(['basic', 'standard', 'gold', 'platinum']),
        },
        createdAt: new Date(now.getTime() - rng.nextInt(365) * 24 * 60 * 60 * 1000),
        updatedAt: now,
      },
    });
  }

  return orgs;
}
