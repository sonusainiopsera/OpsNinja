/**
 * ticket_jira_links schema — WO-053.
 *
 * One row per (tenant_id, ticket_id, project_key) active state.
 * The unique partial index on (tenant_id, ticket_id, project_key) WHERE
 * link_state IN ('pending','linked') prevents duplicate escalations while
 * allowing re-escalation after unlink or failure.
 *
 * RLS enabled and forced with a tenant_isolation policy.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const ticketJiraLinks = pgTable(
  'ticket_jira_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    connectionId: uuid('connection_id').notNull(),
    mappingId: uuid('mapping_id').notNull(),
    /** Jira project key (e.g. 'PLAT'). Denormalised from the mapping for the unique index. */
    projectKey: text('project_key').notNull(),
    /** Jira issue id — null until the worker creates or links the issue. */
    jiraIssueId: text('jira_issue_id'),
    /** Jira issue key (e.g. 'PLAT-42') — null until linked. */
    jiraIssueKey: text('jira_issue_key'),
    /** Deep-link URL to the Jira issue — null until linked. */
    jiraIssueUrl: text('jira_issue_url'),
    /** Latest Jira status label, synced by the worker. */
    jiraStatus: text('jira_status'),
    /** Jira assignee display name, synced by the worker. */
    jiraAssignee: text('jira_assignee'),
    /** 'pending'|'linked'|'failed'|'unlinked' */
    linkState: text('link_state').notNull().default('pending'),
    /** 'create' | 'link_existing' — mode used when this link was initiated. */
    mode: text('mode').notNull().default('create'),
    /** Last time the worker synced Jira state back. */
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** Machine-readable error code when link_state = 'failed'. */
    errorCode: text('error_code'),
    /** Human-readable error message for the UI card. */
    errorMessage: text('error_message'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantTicketIdx: index('ticket_jira_links_tenant_ticket_idx').on(t.tenantId, t.ticketId),
    tenantIssueIdx: index('ticket_jira_links_tenant_issue_idx').on(t.tenantId, t.jiraIssueId),
    tenantIdx: index('ticket_jira_links_tenant_idx').on(t.tenantId),
    /**
     * Unique active link per (tenant, ticket, project).
     * Partial index only covers 'pending' and 'linked' states, allowing
     * re-escalation after unlink or failure (those states are excluded).
     */
    uniqueActiveLinkIdx: uniqueIndex('ticket_jira_links_unique_active')
      .on(t.tenantId, t.ticketId, t.projectKey)
      .where(sql`link_state IN ('pending','linked')`),
  }),
);

export type TicketJiraLink = typeof ticketJiraLinks.$inferSelect;
export type NewTicketJiraLink = typeof ticketJiraLinks.$inferInsert;
