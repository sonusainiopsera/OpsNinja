/**
 * Drizzle schema for jira_project_mappings — WO-052.
 *
 * One row per scoped mapping: a specific Jira project within a connection.
 * field_map, status_map and sync_rules are JSONB columns validated at write
 * time by the Zod schema in jira-mapping.schema.ts.
 *
 * Unique partial index enforces exactly one is_default mapping per connection.
 */

import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const jiraProjectMappings = pgTable(
  'jira_project_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    /** Jira project key, e.g. 'PLAT' or 'OPS'. */
    projectKey: text('project_key').notNull(),
    /** Jira project numeric id (for API calls). */
    projectId: text('project_id').notNull(),
    /** Default issue type id for new issues created in this project. */
    defaultIssueTypeId: text('default_issue_type_id').notNull(),
    /**
     * Array of { source, target: { fieldId, schemaType }, transform? }.
     * source is allow-listed; validated by Zod at write time.
     */
    fieldMap: jsonb('field_map').notNull().default([]),
    /**
     * Array of { jiraStatusId?, jiraStatusCategory?, opsninjaStatus }.
     * Maps inbound Jira status changes to OpsNinja statuses.
     */
    statusMap: jsonb('status_map').notNull().default([]),
    /**
     * { applyInboundStatus, applyInboundComments, autoResolveOnJiraDone, commentVisibility }.
     */
    syncRules: jsonb('sync_rules').notNull().default('{}'),
    /** True for the one canonical default mapping per connection. */
    isDefault: boolean('is_default').notNull().default(false),
    /** False mappings are never used by the resolver — admin can disable without deleting. */
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('jira_project_mappings_tenant_id_idx').on(t.tenantId),
    connectionIdx: index('jira_project_mappings_connection_id_idx').on(t.connectionId),
    tenantConnectionIdx: index('jira_project_mappings_tenant_connection_idx').on(t.tenantId, t.connectionId),
    // Exactly one default per connection — unique partial index on is_default=true
    uniqueDefaultIdx: uniqueIndex('jira_project_mappings_unique_default_idx')
      .on(t.connectionId)
      .where(sql`is_default = true`),
  }),
);

export type JiraProjectMapping = typeof jiraProjectMappings.$inferSelect;
export type NewJiraProjectMapping = typeof jiraProjectMappings.$inferInsert;

// ---------------------------------------------------------------------------
// JSONB document types (mirrors Zod schema in jira-mapping.schema.ts)
// ---------------------------------------------------------------------------

/** Allow-listed OpsNinja source attributes for outbound field mapping. */
export type MappingSource =
  | 'ticket.title'
  | 'ticket.description'
  | 'ticket.priority'
  | 'ticket.category_path'
  | 'ticket.organization_name'
  | 'ticket.url'
  | 'static';

export type MappingTransform = 'priority_to_jira' | 'status_to_jira' | 'none' | undefined;

export interface FieldMapEntry {
  source: MappingSource;
  /** Static value — only used when source is 'static'. */
  staticValue?: string;
  target: {
    fieldId: string;
    schemaType: string;
  };
  transform?: MappingTransform;
}

export interface StatusMapEntry {
  /** Either jiraStatusId or jiraStatusCategory must be set. */
  jiraStatusId?: string;
  jiraStatusCategory?: string;
  opsninjaStatus: string;
}

export interface SyncRules {
  applyInboundStatus: boolean;
  applyInboundComments: boolean;
  autoResolveOnJiraDone: boolean;
  commentVisibility: 'public' | 'internal';
}
