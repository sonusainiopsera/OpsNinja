/**
 * Typed permission catalogue for OpsNinja.
 *
 * All permission strings used in @RequirePermission decorators must be drawn
 * from this union so that typos fail at compile time rather than at runtime.
 *
 * Permissions are grouped by audience tier:
 *   - Staff (agents, supervisors, admins): tickets:*, users:*, admin:*, roles:*, tenant:*
 *   - Portal (customer-facing): portal:*
 *   - Machine (worker / integration): machine:*
 */

export const Permission = {
  // ── Ticket operations (staff) ───────────────────────────────────────────
  TICKETS_READ:   'tickets:read',
  TICKETS_WRITE:  'tickets:write',
  TICKETS_DELETE: 'tickets:delete',
  TICKETS_ASSIGN: 'tickets:assign',

  // ── User management (staff) ─────────────────────────────────────────────
  USERS_READ:  'users:read',
  USERS_WRITE: 'users:write',

  // ── Admin / tenant operations (staff) ───────────────────────────────────
  ADMIN_WRITE:     'admin:write',
  ROLES_WRITE:     'roles:write',
  TENANT_SETTINGS: 'tenant:settings',

  // ── Portal (customer-facing) ─────────────────────────────────────────────
  PORTAL_TICKETS_READ:  'portal:tickets:read',
  PORTAL_TICKETS_WRITE: 'portal:tickets:write',

  // ── Machine (worker / integration) ──────────────────────────────────────
  MACHINE_SYNC:    'machine:sync',
  MACHINE_WEBHOOK: 'machine:webhook',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/**
 * Default role → permission mapping.
 *
 * This is the authoritative source until a role_permissions table is populated
 * by a later work order.  PermissionResolverService uses this as its Postgres
 * fallback when the DB returns an empty result.
 */
export const ROLE_PERMISSION_MAP: Record<string, Permission[]> = {
  admin: [
    Permission.TICKETS_READ,
    Permission.TICKETS_WRITE,
    Permission.TICKETS_DELETE,
    Permission.TICKETS_ASSIGN,
    Permission.USERS_READ,
    Permission.USERS_WRITE,
    Permission.ADMIN_WRITE,
    Permission.ROLES_WRITE,
    Permission.TENANT_SETTINGS,
  ],
  supervisor: [
    Permission.TICKETS_READ,
    Permission.TICKETS_WRITE,
    Permission.TICKETS_DELETE,
    Permission.TICKETS_ASSIGN,
    Permission.USERS_READ,
    Permission.USERS_WRITE,
  ],
  agent: [
    Permission.TICKETS_READ,
    Permission.TICKETS_WRITE,
    Permission.TICKETS_ASSIGN,
    Permission.USERS_READ,
  ],
  readonly: [
    Permission.TICKETS_READ,
    Permission.USERS_READ,
  ],
  portal_user: [
    Permission.PORTAL_TICKETS_READ,
    Permission.PORTAL_TICKETS_WRITE,
  ],
  worker: [
    Permission.MACHINE_SYNC,
    Permission.MACHINE_WEBHOOK,
  ],
};
