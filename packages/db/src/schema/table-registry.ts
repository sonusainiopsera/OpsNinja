/**
 * Table registry — single source of truth for which tables exist in the
 * OpsNinja schema and what security / access properties they carry.
 *
 * All RLS policies, grant matrices, and compliance tests are generated from
 * this registry so a newly-added table cannot be forgotten.
 *
 * Fields:
 *   name            — SQL table name (as it appears in pg_class)
 *   tenantScoped    — true if the table has a tenant_id column and requires
 *                     RLS tenant-isolation policies
 *   portalVisible   — true if portal principals (app.principal_kind = 'portal')
 *                     have any restricted visibility policy on this table;
 *                     false means portal users have NO access (table is hidden)
 *   portalPolicy    — name of the AS RESTRICTIVE portal policy, if any
 *   appUserGrants   — DML verbs granted to the app_user / opsninja_app role;
 *                     audit_logs intentionally excludes UPDATE and DELETE
 *   notes           — human-readable rationale
 */

export interface TableEntry {
  readonly name: string;
  readonly tenantScoped: boolean;
  readonly portalVisible: boolean;
  readonly portalPolicy?: string;
  readonly appUserGrants: ReadonlyArray<'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'>;
  readonly notes?: string;
}

/**
 * Canonical table registry. Order: foundation tables first, then identity,
 * then RBAC catalog, then tickets, then operational.
 *
 * Global/reference tables (tenants, roles, permissions, role_permissions) are
 * listed with tenantScoped: false. They require no RLS but are included here
 * for completeness and grants assertions.
 */
export const TABLE_REGISTRY: ReadonlyArray<TableEntry> = [
  // -------------------------------------------------------------------------
  // Global / reference tables — no RLS required
  // -------------------------------------------------------------------------
  {
    name: 'tenants',
    tenantScoped: false,
    portalVisible: false,
    appUserGrants: ['SELECT'],
    notes: 'Global table. app_user reads tenants for plan-tier checks; no cross-tenant risk.',
  },
  {
    name: 'roles',
    tenantScoped: false,
    portalVisible: false,
    appUserGrants: ['SELECT'],
    notes: 'RBAC catalog — global reference data, no tenant_id.',
  },
  {
    name: 'permissions',
    tenantScoped: false,
    portalVisible: false,
    appUserGrants: ['SELECT'],
    notes: 'RBAC catalog — global reference data.',
  },
  {
    name: 'role_permissions',
    tenantScoped: false,
    portalVisible: false,
    appUserGrants: ['SELECT'],
    notes: 'RBAC join table — global reference data.',
  },

  // -------------------------------------------------------------------------
  // Tenant-scoped foundation tables (0001_foundation.sql)
  // -------------------------------------------------------------------------
  {
    name: 'organizations',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE'],
    notes: 'Portal does not have direct org read access (accessed via ticket association).',
  },
  {
    name: 'organization_verified_domains',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    notes: 'Managed by tenant admins via the API; no portal access.',
  },
  {
    name: 'custom_field_defs',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    notes: 'Admin-only configuration; no portal access.',
  },
  {
    name: 'categories',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  },

  // -------------------------------------------------------------------------
  // Tickets (partitioned, 0001_foundation.sql)
  // -------------------------------------------------------------------------
  {
    name: 'tickets',
    tenantScoped: true,
    portalVisible: true,
    portalPolicy: 'portal_org_restriction',
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE'],
    notes: 'Portal principals see only tickets in their allowed org set (RESTRICTIVE policy).',
  },
  {
    name: 'ticket_comments',
    tenantScoped: true,
    portalVisible: true,
    portalPolicy: 'portal_comment_restriction',
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE'],
    notes: 'Portal principals see only visibility=public comments (RESTRICTIVE policy).',
  },

  // -------------------------------------------------------------------------
  // Audit (partitioned, 0001_foundation.sql + 0092 enrichment)
  // -------------------------------------------------------------------------
  {
    name: 'audit_logs',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT'],
    notes: 'Append-only: UPDATE and DELETE are intentionally excluded from grants and blocked by trigger.',
  },

  // -------------------------------------------------------------------------
  // Outbox (0001_foundation.sql / WO-007)
  // -------------------------------------------------------------------------
  {
    name: 'outbox_events',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE'],
    notes: 'Message relay; UPDATE is needed to mark events as dispatched.',
  },

  // -------------------------------------------------------------------------
  // Identity (0009_identity_rls.sql)
  // -------------------------------------------------------------------------
  {
    name: 'users',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE'],
  },
  {
    name: 'customer_contacts',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE'],
  },
  {
    name: 'role_assignments',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  },
  {
    name: 'agent_org_scopes',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'DELETE'],
  },
  {
    name: 'user_roles',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'DELETE'],
  },
  {
    name: 'refresh_sessions',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE'],
  },
  {
    name: 'email_verification_tokens',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE'],
    notes: 'NULL tenant_id allowed for pre-signup tokens; see RLS policy for NULL handling.',
  },
  {
    name: 'pending_user_approvals',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    notes: 'NULL tenant_id allowed; see RLS policy.',
  },

  // -------------------------------------------------------------------------
  // AI synthesis (WO-060)
  // -------------------------------------------------------------------------
  {
    name: 'ticket_ai_summaries',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
    notes: 'AI-generated summaries; not exposed to portal.',
  },
  {
    name: 'ticket_affected_areas',
    tenantScoped: true,
    portalVisible: false,
    appUserGrants: ['SELECT', 'INSERT', 'UPDATE', 'DELETE'],
  },
] as const;

/** All tables that require RLS tenant isolation. */
export const TENANT_SCOPED_TABLES: ReadonlyArray<TableEntry> = TABLE_REGISTRY.filter(
  (t) => t.tenantScoped,
);

/** Tables that have a portal-specific RESTRICTIVE policy. */
export const PORTAL_POLICY_TABLES: ReadonlyArray<TableEntry> = TABLE_REGISTRY.filter(
  (t) => t.portalVisible && t.portalPolicy !== undefined,
);
