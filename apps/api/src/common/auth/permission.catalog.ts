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
  // org:deactivate covers both deactivate and reactivate lifecycle transitions
  | 'org:manage_fields'
  // org:manage_fields: create/update/archive custom field definitions
  | 'org:domain_manage'
  // org:domain_manage: register/verify/revoke organization email domains
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
  | 'report:run'
  | 'report:manage'
  | 'report:export'
  // ── Jira integration ─────────────────────────────────────────────────────
  | 'jira:read'
  | 'jira:manage'
  // ── Tenant administration ─────────────────────────────────────────────────
  | 'admin:manage_tenant'
  | 'admin:revoke_sessions'
  | 'admin:unlock_auth'
  // ── Webhooks ──────────────────────────────────────────────────────────────
  | 'webhook:read'
  | 'webhook:manage'
  // ── Organization scope management ────────────────────────────────────────
  | 'org:manage_scopes'
  // ── Saved views ──────────────────────────────────────────────────────────
  | 'view:read'
  | 'view:create'
  | 'view:update'
  | 'view:delete'
  | 'view:share'
  // ── Audit log query (WO-096) ─────────────────────────────────────────────
  | 'audit:read'
  | 'audit:export'
  | 'audit:verify'
  // ── Privacy / subject requests (WO-096) ──────────────────────────────────
  | 'privacy:manage'
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
  'org:read', 'org:create', 'org:update', 'org:deactivate', 'org:manage_fields', 'org:domain_manage',
  'user:read', 'user:create', 'user:update', 'user:deactivate', 'user:set_org_scope',
  'sla:read', 'sla:manage',
  'report:read', 'report:export',
  'jira:read', 'jira:manage',
  'admin:manage_tenant', 'admin:revoke_sessions', 'admin:unlock_auth',
  'webhook:read', 'webhook:manage',
  'org:manage_scopes',
  'view:read', 'view:create', 'view:update', 'view:delete', 'view:share',
  'audit:read', 'audit:export', 'audit:verify',
  'privacy:manage',
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
    'org:read', 'org:create', 'org:update', 'org:deactivate', 'org:manage_fields', 'org:domain_manage',
    'org:manage_scopes',
    'user:read', 'user:create', 'user:update', 'user:set_org_scope',
    'sla:read', 'sla:manage',
    'report:read', 'report:export',
    'jira:read',
    'admin:revoke_sessions',
    'view:read', 'view:create', 'view:update', 'view:delete', 'view:share',
  ],

  agent: [
    'ticket:read', 'ticket:create', 'ticket:update', 'ticket:close',
    'ticket:reassign', 'ticket:view_internal_notes', 'ticket:add_internal_note',
    'org:read',
    'user:read',
    'sla:read',
    'report:read',
    'jira:read',
    'view:read', 'view:create', 'view:update', 'view:delete',
  ],

  lead_analyst: [
    'ticket:read',
    'org:read',
    'sla:read',
    'report:read', 'report:export',
    'jira:read',
    'view:read',
    'audit:read', 'audit:export', 'audit:verify',
    'privacy:manage',
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
