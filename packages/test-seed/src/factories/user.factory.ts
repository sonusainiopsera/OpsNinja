/**
 * User factory — pure functional, no DB access.
 *
 * Generates staff users with allowed synthetic email addresses.
 * Email domains are restricted to the anonymisation allow-list:
 *   example.com, example.org, test.invalid
 */

import type { NewUser } from '@opsninja/db';
import { SeededRandom } from '../prng';
import { COLLISION_MATRIX } from '../collision-matrix';

export const ALLOWED_EMAIL_DOMAINS = [
  'example.com',
  'example.org',
  'test.invalid',
] as const;

export const PRINCIPAL_KINDS = ['staff', 'portal', 'machine'] as const;
export const STAFF_ROLES = [
  'support_agent',
  'senior_agent',
  'team_lead',
  'admin',
  'read_only',
] as const;

export interface UserSeed {
  id: string;
  tenantId: string;
  email: string;
  role: (typeof STAFF_ROLES)[number];
  record: NewUser;
}

export function buildUsers(
  rng: SeededRandom,
  tenantId: string,
  count: number,
  now: Date,
): UserSeed[] {
  const users: UserSeed[] = [];
  const sharedLocalParts = COLLISION_MATRIX.sharedEmailLocalParts;
  const domain = ALLOWED_EMAIL_DOMAINS[0]!;

  for (let i = 0; i < count; i++) {
    const r = rng.child(i + 200);
    const id = r.uuid();

    // First N users get shared local-parts (cross-tenant collision testing)
    const localPart = i < sharedLocalParts.length
      ? sharedLocalParts[i]!
      : `user${i + 1}`;
    const email = `${localPart}@${domain}`;
    const role = rng.pick(STAFF_ROLES);

    users.push({
      id,
      tenantId,
      email,
      role,
      record: {
        id,
        tenantId,
        email,
        principalKind: 'staff',
        active: rng.nextBool(0.95),
        createdAt: new Date(now.getTime() - rng.nextInt(365) * 24 * 60 * 60 * 1000),
        updatedAt: now,
      },
    });
  }

  return users;
}
