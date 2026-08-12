/**
 * resource-matrix.ts — Declarative resource matrix for isolation testing.
 *
 * Every tenant-scoped REST resource is declared here with:
 *   - group:           resource group (must match REQUIRED_RESOURCE_GROUPS)
 *   - method:          HTTP method
 *   - pathTemplate:    route path with :param placeholders
 *   - minRole:         minimum staff role to call the route
 *   - scopeDimension:  isolation layer under test
 *   - expectedActions: which negative-path assertions to generate
 *
 * A completeness test in rest-cross-tenant.spec.ts asserts that every entry
 * in REQUIRED_RESOURCE_GROUPS has at least one matrix row. Adding a new route
 * without adding it to this file fails that assertion.
 *
 * WO-098 AC2, AC3, AC10.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/**
 * Scope dimension under test:
 *   tenant - RLS-level tenant isolation (cross-tenant 404)
 *   org    - org-scope predicate (out-of-scope org 404)
 *   role   - RBAC guard (insufficient role 403)
 *   portal - portal principal exclusion (portal 403/404)
 */
export type ScopeDimension = 'tenant' | 'org' | 'role' | 'portal';

/** Which negative-path test variants to generate for this row. */
export type TestAction =
  | 'cross_tenant_404'    // Authenticate as tenant-A, request tenant-B identifier → 404
  | 'insufficient_role_403' // Have role below minRole on in-scope resource → 403
  | 'out_of_scope_404'    // Agent's org_scope excludes the ticket's org → 404
  | 'portal_forbidden';   // Portal principal attempts a staff-only route → 403/404

