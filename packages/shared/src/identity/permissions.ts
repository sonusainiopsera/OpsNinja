/**
 * Permission catalogue.
 *
 * Canonical permission strings are `resource:action` pairs derived from the
 * RBAC seed. Every permission used in a guard must appear here so the type
 * system catches typos at compile time.
 *
 * Role→permission matrix (authoritative mapping):
 *
 *  support_admin:     all permissions
 *  support_manager:   ticket:*, comment:*, organization:*, user:*, report:*,
 *                     sla:*, category:*
 *  support_lead:      ticket:read|create|update|reassign|resolve,
 *                     comment:*, organization:read|update, user:read,
 *                     report:*, sla:read, category:*
 *  support_agent:     ticket:read|create|update|reassign|resolve,
 *                     comment:*, organization:read, category:read, report:read
 *  integration_admin: ticket:read, comment:read_public, organization:read,
 *                     jira:*, webhook:configure
 *  portal_user:       ticket:read, comment:read_public|write_public,
 *                     organization:read
 */

export const PERMISSIONS = [
  // Tickets
  'ticket:read',
  'ticket:create',
  'ticket:update',
  'ticket:reassign',
  'ticket:resolve',
  'ticket:close',
  'ticket:delete',
  // Comments
  'comment:read_public',
  'comment:read_internal',
  'comment:write_public',
  'comment:write_internal',
  // Organizations
  'organization:read',
  'organization:create',
  'organization:update',
  'organization:deactivate',
  'organization:manage_scopes',
  // Users
  'user:read',
  'user:create',
  'user:update',
  'user:manage_roles',
  'user:deactivate',
  // Reports
  'report:read',
  'report:export',
  // Jira integration
  'jira:configure',
  'jira:read_sync',
  // Webhooks
  'webhook:configure',
  // SLA
  'sla:read',
  'sla:configure',
  // Categories
  'category:read',
  'category:manage',
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number];

/** Canonical role slugs. Must match `roles.name` in the database. */
export const ROLE_NAMES = [
  'support_admin',
  'support_manager',
  'support_lead',
  'support_agent',
  'integration_admin',
  'portal_user',
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/**
 * Authoritative role→permission matrix.
 * Used by the seed script AND by unit tests to verify policy correctness
 * without a live database.
 */
export const ROLE_PERMISSIONS: Record<RoleName, ReadonlyArray<PermissionCode>> = {
  support_admin: PERMISSIONS,

  support_manager: [
    'ticket:read', 'ticket:create', 'ticket:update', 'ticket:reassign',
    'ticket:resolve', 'ticket:close',
    'comment:read_public', 'comment:read_internal',
    'comment:write_public', 'comment:write_internal',
    'organization:read', 'organization:create', 'organization:update',
    'organization:deactivate', 'organization:manage_scopes',
    'user:read', 'user:create', 'user:update', 'user:manage_roles', 'user:deactivate',
    'report:read', 'report:export',
    'sla:read', 'sla:configure',
    'category:read', 'category:manage',
  ],

  support_lead: [
    'ticket:read', 'ticket:create', 'ticket:update', 'ticket:reassign', 'ticket:resolve',
    'comment:read_public', 'comment:read_internal',
    'comment:write_public', 'comment:write_internal',
    'organization:read', 'organization:update',
    'user:read',
    'report:read', 'report:export',
    'sla:read',
    'category:read', 'category:manage',
  ],

  support_agent: [
    'ticket:read', 'ticket:create', 'ticket:update', 'ticket:reassign', 'ticket:resolve',
    'comment:read_public', 'comment:read_internal',
    'comment:write_public', 'comment:write_internal',
    'organization:read',
    'category:read',
    'report:read',
  ],

  integration_admin: [
    'ticket:read',
    'comment:read_public',
    'organization:read',
    'jira:configure', 'jira:read_sync',
    'webhook:configure',
  ],

  portal_user: [
    'ticket:read',
    'comment:read_public', 'comment:write_public',
    'organization:read',
  ],
};

/** True when the given role has the given permission. */
export function roleHasPermission(role: RoleName, permission: PermissionCode): boolean {
  return (ROLE_PERMISSIONS[role] as ReadonlyArray<string>).includes(permission);
}

/** All permissions granted to a user with the given roles (union). */
export function resolvePermissions(roles: RoleName[]): Set<PermissionCode> {
  const result = new Set<PermissionCode>();
  for (const role of roles) {
    for (const perm of ROLE_PERMISSIONS[role]) {
      result.add(perm);
    }
  }
  return result;
}
