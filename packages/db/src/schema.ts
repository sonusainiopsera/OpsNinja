/**
 * Drizzle ORM schema definitions for OpsNinja.
 *
 * Every table carries tenant_id so that PostgreSQL RLS policies can enforce
 * row-level isolation via the app.current_tenant session variable set by the
 * tenant-context interceptor.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Organizations (customers)
// ---------------------------------------------------------------------------

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    tier: text('tier').notNull().default('standard'),
    active: boolean('active').notNull().default(true),
    customFields: jsonb('custom_fields').default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('organizations_tenant_id_idx').on(t.tenantId),
  }),
);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    email: text('email').notNull(),
    principalKind: text('principal_kind').notNull().default('staff'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('users_tenant_id_idx').on(t.tenantId),
    emailIdx: index('users_email_idx').on(t.email),
  }),
);

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  'tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('open'),
    priority: text('priority').notNull().default('P3'),
    assigneeId: uuid('assignee_id').references(() => users.id),
    /** AI-generated summary; null until processed. Gated by per-tenant portalAiSummaryEnabled. */
    aiSummary: text('ai_summary'),
    /** Structured tags from AI affected-area analysis; agent-only metadata. */
    affectedAreaTags: jsonb('affected_area_tags'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdx: index('tickets_tenant_id_idx').on(t.tenantId),
    orgIdx: index('tickets_organization_id_idx').on(t.organizationId),
    statusIdx: index('tickets_status_idx').on(t.tenantId, t.status),
  }),
);

// ---------------------------------------------------------------------------
// Ticket comments
// ---------------------------------------------------------------------------

export const ticketComments = pgTable(
  'ticket_comments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    /** Denormalised from the parent ticket for efficient portal visibility predicates. */
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    authorId: uuid('author_id').references(() => users.id),
    body: text('body').notNull(),
    /** 'public' — visible to portal users; 'internal' — agents/staff only. */
    visibility: text('visibility').notNull().default('public'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ticket_comments_tenant_id_idx').on(t.tenantId),
    ticketIdx: index('ticket_comments_ticket_id_idx').on(t.ticketId),
    visibilityIdx: index('ticket_comments_visibility_idx').on(t.ticketId, t.visibility),
  }),
);

export type TicketComment = typeof ticketComments.$inferSelect;
export type NewTicketComment = typeof ticketComments.$inferInsert;

// ---------------------------------------------------------------------------
// Ticket attachments
// ---------------------------------------------------------------------------

export const ticketAttachments = pgTable(
  'ticket_attachments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id),
    /** Nullable — an attachment may belong to a standalone comment or be ticket-level. */
    commentId: uuid('comment_id').references(() => ticketComments.id),
    /** Denormalised for portal visibility check without a join. */
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    /** S3 object key; never exposed directly in responses. */
    s3Key: text('s3_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('ticket_attachments_tenant_id_idx').on(t.tenantId),
    ticketIdx: index('ticket_attachments_ticket_id_idx').on(t.ticketId),
    commentIdx: index('ticket_attachments_comment_id_idx').on(t.commentId),
  }),
);

export type TicketAttachment = typeof ticketAttachments.$inferSelect;
export type NewTicketAttachment = typeof ticketAttachments.$inferInsert;

// ---------------------------------------------------------------------------
// Tenant settings
// ---------------------------------------------------------------------------