export interface ResourceMatrixEntry {
  /** Human-readable resource group — used for coverage reporting. */
  group: string;
  method: HttpMethod;
  pathTemplate: string;
  /** Minimum staff role required (e.g. 'agent', 'manager', 'admin'). */
  minRole: string;
  scopeDimension: ScopeDimension;
  expectedActions: TestAction[];
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

export const RESOURCE_MATRIX: ResourceMatrixEntry[] = [
  // ── Organizations ─────────────────────────────────────────────────────────
  {
    group: 'organizations',
    method: 'GET',
    pathTemplate: '/api/v1/organizations/:id',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },
  {
    group: 'organizations',
    method: 'PATCH',
    pathTemplate: '/api/v1/organizations/:id',
    minRole: 'admin',
    scopeDimension: 'role',
    expectedActions: ['cross_tenant_404', 'insufficient_role_403'],
  },
  {
    group: 'organizations',
    method: 'POST',
    pathTemplate: '/api/v1/organizations/:id/deactivate',
    minRole: 'admin',
    scopeDimension: 'role',
    expectedActions: ['cross_tenant_404', 'insufficient_role_403'],
  },

  // ── Contacts ──────────────────────────────────────────────────────────────
  {
    group: 'contacts',
    method: 'GET',
    pathTemplate: '/api/v1/contacts/:id',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },
  {
    group: 'contacts',
    method: 'PATCH',
    pathTemplate: '/api/v1/contacts/:id',
    minRole: 'agent',
    scopeDimension: 'org',
    expectedActions: ['cross_tenant_404', 'out_of_scope_404'],
  },

  // ── Tickets ───────────────────────────────────────────────────────────────
  {
    group: 'tickets',
    method: 'GET',
    pathTemplate: '/api/v1/tickets/:id',
    minRole: 'agent',
    scopeDimension: 'org',
    expectedActions: ['cross_tenant_404', 'out_of_scope_404'],
  },
  {
    group: 'tickets',
    method: 'PATCH',
    pathTemplate: '/api/v1/tickets/:id',
    minRole: 'agent',
    scopeDimension: 'org',
    expectedActions: ['cross_tenant_404', 'out_of_scope_404'],
  },
  {
    group: 'tickets',
    method: 'POST',
    pathTemplate: '/api/v1/tickets/:id/reassign',
    minRole: 'manager',
    scopeDimension: 'role',
    expectedActions: ['cross_tenant_404', 'insufficient_role_403'],
  },

  // ── Comments ──────────────────────────────────────────────────────────────
  {
    group: 'comments',
    method: 'GET',
    pathTemplate: '/api/v1/tickets/:id/comments',
    minRole: 'agent',
    scopeDimension: 'org',
    expectedActions: ['cross_tenant_404', 'out_of_scope_404', 'portal_forbidden'],
  },
  {
    group: 'comments',
    method: 'POST',
    pathTemplate: '/api/v1/tickets/:id/comments',
    minRole: 'agent',
    scopeDimension: 'org',
    expectedActions: ['cross_tenant_404', 'portal_forbidden'],
  },

  // ── Attachments ───────────────────────────────────────────────────────────
  {
    group: 'attachments',
    method: 'POST',
    pathTemplate: '/api/v1/tickets/:id/attachments/presign',
    minRole: 'agent',
    scopeDimension: 'org',
    expectedActions: ['cross_tenant_404'],
  },
  {
    group: 'attachments',
    method: 'GET',
    pathTemplate: '/api/v1/attachments/:id/download',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },

  // ── Saved Views ───────────────────────────────────────────────────────────
  {
    group: 'saved_views',
    method: 'GET',
    pathTemplate: '/api/v1/views',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },
  {
    group: 'saved_views',
    method: 'POST',
    pathTemplate: '/api/v1/views',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },
  {
    group: 'saved_views',
    method: 'PATCH',
    pathTemplate: '/api/v1/views/:id',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },
  {
    group: 'saved_views',
    method: 'DELETE',
    pathTemplate: '/api/v1/views/:id',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },

  // ── SLA Policies ──────────────────────────────────────────────────────────
  {
    group: 'sla_policies',
    method: 'GET',
    pathTemplate: '/api/v1/sla-policies/:id',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },
  {
    group: 'sla_policies',
    method: 'PATCH',
    pathTemplate: '/api/v1/sla-policies/:id',
    minRole: 'admin',
    scopeDimension: 'role',
    expectedActions: ['cross_tenant_404', 'insufficient_role_403'],
  },

  // ── Jira Connections ──────────────────────────────────────────────────────
  {
    group: 'jira_connections',
    method: 'GET',
    pathTemplate: '/api/v1/jira/connections',
    minRole: 'admin',
    scopeDimension: 'role',
    expectedActions: ['insufficient_role_403'],
  },
  {
    group: 'jira_connections',
    method: 'PATCH',
    pathTemplate: '/api/v1/jira/connections/:id',
    minRole: 'admin',
    scopeDimension: 'role',
    expectedActions: ['cross_tenant_404', 'insufficient_role_403'],
  },

  // ── Jira Links ────────────────────────────────────────────────────────────
  {
    group: 'jira_links',
    method: 'GET',
    pathTemplate: '/api/v1/tickets/:id/jira-links',
    minRole: 'agent',
    scopeDimension: 'org',
    expectedActions: ['cross_tenant_404', 'out_of_scope_404'],
  },
  {
    group: 'jira_links',
    method: 'POST',
    pathTemplate: '/api/v1/tickets/:id/jira-links',
    minRole: 'agent',
    scopeDimension: 'org',
    expectedActions: ['cross_tenant_404', 'out_of_scope_404'],
  },
  {
    group: 'jira_links',
    method: 'DELETE',
    pathTemplate: '/api/v1/tickets/:id/jira-links/:linkId',
    minRole: 'agent',
    scopeDimension: 'org',
    expectedActions: ['cross_tenant_404', 'out_of_scope_404'],
  },

  // ── Webhook Subscriptions ─────────────────────────────────────────────────
  {
    group: 'webhook_subscriptions',
    method: 'GET',
    pathTemplate: '/api/v1/webhooks/endpoints',
    minRole: 'admin',
    scopeDimension: 'role',
    expectedActions: ['insufficient_role_403'],
  },
  {
    group: 'webhook_subscriptions',
    method: 'POST',
    pathTemplate: '/api/v1/webhooks/endpoints',
    minRole: 'admin',
    scopeDimension: 'role',
    expectedActions: ['insufficient_role_403'],
  },
  {
    group: 'webhook_subscriptions',
    method: 'DELETE',
    pathTemplate: '/api/v1/webhooks/endpoints/:id',
    minRole: 'admin',
    scopeDimension: 'role',
    expectedActions: ['cross_tenant_404', 'insufficient_role_403'],
  },

  // ── Report Definitions ────────────────────────────────────────────────────
  {
    group: 'report_definitions',
    method: 'GET',
    pathTemplate: '/api/v1/reports',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },
  {
    group: 'report_definitions',
    method: 'POST',
    pathTemplate: '/api/v1/reports/run',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },
  {
    group: 'report_definitions',
    method: 'PATCH',
    pathTemplate: '/api/v1/reports/:id',
    minRole: 'manager',
    scopeDimension: 'role',
    expectedActions: ['cross_tenant_404', 'insufficient_role_403'],
  },
  {
    group: 'report_definitions',
    method: 'DELETE',
    pathTemplate: '/api/v1/reports/:id',
    minRole: 'manager',
    scopeDimension: 'role',
    expectedActions: ['cross_tenant_404', 'insufficient_role_403'],
  },

  // ── Export Jobs ───────────────────────────────────────────────────────────
  {
    group: 'export_jobs',
    method: 'POST',
    pathTemplate: '/api/v1/exports',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },
  {
    group: 'export_jobs',
    method: 'GET',
    pathTemplate: '/api/v1/exports/:id',
    minRole: 'agent',
    scopeDimension: 'tenant',
    expectedActions: ['cross_tenant_404'],
  },

  // ── Audit Logs ────────────────────────────────────────────────────────────
  {
    group: 'audit_logs',
    method: 'GET',
    pathTemplate: '/api/v1/audit-logs',
    minRole: 'admin',
    scopeDimension: 'role',
    expectedActions: ['insufficient_role_403'],
  },

  // ── AI Summaries ──────────────────────────────────────────────────────────
  {
    group: 'ai_summaries',
    method: 'GET',
    pathTemplate: '/api/v1/tickets/:id/ai-summary',
    minRole: 'agent',
    scopeDimension: 'org',
    expectedActions: ['cross_tenant_404', 'out_of_scope_404', 'portal_forbidden'],
  },
  {
    group: 'ai_summaries',
    method: 'PATCH',
    pathTemplate: '/api/v1/tickets/:id/ai-summary',
    minRole: 'manager',
    scopeDimension: 'role',
    expectedActions: ['cross_tenant_404', 'insufficient_role_403'],
  },
  {
    group: 'ai_summaries',
    method: 'POST',
    pathTemplate: '/api/v1/tickets/:id/ai-summary/regenerate',
    minRole: 'manager',
    scopeDimension: 'role',
    expectedActions: ['cross_tenant_404', 'insufficient_role_403'],
  },
];

// ---------------------------------------------------------------------------
// Completeness enforcement
// ---------------------------------------------------------------------------

/**
 * Every group in this list MUST have at least one entry in RESOURCE_MATRIX.
 * Adding a new resource group to this list (and forgetting the matrix row)
 * fails the completeness test in rest-cross-tenant.spec.ts.
 *
 * WO-098 AC2: covers organizations, contacts, tickets, comments, attachments,
 * saved_views, sla_policies, jira_connections, jira_links,
 * webhook_subscriptions, report_definitions, export_jobs, audit_logs.
 */
export const REQUIRED_RESOURCE_GROUPS = [
  'organizations',
  'contacts',
  'tickets',
  'comments',
  'attachments',
  'saved_views',
  'sla_policies',
  'jira_connections',
  'jira_links',
  'webhook_subscriptions',
  'report_definitions',
  'export_jobs',
  'audit_logs',
  'ai_summaries',
] as const;

export type ResourceGroup = typeof REQUIRED_RESOURCE_GROUPS[number];
