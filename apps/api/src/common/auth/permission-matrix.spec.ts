/**
 * Permission matrix tests — verifies the ROLE_PERMISSIONS map.
 */

import { ALL_PERMISSIONS, ROLE_PERMISSIONS, type Permission } from './permission.catalog';

describe('Permission matrix', () => {
  const allPermSet = new Set<Permission>(ALL_PERMISSIONS);

  it('every permission in ROLE_PERMISSIONS is declared in ALL_PERMISSIONS', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const perm of perms) {
        expect(allPermSet.has(perm as Permission)).toBe(true);
        // Message for failure
        if (!allPermSet.has(perm as Permission)) {
          throw new Error(`Role "${role}" holds undeclared permission "${perm}"`);
        }
      }
    }
  });

  it('covers all required roles', () => {
    const required = ['admin', 'manager', 'agent', 'lead_analyst', 'integration_admin', 'portal_user', 'machine'];
    for (const role of required) {
      expect(ROLE_PERMISSIONS).toHaveProperty(role);
    }
  });

  it('admin holds all permissions', () => {
    const adminPerms = new Set(ROLE_PERMISSIONS['admin']);
    for (const perm of ALL_PERMISSIONS) {
      expect(adminPerms.has(perm)).toBe(true);
    }
  });

  it('manager has org:manage_scopes', () => {
    expect(ROLE_PERMISSIONS['manager']).toContain('org:manage_scopes');
  });

  it('agent does not have org:manage_scopes', () => {
    expect(ROLE_PERMISSIONS['agent']).not.toContain('org:manage_scopes');
  });

  it('portal_user has limited ticket permissions only', () => {
    const portalPerms = new Set(ROLE_PERMISSIONS['portal_user']);
    expect(portalPerms.has('ticket:read')).toBe(true);
    expect(portalPerms.has('ticket:delete')).toBe(false);
    expect(portalPerms.has('org:manage_scopes')).toBe(false);
  });

  it('machine permissions are a subset of ALL_PERMISSIONS', () => {
    const machinePerms = ROLE_PERMISSIONS['machine'] ?? [];
    for (const perm of machinePerms) {
      expect(allPermSet.has(perm as Permission)).toBe(true);
    }
  });
});