export const tenantSettings = pgTable('tenant_settings', {
  tenantId: uuid('tenant_id').primaryKey().references(() => tenants.id),
  /**
   * When true, AI-generated summaries are included in portal ticket responses.
   * Defaults to false — closed-by-default, must be explicitly enabled per tenant.
   */
  portalAiSummaryEnabled: boolean('portal_ai_summary_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenantSettings = typeof tenantSettings.$inferSelect;
export type NewTenantSettings = typeof tenantSettings.$inferInsert;

// ---------------------------------------------------------------------------
// Refresh sessions (auth audit table)
//
// Hot path: Redis is the authoritative store for live session data.
// This table exists solely for audit retention (1-year policy) and
// administrator-initiated revocation tooling.
// ---------------------------------------------------------------------------

export const refreshSessions = pgTable(
  'refresh_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    familyId: uuid('family_id').notNull(),
    /** Last 8 hex chars of the token hash — for debugging only, not secret. */
    tokenHashPreview: text('token_hash_preview'),
    rotationCounter: integer('rotation_counter').notNull().default(0),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastRotatedAt: timestamp('last_rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    tenantIdx: index('refresh_sessions_tenant_id_idx').on(t.tenantId),
    userIdx: index('refresh_sessions_user_id_idx').on(t.userId),
    familyIdx: index('refresh_sessions_family_id_idx').on(t.familyId),
  }),
);

export type RefreshSession = typeof refreshSessions.$inferSelect;
export type NewRefreshSession = typeof refreshSessions.$inferInsert;

// ---------------------------------------------------------------------------
// Audit log (append-only, cross-cutting security events)
//
// Written by the auth guard BEFORE a tenant transaction is open, so this table
// does NOT carry a FK to tenants — actor/tenant fields use text so pre-auth
// failures (token missing, token invalid) can be recorded with null values.
// No RLS policy: this table is managed by the app role directly.
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Nullable — unknown for pre-authentication failures. */
    tenantId: text('tenant_id'),
    /** Nullable — unknown for token-missing errors. */
    actorId: text('actor_id'),
    actorKind: text('actor_kind'),
    /** Dot-namespaced type: 'auth.token_missing' | 'authz.permission_denied' | etc. */
    eventType: text('event_type').notNull(),
    outcome: text('outcome').notNull(),
    requiredPermission: text('required_permission'),
    route: text('route'),
    ipAddress: text('ip_address'),
    traceId: text('trace_id').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // ── Mutation audit columns (added in 0003_audit_mutation_columns.sql) ──────
    /** Type of resource being mutated (e.g. 'ticket', 'ticket_comment'). */
    resourceType: text('resource_type'),
    /** UUID or identifier of the specific resource instance. */
    resourceId: text('resource_id'),
    /** Action performed: create | update | delete | deactivate | assign | transition. */
    action: text('action'),
    /** Redacted JSON snapshot of the resource before mutation. */
    beforeState: jsonb('before_state'),
    /** Redacted JSON snapshot of the resource after mutation. */
    afterState: jsonb('after_state'),
    /** Dotted-path keys that changed (e.g. ['status', 'custom_fields.cloud_provider']). */
    changedFields: text('changed_fields').array(),
    /** Source worker label for non-HTTP origins (e.g. 'jira-sync-worker'). */
    source: text('source'),
    /** SHA-256 idempotency key for worker retries — unique partial index ensures dedup. */
    idempotencyKey: text('idempotency_key'),
    /** HTTP or SQS correlation / request ID. */
    requestId: text('request_id'),
    /** SHA-256 of the client IP address (never stored raw). */
    ipHash: text('ip_hash'),
    /** Truncated User-Agent string (max 512 chars). */
    userAgent: text('user_agent'),
  },
  (t) => ({
    tenantCreatedIdx: index('audit_logs_tenant_created_idx').on(t.tenantId, t.createdAt),
    traceIdx: index('audit_logs_trace_id_idx').on(t.traceId),
    resourceIdx: index('audit_logs_resource_idx').on(t.tenantId, t.resourceType, t.resourceId),
  }),
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

// ---------------------------------------------------------------------------
// Schema type exports
// ---------------------------------------------------------------------------

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;

// ---------------------------------------------------------------------------
// Agent organization scopes
//
// Maps a staff user (agent/manager) to the set of customer organizations they
// are permitted to access within a tenant. Scope mutations bump scope_version,
// which is carried in access tokens and checked per-request to invalidate
// stale cached scope sets.
// ---------------------------------------------------------------------------

export const agentOrgScopes = pgTable(
  'agent_org_scopes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id),
    /** Level of access granted — 'full' by default; future: 'read_only'. */
    accessLevel: text('access_level').notNull().default('full'),
    /** Monotonic counter bumped on every scope mutation. Mirrored in Redis. */
    scopeVersion: integer('scope_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantUserIdx: index('agent_org_scopes_tenant_user_idx').on(t.tenantId, t.userId),
    tenantUserOrgUniq: uniqueIndex('agent_org_scopes_tenant_user_org_uniq').on(
      t.tenantId,
      t.userId,
      t.organizationId,
    ),
  }),
);

export type AgentOrgScope = typeof agentOrgScopes.$inferSelect;
export type NewAgentOrgScope = typeof agentOrgScopes.$inferInsert;

// ---------------------------------------------------------------------------
// Notifications (notification_templates, notifications, notification_suppressions)
// ---------------------------------------------------------------------------

export {
  notificationTemplates,
  notifications,
  notificationSuppressions,
} from './schema/notifications';

export type {
  NotificationTemplate,
  NewNotificationTemplate,
  NotificationStatus,
  Notification,
  NewNotification,
  SuppressionReason,
  NotificationSuppression,
  NewNotificationSuppression,
} from './schema/notifications';

// ---------------------------------------------------------------------------
// Webhooks (webhook_endpoints)
// ---------------------------------------------------------------------------

export { webhookEndpoints } from './schema/webhooks';

export type {
  WebhookEndpoint,
  NewWebhookEndpoint,
  WebhookEndpointStatus,
} from './schema/webhooks';

// ---------------------------------------------------------------------------
// Organization registry (WO-023)
//
// Extended organizations + customer_accounts, contacts,
// organization_verified_domains, custom_field_defs.
// ---------------------------------------------------------------------------

export {
  organizationsRegistry,
  customerAccounts,
  contacts,
  organizationVerifiedDomains,
  customFieldDefs,
} from './schema/organizations-registry';

export type {
  OrganizationRegistry,
  NewOrganizationRegistry,
  CustomerAccount,
  NewCustomerAccount,
  Contact,
  NewContact,
  OrganizationVerifiedDomain,
  NewOrganizationVerifiedDomain,
  CustomFieldDef,
  NewCustomFieldDef,
} from './schema/organizations-registry';
