/**
 * resource-matrix.ts — WO-098: Declarative resource matrix for the cross-tenant
 * isolation suite.
 *
 * Each entry describes a single tenant-scoped API resource and provides:
 *   - The HTTP method and path template
 *   - The minimum required role
 *   - The scope dimension (tenant | org | portal | admin)
 *   - How to substitute a foreign-tenant resource ID to produce the cross-tenant path
 *   - The expected HTTP status code for a cross-tenant attempt (almost always 404)
 *   - The expected status for an insufficient-role attempt (403)
 *
 * A "completeness gate" test reflects over the running NestJS application's
 * router, filters to tenant-scoped paths, and asserts every route appears in
 * this matrix. Any unmapped route fails the build rather than escaping coverage.
 *
 * Adding a new route:
 *   1. Add an entry here.
 *   2. The generated test in rest-cross-tenant.spec.ts picks it up automatically.
 *   3. If the new route legitimately needs a different status code, use the
 *      overrideStatus field and add a justification.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScopeDimension = 'tenant' | 'org' | 'portal' | 'admin' | 'system';
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** A single cross-tenant test variant (one method + path combination). */
export interface MatrixEntry {
  /** Human-readable label used in test output. */
  label: string;
  /** HTTP method. */
  method: HttpMethod;
  /**
   * Path with placeholders.
   * Placeholders: :tenantATicketId, :tenantAOrgId, :tenantACommentId,
   *               :tenantAAttachmentId, :tenantAViewId, :tenantAContactId,
   *               :tenantAJiraConnectionId, :tenantAJiraLinkId,
   *               :tenantAWebhookId, :tenantAUserId, :tenantASlaPolicyId
   */
  pathTemplate: string;
  /** Minimum role required to call this endpoint at all. */
  minimumRole: string;
  /** Isolation scope dimension. */
  scope: ScopeDimension;
  /**
   * Expected status code when Tenant B calls with a Tenant A resource ID.
   * Default 404 (existence non-disclosure).
   */
  crossTenantStatus?: number;
  /**
   * Expected status code when a principal with insufficient role (but correct tenant)
   * calls this endpoint. Default 403.
   */
  insufficientRoleStatus?: number;
  /** Optional request body for POST/PATCH methods. */
  body?: Record<string, unknown>;
  /** Justification for any non-standard status code. */
  justification?: string;
  /** Skip integration run (offline only). */
  skipIntegration?: boolean;
}

// ---------------------------------------------------------------------------
// Placeholder IDs — injected at test runtime from tenant-factory.ts
// ---------------------------------------------------------------------------

export interface ResourceIds {
  tenantATicketId:           string;
  tenantAOrgId:              string;
  tenantACommentId:          string;
  tenantAAttachmentId:       string;
  tenantAViewId:             string;
  tenantAContactId:          string;
  tenantAJiraConnectionId:   string;
  tenantAJiraLinkId:         string;
  tenantAWebhookId:          string;
  tenantAUserId:             string;
  tenantASlaPolicyId:        string;
}

export function applyIds(template: string, ids: ResourceIds): string {
  return template
    .replace(':tenantATicketId',          ids.tenantATicketId)
    .replace(':tenantAOrgId',             ids.tenantAOrgId)
    .replace(':tenantACommentId',         ids.tenantACommentId)
    .replace(':tenantAAttachmentId',      ids.tenantAAttachmentId)
    .replace(':tenantAViewId',            ids.tenantAViewId)
    .replace(':tenantAContactId',         ids.tenantAContactId)
    .replace(':tenantAJiraConnectionId',  ids.tenantAJiraConnectionId)
    .replace(':tenantAJiraLinkId',        ids.tenantAJiraLinkId)
    .replace(':tenantAWebhookId',         ids.tenantAWebhookId)
    .replace(':tenantAUserId',            ids.tenantAUserId)
    .replace(':tenantASlaPolicyId',       ids.tenantASlaPolicyId);
}

// ---------------------------------------------------------------------------
// Resource Matrix
// ---------------------------------------------------------------------------

