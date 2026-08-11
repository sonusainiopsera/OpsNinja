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
// Tickets module (WO-031)
//
// Full schema definitions moved to schema/tickets.ts, schema/ticket-comments.ts,
// schema/ticket-attachments.ts, schema/tags.ts, schema/assignment-groups.ts,
// schema/ticket-status-history.ts. Re-exported here so @opsninja/db consumers
// get the extended column set with a single import.
// ---------------------------------------------------------------------------

export {
  tickets,
  type Ticket,
  type NewTicket,
  type TicketStatus,
  type TicketPriority,
} from './schema/tickets';

export {
  ticketComments,
  type TicketComment,
  type NewTicketComment,
} from './schema/ticket-comments';

export {
  ticketAttachments,
  type TicketAttachment,
  type NewTicketAttachment,
} from './schema/ticket-attachments';

export {
  tags,
  type Tag,
  type NewTag,
  ticketTags,
  type TicketTag,
  type NewTicketTag,
} from './schema/tags';

export {
  assignmentGroups,
  type AssignmentGroup,
  type NewAssignmentGroup,
  assignmentGroupMembers,
  type AssignmentGroupMember,
  type NewAssignmentGroupMember,
} from './schema/assignment-groups';

export {
  ticketStatusHistory,
  type TicketStatusHistory,
  type NewTicketStatusHistory,
  tenantSequences,
  type TenantSequence,
  type NewTenantSequence,
} from './schema/ticket-status-history';

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

// ---------------------------------------------------------------------------
// Webhook deliveries (WO-084)
//
// webhook_deliveries: partitioned delivery attempt log for auditable history
// and replay support. Monthly range partitioning on created_at.
// ---------------------------------------------------------------------------

export { webhookDeliveries } from './schema/webhook-deliveries';

export type {
  WebhookDelivery,
  NewWebhookDelivery,
  WebhookDeliveryStatus,
} from './schema/webhook-deliveries';

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
  outboxEvents,
} from './schema/organizations-registry';

export type {
  OrganizationRegistry,
  NewOrganizationRegistry,
  CustomerAccount,
  NewCustomerAccount,
  Contact,
  NewContact,
  ContactStatus,
  OrganizationVerifiedDomain,
  NewOrganizationVerifiedDomain,
  CustomFieldDef,
  NewCustomFieldDef,
  OutboxEvent,
  NewOutboxEvent,
} from './schema/organizations-registry';

// ---------------------------------------------------------------------------
// Saved views (WO-039)
//
// saved_views: compiler-validated filter ASTs with scope classification.
// saved_view_pins: per-agent pin state and display order.
// ---------------------------------------------------------------------------

export { savedViews, savedViewPins } from './schema/saved-views';

export type {
  SavedView,
  NewSavedView,
  SavedViewPin,
  NewSavedViewPin,
} from './schema/saved-views';

// ---------------------------------------------------------------------------
// Jira connections (WO-051)
//
// jira_connections: per-tenant Jira Cloud / Data Center connection aggregate.
// Refresh tokens are never stored here; only an opaque secret_ref is held.
// ---------------------------------------------------------------------------

export { jiraConnections } from './schema/jira-connections';

export type {
  JiraConnection,
  NewJiraConnection,
  JiraConnectionState,
  JiraAuthMethod,
} from './schema/jira-connections';

// ---------------------------------------------------------------------------
// SLA module (WO-044)
//
// sla_policies, sla_policy_versions, sla_calendars,
// sla_calendar_windows, sla_calendar_holidays.
// ---------------------------------------------------------------------------

export {
  slaPolicies,
  slaPolicyVersions,
  slaCalendars,
  slaCalendarWindows,
  slaCalendarHolidays,
  slaTimers,
} from './schema/sla';

export type {
  SlaPolicy,
  NewSlaPolicy,
  SlaPolicyVersion,
  NewSlaPolicyVersion,
  SlaCalendar,
  NewSlaCalendar,
  SlaCalendarWindow,
  NewSlaCalendarWindow,
  SlaCalendarHoliday,
  NewSlaCalendarHoliday,
  SlaTimer,
  NewSlaTimer,
} from './schema/sla';

// ---------------------------------------------------------------------------
// Reporting module (WO-073)
//
// report_definitions: validated report definitions with filter ASTs,
//   metric lists, group-by dimensions.
// export_jobs: async CSV/XLSX/PDF export job tracking.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CSAT module (WO-082)
//
// csat_surveys: single-use expiring survey records with hashed tokens.
// Token bootstrap RLS policy allows CsatTokenGuard to resolve tenant from hash.
// ---------------------------------------------------------------------------

