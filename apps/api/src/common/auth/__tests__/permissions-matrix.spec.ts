import { Permission, ROLE_PERMISSION_MAP, TENANT_WIDE_ROLES } from '../permissions';

const ALL_PERMISSIONS = new Set<string>(Object.values(Permission));

describe('ROLE_PERMISSION_MAP', () => {
  const EXPECTED_ROLES = [
    'admin', 'supervisor', 'manager', 'agent', 'lead', 'analyst',
    'readonly', 'portal_user', 'worker', 'integration_admin',
  ];

  it('defines entries for all expected roles', () => {
    for (const role of EXPECTED_ROLES) {
      expect(ROLE_PERMISSION_MAP).toHaveProperty(role);
    }
  });

  it('contains no unknown permission strings', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSION_MAP)) {
      for (const perm of perms) {
        expect(ALL_PERMISSIONS).toContain(perm as string);
        if (!ALL_PERMISSIONS.has(perm as string)) {
          throw new Error(`Role '${role}' has unknown permission '${perm}'`);
        }
      }
    }
  });

  it('admin has all staff permissions', () => {
    const adminPerms = new Set(ROLE_PERMISSION_MAP.admin);
    const staffPerms: string[] = [
      Permission.TICKETS_READ, Permission.TICKETS_WRITE, Permission.TICKETS_DELETE,
      Permission.TICKETS_ASSIGN, Permission.TICKET_REASSIGN,
      Permission.USERS_READ, Permission.USERS_WRITE,
      Permission.ORGS_READ, Permission.ORGS_WRITE, Permission.ORGS_MANAGE_SCOPES,
      Permission.ADMIN_WRITE, Permission.ROLES_WRITE, Permission.TENANT_SETTINGS,
    ];
    for (const p of staffPerms) {
      expect(adminPerms).toContain(p);
    }
  });

  it('supervisor and manager have ORGS_MANAGE_SCOPES', () => {
    expect(ROLE_PERMISSION_MAP.supervisor).toContain(Permission.ORGS_MANAGE_SCOPES);
    expect(ROLE_PERMISSION_MAP.manager).toContain(Permission.ORGS_MANAGE_SCOPES);
  });

  it('agent does NOT have ORGS_MANAGE_SCOPES', () => {
    expect(ROLE_PERMISSION_MAP.agent).not.toContain(Permission.ORGS_MANAGE_SCOPES);
  });

  it('analyst does NOT have write permissions', () => {
    const analystPerms = ROLE_PERMISSION_MAP.analyst;
    expect(analystPerms).not.toContain(Permission.TICKETS_WRITE);
    expect(analystPerms).not.toContain(Permission.USERS_WRITE);
    expect(analystPerms).not.toContain(Permission.ADMIN_WRITE);
  });

  it('portal_user only has portal:* permissions', () => {
    const portalPerms = ROLE_PERMISSION_MAP.portal_user;
    for (const p of portalPerms) {
      expect(p.startsWith('portal:')).toBe(true);
    }
  });

  it('worker only has machine:* permissions', () => {
    const workerPerms = ROLE_PERMISSION_MAP.worker;
    for (const p of workerPerms) {
      expect(p.startsWith('machine:')).toBe(true);
    }
  });
});

describe('TENANT_WIDE_ROLES', () => {
  it('contains admin, supervisor, manager, lead, analyst, readonly', () => {
    for (const role of ['admin', 'supervisor', 'manager', 'lead', 'analyst', 'readonly']) {
      expect(TENANT_WIDE_ROLES.has(role)).toBe(true);
    }
  });

  it('does NOT contain agent or portal_user', () => {
    expect(TENANT_WIDE_ROLES.has('agent')).toBe(false);
    expect(TENANT_WIDE_ROLES.has('portal_user')).toBe(false);
  });
});