export const RESOURCE_MATRIX: MatrixEntry[] = [
  // ── Tickets ──────────────────────────────────────────────────────────────

  {
    label:       'GET ticket by id',
    method:      'GET',
    pathTemplate: '/api/v1/tickets/:tenantATicketId',
    minimumRole: 'agent',
    scope:       'org',
    crossTenantStatus: 404,
  },
  {
    label:       'PATCH ticket',
    method:      'PATCH',
    pathTemplate: '/api/v1/tickets/:tenantATicketId',
    minimumRole: 'agent',
    scope:       'org',
    crossTenantStatus: 404,
    body:        { subject: 'x-tenant attempt', version: 1 },
  },
  {
    label:       'POST ticket resolve',
    method:      'POST',
    pathTemplate: '/api/v1/tickets/:tenantATicketId/resolve',
    minimumRole: 'manager',
    scope:       'org',
    crossTenantStatus: 404,
    body:        { version: 1, resolutionNote: 'x-tenant attempt' },
    insufficientRoleStatus: 403,
  },

  // ── Comments ─────────────────────────────────────────────────────────────

  {
    label:       'GET comments for ticket',
    method:      'GET',
    pathTemplate: '/api/v1/tickets/:tenantATicketId/comments',
    minimumRole: 'agent',
    scope:       'org',
    crossTenantStatus: 404,
  },
  {
    label:       'POST comment on ticket',
    method:      'POST',
    pathTemplate: '/api/v1/tickets/:tenantATicketId/comments',
    minimumRole: 'agent',
    scope:       'org',
    crossTenantStatus: 404,
    body:        { body: 'x-tenant comment', visibility: 'public' },
  },

  // ── Attachments ───────────────────────────────────────────────────────────

  {
    label:       'GET attachment download URL',
    method:      'GET',
    pathTemplate: '/api/v1/attachments/:tenantAAttachmentId/download',
    minimumRole: 'agent',
    scope:       'org',
    crossTenantStatus: 404,
  },

  // ── Organizations ─────────────────────────────────────────────────────────

  {
    label:       'GET organization by id',
    method:      'GET',
    pathTemplate: '/api/v1/organizations/:tenantAOrgId',
    minimumRole: 'agent',
    scope:       'org',
    crossTenantStatus: 404,
  },
  {
    label:       'PATCH organization',
    method:      'PATCH',
    pathTemplate: '/api/v1/organizations/:tenantAOrgId',
    minimumRole: 'manager',
    scope:       'org',
    crossTenantStatus: 404,
    body:        { name: 'x-tenant update' },
    insufficientRoleStatus: 403,
  },

  // ── Contacts ──────────────────────────────────────────────────────────────

  {
    label:       'GET contact by id',
    method:      'GET',
    pathTemplate: '/api/v1/organizations/:tenantAOrgId/contacts/:tenantAContactId',
    minimumRole: 'agent',
    scope:       'org',
    crossTenantStatus: 404,
  },

  // ── Saved Views ───────────────────────────────────────────────────────────

  {
    label:       'GET saved view by id',
    method:      'GET',
    pathTemplate: '/api/v1/views/:tenantAViewId',
    minimumRole: 'agent',
    scope:       'tenant',
    crossTenantStatus: 404,
  },
  {
    label:       'PATCH saved view',
    method:      'PATCH',
    pathTemplate: '/api/v1/views/:tenantAViewId',
    minimumRole: 'agent',
    scope:       'tenant',
    crossTenantStatus: 404,
    body:        { name: 'x-tenant view update' },
  },
  {
    label:       'DELETE saved view',
    method:      'DELETE',
    pathTemplate: '/api/v1/views/:tenantAViewId',
    minimumRole: 'agent',
    scope:       'tenant',
    crossTenantStatus: 404,
  },

  // ── SLA Policies ──────────────────────────────────────────────────────────

  {
    label:       'GET SLA policy by id',
    method:      'GET',
    pathTemplate: '/api/v1/sla/policies/:tenantASlaPolicyId',
    minimumRole: 'agent',
    scope:       'tenant',
    crossTenantStatus: 404,
  },
  {
    label:       'PATCH SLA policy',
    method:      'PATCH',
    pathTemplate: '/api/v1/sla/policies/:tenantASlaPolicyId',
    minimumRole: 'admin',
    scope:       'tenant',
    crossTenantStatus: 404,
    insufficientRoleStatus: 403,
    body:        { name: 'x-tenant sla update' },
  },

  // ── Jira Connections ──────────────────────────────────────────────────────

  {
    label:       'GET Jira connection by id',
    method:      'GET',
    pathTemplate: '/api/v1/jira/connections/:tenantAJiraConnectionId',
    minimumRole: 'admin',
    scope:       'tenant',
    crossTenantStatus: 404,
  },
  {
    label:       'DELETE Jira connection',
    method:      'DELETE',
    pathTemplate: '/api/v1/jira/connections/:tenantAJiraConnectionId',
    minimumRole: 'admin',
    scope:       'tenant',
    crossTenantStatus: 404,
    insufficientRoleStatus: 403,
  },

  // ── Jira Links ────────────────────────────────────────────────────────────

  {
    label:       'GET Jira link by id',
    method:      'GET',
    pathTemplate: '/api/v1/jira/links/:tenantAJiraLinkId',
    minimumRole: 'agent',
    scope:       'tenant',
    crossTenantStatus: 404,
  },
  {
    label:       'DELETE Jira link',
    method:      'DELETE',
    pathTemplate: '/api/v1/jira/links/:tenantAJiraLinkId',
    minimumRole: 'agent',
    scope:       'tenant',
    crossTenantStatus: 404,
  },

  // ── Portal: Tickets ───────────────────────────────────────────────────────

  {
    label:       'GET portal ticket by id',
    method:      'GET',
    pathTemplate: '/api/v1/portal/tickets/:tenantATicketId',
    minimumRole: 'portal_user',
    scope:       'portal',
    crossTenantStatus: 404,
  },

  // ── Audit Logs ────────────────────────────────────────────────────────────

  {
    label:       'GET audit logs',
    method:      'GET',
    pathTemplate: '/api/v1/audit',
    minimumRole: 'admin',
    scope:       'tenant',
    crossTenantStatus: 200, // List returns empty, not 404
    justification: 'Audit log list is scoped by tenant predicate; returns empty list for foreign tenant, not 404',
    insufficientRoleStatus: 403,
  },

  // ── Users ────────────────────────────────────────────────────────────────

  {
    label:       'GET user by id',
    method:      'GET',
    pathTemplate: '/api/v1/users/:tenantAUserId',
    minimumRole: 'admin',
    scope:       'tenant',
    crossTenantStatus: 404,
    insufficientRoleStatus: 403,
  },
];