export { csatSurveys } from './schema/csat';

export type {
  CsatSurvey,
  NewCsatSurvey,
  CsatResponseSource,
  CsatSummary,
  CsatTokenBootstrap,
  CsatResolvedToken,
} from './schema/csat';

// ---------------------------------------------------------------------------
// Reporting module (WO-073)
//
// report_definitions: validated report definitions with filter ASTs,
//   metric lists, group-by dimensions.
// export_jobs: async CSV/XLSX/PDF export job tracking.
// ---------------------------------------------------------------------------

export { reportDefinitions } from './schema/report-definitions';

export type {
  ReportDefinition,
  NewReportDefinition,
  ReportSharingScope,
} from './schema/report-definitions';

export { exportJobs } from './schema/export-jobs';

export type {
  ExportJob,
  NewExportJob,
  ExportJobFormat,
  ExportJobStatus,
} from './schema/export-jobs';

// ---------------------------------------------------------------------------
// Portal signup and verification (WO-087)
//
// portal_signup_requests: applicant records awaiting email verification
// portal_verification_tokens: single-use HMAC-signed tokens (hash-only)
// portal_users: activated portal contacts bound to tenant + org
// ---------------------------------------------------------------------------

export {
  portalSignupRequests,
  portalVerificationTokens,
  portalUsers,
} from './schema/portal-signup';

export type {
  PortalSignupRequest,
  NewPortalSignupRequest,
  PortalSignupStatus,
  PortalVerificationToken,
  NewPortalVerificationToken,
  PortalUser,
  NewPortalUser,
} from './schema/portal-signup';

// ---------------------------------------------------------------------------
// jira_webhook_events: inbound Jira webhook envelopes (WO-054)
// ---------------------------------------------------------------------------

export { jiraWebhookEvents } from './schema/jira-webhook-events';

export type {
  JiraWebhookEvent,
  NewJiraWebhookEvent,
  WebhookProcessingState,
} from './schema/jira-webhook-events';

// ---------------------------------------------------------------------------
// jira_project_mappings: project scoping and field/status mapping per connection
// ---------------------------------------------------------------------------

export { jiraProjectMappings } from './schema/jira-project-mappings';

export type {
  JiraProjectMapping,
  NewJiraProjectMapping,
  FieldMapEntry,
  StatusMapEntry,
  SyncRules,
  MappingSource,
  MappingTransform,
} from './schema/jira-project-mappings';

// ---------------------------------------------------------------------------
// ticket_jira_links (WO-053)
// ---------------------------------------------------------------------------

export { ticketJiraLinks } from './schema/ticket-jira-links';

export type {
  TicketJiraLink,
  NewTicketJiraLink,
} from './schema/ticket-jira-links';

// ---------------------------------------------------------------------------
// retention_job_runs + erasure_receipts (WO-085)
// ---------------------------------------------------------------------------

export { retentionJobRuns, erasureReceipts } from './schema/retention';

export type {
  RetentionJobRun,
  NewRetentionJobRun,
  RetentionJobOutcome,
  ErasureReceipt,
  NewErasureReceipt,
  ErasureReceiptEntry,
} from './schema/retention';

// ---------------------------------------------------------------------------
// subject_requests: GDPR data-subject rights lifecycle (WO-096)
// ---------------------------------------------------------------------------

export { subjectRequests } from './schema/subject-requests';

export type {
  SubjectRequest,
  NewSubjectRequest,
  SubjectRequestType,
  SubjectRequestStatus,
} from './schema/subject-requests';
export {
  reportSchedules,
  reportScheduleOccurrences,
  externalRecipientAllowlist,
} from './schema/report-schedules';
export type {
  ReportSchedule,
  NewReportSchedule,
  ReportScheduleCadence,
  ReportScheduleFormat,
  ScheduleRecipient,
  ReportScheduleOccurrence,
  NewReportScheduleOccurrence,
  OccurrenceStatus,
  ExternalRecipientAllowlistEntry,
  NewExternalRecipientAllowlistEntry,
} from './schema/report-schedules';

// ---------------------------------------------------------------------------
// jira_sync_dlq: dead-letter projection for exhausted outbound sync (WO-056)
// ---------------------------------------------------------------------------

export { jiraSyncDlq } from './schema/jira-sync-dlq';
export type { JiraSyncDlqItem, NewJiraSyncDlqItem } from './schema/jira-sync-dlq';
