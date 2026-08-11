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
  TICKETS_READ:     'tickets:read',
  TICKETS_WRITE:    'tickets:write',
  TICKETS_DELETE:   'tickets:delete',
  TICKETS_ASSIGN:   'tickets:assign',
  TICKET_REASSIGN:  'tickets:reassign',

  // ── User management (staff) ─────────────────────────────────────────────
  USERS_READ:  'users:read',
  USERS_WRITE: 'users:write',

  // ── Organization management (staff) ─────────────────────────────────────
  ORGS_READ:           'organizations:read',
  ORGS_WRITE:          'organizations:write',
  ORGS_MANAGE_SCOPES:  'organizations:manage_scopes',

  // ── Admin / tenant operations (staff) ───────────────────────────────────
  ADMIN_WRITE:     'admin:write',
  ROLES_WRITE:     'roles:write',
  TENANT_SETTINGS: 'tenant:settings',

  // ── Portal (customer-facing) ─────────────────────────────────────────────
  PORTAL_TICKETS_READ:         'portal:tickets:read',
  PORTAL_TICKETS_WRITE:        'portal:tickets:write',
  PORTAL_ATTACHMENTS_DOWNLOAD: 'portal:attachments:download',

  // ── Machine (worker / integration) ──────────────────────────────────────
  MACHINE_SYNC:    'machine:sync',
  MACHINE_WEBHOOK: 'machine:webhook',

  // ── Integration administration ───────────────────────────────────────────
  WEBHOOKS_MANAGE: 'integrations:webhooks:manage',

  // ── Security administration ──────────────────────────────────────────────
  /** Allows unlocking a throttle-locked email address via POST /admin/auth/unlock. */
  ADMIN_AUTH_UNLOCK: 'admin:auth:unlock',

  // ── Saved views ──────────────────────────────────────────────────────────
  /** Allows creating and editing shared (team-visible) saved views. */
  VIEWS_SHARE: 'views:share',

  // ── SLA management ───────────────────────────────────────────────────────
  /** Allows reading SLA policies and calendars. */
  SLA_POLICY_READ:  'sla_policy:read',
  /** Allows creating, updating and deactivating SLA policies and calendars. */
  SLA_POLICY_WRITE: 'sla_policy:write',

  // ── Jira integration management ──────────────────────────────────────────
  /** Allows connecting, testing, and revoking Jira integrations. */
  JIRA_MANAGE: 'integrations:jira:manage',
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
  // ── Administrator (tenant-wide) ─────────────────────────────────────────
  admin: [
    Permission.TICKETS_READ,
    Permission.TICKETS_WRITE,
    Permission.TICKETS_DELETE,
    Permission.TICKETS_ASSIGN,
    Permission.TICKET_REASSIGN,
    Permission.USERS_READ,
    Permission.USERS_WRITE,
    Permission.ORGS_READ,
    Permission.ORGS_WRITE,
    Permission.ORGS_MANAGE_SCOPES,
    Permission.ADMIN_WRITE,
    Permission.ROLES_WRITE,
    Permission.TENANT_SETTINGS,
    Permission.WEBHOOKS_MANAGE,
    Permission.JIRA_MANAGE,
    Permission.ADMIN_AUTH_UNLOCK,
    Permission.VIEWS_SHARE,
    Permission.SLA_POLICY_READ,
    Permission.SLA_POLICY_WRITE,
  ],
  // ── Manager / Supervisor (can manage agent scopes) ──────────────────────
  supervisor: [
    Permission.TICKETS_READ,
    Permission.TICKETS_WRITE,
    Permission.TICKETS_DELETE,
    Permission.TICKETS_ASSIGN,
    Permission.TICKET_REASSIGN,
    Permission.USERS_READ,
    Permission.USERS_WRITE,
    Permission.ORGS_READ,
    Permission.ORGS_WRITE,
    Permission.ORGS_MANAGE_SCOPES,
    Permission.VIEWS_SHARE,
    Permission.SLA_POLICY_READ,
    Permission.SLA_POLICY_WRITE,
  ],
  manager: [
    Permission.TICKETS_READ,
    Permission.TICKETS_WRITE,
    Permission.TICKETS_DELETE,
    Permission.TICKETS_ASSIGN,
    Permission.TICKET_REASSIGN,
    Permission.USERS_READ,
    Permission.USERS_WRITE,
    Permission.ORGS_READ,
    Permission.ORGS_WRITE,
    Permission.ORGS_MANAGE_SCOPES,
    Permission.VIEWS_SHARE,
    Permission.SLA_POLICY_READ,
    Permission.SLA_POLICY_WRITE,
  ],
  // ── Agent (scoped to assigned organizations) ────────────────────────────
  agent: [
    Permission.TICKETS_READ,
    Permission.TICKETS_WRITE,
    Permission.TICKETS_ASSIGN,
    Permission.USERS_READ,
    Permission.ORGS_READ,
    Permission.SLA_POLICY_READ,
  ],
  // ── Lead / Analyst (tenant-wide read + some writes) ─────────────────────
  lead: [
    Permission.TICKETS_READ,
    Permission.TICKETS_WRITE,
    Permission.TICKETS_ASSIGN,
    Permission.TICKET_REASSIGN,
    Permission.USERS_READ,
    Permission.ORGS_READ,
  ],
  analyst: [
    Permission.TICKETS_READ,
    Permission.USERS_READ,
    Permission.ORGS_READ,
  ],
  readonly: [
    Permission.TICKETS_READ,
    Permission.USERS_READ,
    Permission.ORGS_READ,
  ],
  // ── Portal user (customer-facing, scoped to own organization) ───────────
  portal_user: [
    Permission.PORTAL_TICKETS_READ,
    Permission.PORTAL_TICKETS_WRITE,
    Permission.PORTAL_ATTACHMENTS_DOWNLOAD,
  ],
  // ── Machine principals ───────────────────────────────────────────────────
  worker: [
    Permission.MACHINE_SYNC,
    Permission.MACHINE_WEBHOOK,
  ],
  // ── Integration administrator ────────────────────────────────────────────
  integration_admin: [
    Permission.WEBHOOKS_MANAGE,
    Permission.JIRA_MANAGE,
    Permission.ORGS_READ,
  ],
};

/**
 * Roles that have tenant-wide scope (no org restriction predicate applied).
 * Agents NOT in this set are scoped to their assigned organizations via
 * OrgScopeService.
 */
export const TENANT_WIDE_ROLES = new Set<string>([
  'admin',
  'supervisor',
  'manager',
  'lead',
  'analyst',
  'readonly',
  'worker',
  'integration_admin',
]);
