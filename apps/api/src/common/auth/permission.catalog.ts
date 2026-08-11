/**
 * OpsNinja permission catalogue.
 *
 * Single source of truth for all permission strings. @RequirePermission is
 * typed against this union so a typo produces a TypeScript compile error
 * rather than a silent authorization hole.
 *
 * Convention: domain:action, where action follows read < create < update < close < delete.
 * Permissions are additive — the user receives the union of all role permissions.
 * There are no negative (deny) grants.
 */

export type Permission =
  // ── Tickets ──────────────────────────────────────────────────────────────
  | 'ticket:read'
  | 'ticket:create'
  | 'ticket:update'
  | 'ticket:close'
  | 'ticket:reassign'
  | 'ticket:delete'
  | 'ticket:view_internal_notes'
  | 'ticket:add_internal_note'
  // ── Organizations (customers) ─────────────────────────────────────────────
  | 'org:read'
  | 'org:create'
  | 'org:update'
  | 'org:deactivate'
  // ── Users & scope management ─────────────────────────────────────────────
  | 'user:read'
  | 'user:create'
  | 'user:update'
  | 'user:deactivate'
  | 'user:set_org_scope'
  // ── SLA policies ─────────────────────────────────────────────────────────
  | 'sla:read'
  | 'sla:manage'
  // ── Reports ──────────────────────────────────────────────────────────────
  | 'report:read'
  | 'report:export'
  // ── Jira integration ─────────────────────────────────────────────────────
  | 'jira:read'
  | 'jira:manage'
  // ── Tenant administration ─────────────────────────────────────────────────
  | 'admin:manage_tenant'
  | 'admin:revoke_sessions'
  // ── Webhooks ──────────────────────────────────────────────────────────────
  | 'webhook:read'
  | 'webhook:manage'
  // ── Machine / worker ─────────────────────────────────────────────────────
  | 'machine:jira_sync'
  | 'machine:notification_send'
  | 'machine:export';

/**
 * Complete set of all permissions — used to build the admin role.
 */
export const ALL_PERMISSIONS: readonly Permission[] = [
  'ticket:read', 'ticket:create', 'ticket:update', 'ticket:close',
  'ticket:reassign', 'ticket:delete', 'ticket:view_internal_notes', 'ticket:add_internal_note',
  'org:read', 'org:create', 'org:update', 'org:deactivate',
  'user:read', 'user:create', 'user:update', 'user:deactivate', 'user:set_org_scope',
  'sla:read', 'sla:manage',
  'report:read', 'report:export',
  'jira:read', 'jira:manage',
  'admin:manage_tenant', 'admin:revoke_sessions',
  'webhook:read', 'webhook:manage',
  'machine:jira_sync', 'machine:notification_send', 'machine:export',
];

/**
 * Role-to-permission mapping.
 *
 * Used by PermissionResolverService as its authoritative source (Postgres fallback).
 * When the role-permissions table (WOREF-009) is implemented, this constant becomes
 * seed/default data and the service reads from DB first.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  admin: ALL_PERMISSIONS,

  manager: [
    'ticket:read', 'ticket:create', 'ticket:update', 'ticket:close',
    'ticket:reassign', 'ticket:view_internal_notes', 'ticket:add_internal_note',
    'org:read', 'org:create', 'org:update',
    'user:read', 'user:create', 'user:update', 'user:set_org_scope',
    'sla:read', 'sla:manage',
    'report:read', 'report:export',
    'jira:read',
    'admin:revoke_sessions',
  ],

  agent: [
    'ticket:read', 'ticket:create', 'ticket:update', 'ticket:close',
    'ticket:reassign', 'ticket:view_internal_notes', 'ticket:add_internal_note',
    'org:read',
    'user:read',
    'sla:read',
    'report:read',
    'jira:read',
  ],

  lead_analyst: [
    'ticket:read',
    'org:read',
    'sla:read',
    'report:read', 'report:export',
    'jira:read',
  ],

  integration_admin: [
    'ticket:read',
    'org:read',
    'user:read',
    'jira:read', 'jira:manage',
    'webhook:read', 'webhook:manage',
  ],

  portal_user: [
    'ticket:read',
    'ticket:create',
  ],

  machine: [
    'ticket:read', 'ticket:update',
    'machine:jira_sync', 'machine:notification_send', 'machine:export',
  ],
};

/**
 * Permissions that are reserved for machine (worker) principals.
 * A non-machine token presenting these permissions receives AUTHZ_AUDIENCE_MISMATCH.
 */
export const MACHINE_PERMISSIONS = new Set<Permission>([
  'machine:jira_sync',
  'machine:notification_send',
  'machine:export',
]);
