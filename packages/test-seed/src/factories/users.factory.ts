/**
 * Pure factory for staff users and portal contacts.
 * All email addresses use reserved example domains — no PII.
 */

import type { SeededPrng } from '../prng';
import type { SeedTenant } from './organizations.factory';
import type { CollisionMatrix } from '../collision-matrix';

export interface SeedUser {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
}

export interface SeedContact {
  id: string;
  tenantId: string;
  organizationId: string;
  email: string;
  firstName: string;
  lastName: string;
  isVerified: boolean;
  createdAt: Date;
}

export type UserRole =
  | 'support_admin'
  | 'agent'
  | 'manager'
  | 'analyst'
  | 'integration_admin';

const ROLES: UserRole[] = ['support_admin', 'agent', 'manager', 'analyst', 'integration_admin'];
const ROLE_DIST = [1, 5, 1, 1, 1]; // weights per role

const FIRST_NAMES = ['Alex', 'Blake', 'Casey', 'Dana', 'Ellis', 'Finley', 'Gray', 'Harper', 'Indie', 'Jordan'];
const LAST_NAMES = ['Morgan', 'Taylor', 'Rivera', 'Chen', 'Patel', 'Kim', 'Okafor', 'Müller', 'Santos', 'Singh'];

function weightedRole(prng: SeededPrng): UserRole {
  const total = ROLE_DIST.reduce((a, b) => a + b, 0);
  let rand = prng.int(0, total);
  for (let i = 0; i < ROLES.length; i++) {
    rand -= ROLE_DIST[i];
    if (rand < 0) return ROLES[i];
  }
  return 'agent';
}

export function buildStaffUsers(
  prng: SeededPrng,
  tenants: SeedTenant[],
  staffPerTenant: number,
  now: Date,
): SeedUser[] {
  const users: SeedUser[] = [];
  for (const tenant of tenants) {
    // Ensure at least one of each role.
    for (let i = 0; i < staffPerTenant; i++) {
      const firstName = prng.pick(FIRST_NAMES);
      const lastName = prng.pick(LAST_NAMES);
      const localPart = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i > 0 ? i : ''}`;
      const email = `${localPart}@${tenant.slug}.example.com`;
      const createdAt = new Date(now);
      createdAt.setMonth(createdAt.getMonth() - prng.int(1, 13));
      users.push({
        id: prng.uuid(),
        tenantId: tenant.id,
        email,
        firstName,
        lastName,
        role: i < ROLES.length ? ROLES[i] : weightedRole(prng),
        isActive: prng.chance(0.95),
        createdAt,
      });
    }
  }
  return users;
}

export function buildContacts(
  prng: SeededPrng,
  tenants: SeedTenant[],
  orgIds: string[],
  contactsPerOrg: number,
  now: Date,
  collisionMatrix: CollisionMatrix,
): SeedContact[] {
  const contacts: SeedContact[] = [];

  for (let ti = 0; ti < tenants.length; ti++) {
    const tenant = tenants[ti];
    // org IDs belonging to this tenant
    const tenantOrgIds = orgIds.filter((_, idx) => {
      // orgIds is flat: [t0o0,t0o1,...,t1o0,...], orgsPerTenant derived from length
      const orgsPerTenant = orgIds.length / tenants.length;
      return Math.floor(idx / orgsPerTenant) === ti;
    });

    // Collision local-parts for this tenant
    const collisionLocalParts = collisionMatrix.contactEmailLocalParts
      .filter((c) => c.pair.tenantAIndex === ti || c.pair.tenantBIndex === ti)
      .map((c) => c.localPart);

    let collisionIdx = 0;

    for (const orgId of tenantOrgIds) {
      for (let i = 0; i < contactsPerOrg; i++) {
        let localPart: string;
        if (collisionIdx < collisionLocalParts.length) {
          localPart = collisionLocalParts[collisionIdx++];
        } else {
          const firstName = prng.pick(FIRST_NAMES);
          const lastName = prng.pick(LAST_NAMES);
          localPart = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${contacts.length}`;
        }
        const email = `${localPart}@${tenant.slug}.example.com`;
        const firstName = prng.pick(FIRST_NAMES);
        const lastName = prng.pick(LAST_NAMES);
        const createdAt = new Date(now);
        createdAt.setMonth(createdAt.getMonth() - prng.int(0, 12));
        contacts.push({
          id: prng.uuid(),
          tenantId: tenant.id,
          organizationId: orgId,
          email,
          firstName,
          lastName,
          isVerified: prng.chance(0.8),
          createdAt,
        });
      }
    }
  }
  return contacts;
}
