import { describe, it, expect } from 'vitest';
import {
  PERMISSIONS,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
  roleHasPermission,
  resolvePermissions,
  type PermissionCode,
  type RoleName,
} from '../permissions.js';

describe('PERMISSIONS catalogue', () => {
  it('contains no duplicate codes', () => {
    const seen = new Set<string>();
    for (const p of PERMISSIONS) {
      expect(seen.has(p), `duplicate permission: ${p}`).toBe(false);
      seen.add(p);
    }
  });

  it('all codes follow resource:action format', () => {
    for (const p of PERMISSIONS) {
      expect(p).toMatch(/^[a-z_]+:[a-z_]+$/);
    }
  });
});

describe('ROLE_PERMISSIONS matrix', () => {
  it('covers all canonical roles', () => {
    for (const role of ROLE_NAMES) {
      expect(ROLE_PERMISSIONS).toHaveProperty(role);
    }
  });

  it('support_admin has every permission', () => {
    const adminPerms = new Set(ROLE_PERMISSIONS.support_admin);
    for (const p of PERMISSIONS) {
      expect(adminPerms.has(p), `support_admin missing: ${p}`).toBe(true);
    }
  });

  it('portal_user has only the expected subset', () => {
    const portalPerms = new Set(ROLE_PERMISSIONS.portal_user);
    expect(portalPerms.has('ticket:read')).toBe(true);
    expect(portalPerms.has('comment:read_public')).toBe(true);
    expect(portalPerms.has('comment:write_public')).toBe(true);
    expect(portalPerms.has('organization:read')).toBe(true);
    // portal_user must NOT have internal or destructive permissions
    expect(portalPerms.has('comment:read_internal')).toBe(false);
    expect(portalPerms.has('ticket:delete')).toBe(false);
    expect(portalPerms.has('user:manage_roles')).toBe(false);
    expect(portalPerms.has('jira:configure')).toBe(false);
  });

  it('integration_admin has jira and webhook but not user management', () => {
    const intAdminPerms = new Set(ROLE_PERMISSIONS.integration_admin);
    expect(intAdminPerms.has('jira:configure')).toBe(true);
    expect(intAdminPerms.has('jira:read_sync')).toBe(true);
    expect(intAdminPerms.has('webhook:configure')).toBe(true);
    expect(intAdminPerms.has('user:manage_roles')).toBe(false);
    expect(intAdminPerms.has('ticket:delete')).toBe(false);
  });

  it('support_manager can configure sla but not jira', () => {
    const managerPerms = new Set(ROLE_PERMISSIONS.support_manager);
    expect(managerPerms.has('sla:configure')).toBe(true);
    expect(managerPerms.has('jira:configure')).toBe(false);
  });

  it('support_lead can export reports but cannot manage roles', () => {
    const leadPerms = new Set(ROLE_PERMISSIONS.support_lead);
    expect(leadPerms.has('report:export')).toBe(true);
    expect(leadPerms.has('user:manage_roles')).toBe(false);
  });

  it('all permission codes in matrix are in the PERMISSIONS catalogue', () => {
    const catalogue = new Set<string>(PERMISSIONS);
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const p of perms) {
        expect(catalogue.has(p), `${role} has unknown permission: ${p}`).toBe(true);
      }
    }
  });
});

describe('roleHasPermission()', () => {
  it('returns true for a permission the role owns', () => {
    expect(roleHasPermission('support_agent', 'ticket:read')).toBe(true);
  });

  it('returns false for a permission the role lacks', () => {
    expect(roleHasPermission('support_agent', 'ticket:delete')).toBe(false);
  });

  it('support_admin has every permission', () => {
    for (const p of PERMISSIONS) {
      expect(roleHasPermission('support_admin', p)).toBe(true);
    }
  });
});

describe('resolvePermissions()', () => {
  it('returns empty set for empty role list', () => {
    const perms = resolvePermissions([]);
    expect(perms.size).toBe(0);
  });

  it('unions permissions across multiple roles', () => {
    const perms = resolvePermissions(['support_agent', 'integration_admin']);
    // From agent
    expect(perms.has('ticket:create')).toBe(true);
    // From integration_admin
    expect(perms.has('jira:configure')).toBe(true);
    // Neither role has this
    expect(perms.has('ticket:delete')).toBe(false);
  });

  it('agent with admin role gets all permissions', () => {
    const perms = resolvePermissions(['support_agent', 'support_admin']);
    expect(perms.size).toBe(PERMISSIONS.length);
  });

  it('returns a new set on each call (no shared state)', () => {
    const a = resolvePermissions(['support_agent']);
    const b = resolvePermissions(['support_agent']);
    a.add('ticket:delete' as PermissionCode);
    expect(b.has('ticket:delete' as PermissionCode)).toBe(false);
  });
});

describe('org scope builder helper', () => {
  it('resolvePermissions handles portal_user correctly', () => {
    const perms = resolvePermissions(['portal_user']);
    expect(perms.has('ticket:read')).toBe(true);
    expect(perms.has('comment:write_internal')).toBe(false);
  });
});