// ---------------------------------------------------------------------------
// Role-insufficiency matrix — roles that must yield 403 on in-scope resources
// ---------------------------------------------------------------------------

export interface RoleInsufficientEntry {
  label:       string;
  method:      HttpMethod;
  pathTemplate: string;
  action:      string;
  insufficientRole: string;
  minimumRole: string;
  body?:       Record<string, unknown>;
}

export const ROLE_INSUFFICIENT_MATRIX: RoleInsufficientEntry[] = [
  {
    label:            'ticket reassign (agent lacks permission)',
    method:           'PATCH',
    pathTemplate:     '/api/v1/tickets/:tenantATicketId',
    action:           'assign ticket to a different user',
    insufficientRole: 'agent',
    minimumRole:      'manager',
    body:             { assignee_user_id: 'f0000002-0000-0000-0000-000000999999', version: 1 },
  },
  {
    label:            'organization deactivate (agent lacks permission)',
    method:           'PATCH',
    pathTemplate:     '/api/v1/organizations/:tenantAOrgId',
    action:           'deactivate organization',
    insufficientRole: 'agent',
    minimumRole:      'manager',
    body:             { status: 'inactive' },
  },
  {
    label:            'custom-field definition write (agent lacks permission)',
    method:           'POST',
    pathTemplate:     '/api/v1/organizations/:tenantAOrgId/custom-field-defs',
    action:           'create custom field definition',
    insufficientRole: 'agent',
    minimumRole:      'admin',
    body:             { key: 'x_test', label: 'X Test', fieldType: 'text' },
  },
  {
    label:            'Jira connection configuration (agent lacks permission)',
    method:           'POST',
    pathTemplate:     '/api/v1/jira/connections',
    action:           'create jira connection',
    insufficientRole: 'agent',
    minimumRole:      'admin',
    body:             { cloudId: 'x', tenantSlug: 'x', projectKey: 'X' },
  },
];

// ---------------------------------------------------------------------------
// All tenant-scoped tables (used by table-level RLS assertions in WO-098)
// Extends the tickets-only list from table-matrix.spec.ts to cover all modules.
// ---------------------------------------------------------------------------

export const ALL_TENANT_SCOPED_TABLES: ReadonlyArray<string> = [
  // Tickets module
  'tickets',
  'ticket_comments',
  'ticket_attachments',
  'ticket_tags',
  'ticket_tag_assignments',
  'ticket_categories',
  'assignment_groups',
  'assignment_group_members',
  'saved_views',
  // Organizations module
  'organizations_registry',
  'contacts',
  'agent_org_scopes',
  'custom_field_defs',
  // Identity module
  'portal_users',
  'portal_onboarding_states',
  'organization_change_requests',
  // Notifications module
  'notification_preferences',
  'notification_templates',
  // Jira module
  'jira_connections',
  'jira_links',
  'jira_webhook_events',
  // Outbox / audit
  'outbox_events',
  'audit_logs',
  // Webhooks
  'webhook_endpoints',
  'webhook_deliveries',
] as const;
