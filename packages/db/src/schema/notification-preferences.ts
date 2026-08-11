/**
 * notification_preferences — per-contact and per-organization channel preferences.
 *
 * Scope:
 *  - 'contact'      → a specific contact row (contactId NOT NULL)
 *  - 'organization' → an org-level default (contactId NULL, acts as org default)
 *
 * Mode:
 *  - 'immediate' → send immediately (default)
 *  - 'off'       → suppress this category entirely
 *
 * Uniqueness: (tenant_id, scope, coalesce(contact_id, organization_id), event_type, channel).
 * Because COALESCE cannot appear in a Drizzle uniqueIndex(), the constraint is
 * expressed in the SQL migration using a partial unique index on each scope branch.
 *
 * RLS: enabled + FORCE ROW LEVEL SECURITY in the migration.
 */

import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export type NotificationScope = 'contact' | 'organization';
export type NotificationMode = 'immediate' | 'off';

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').defaultRandom().notNull(),
    tenantId: uuid('tenant_id').notNull(),
    /** 'contact' means per-contact override; 'organization' means org-wide default. */
    scope: text('scope').$type<NotificationScope>().notNull(),
    /** Present when scope = 'contact'; null for org-level defaults. */
    contactId: uuid('contact_id'),
    /** Always populated — the org whose default this applies to. */
    organizationId: uuid('organization_id').notNull(),
    /**
     * One of the eight catalogue event types:
     * ticket.created | ticket.status_changed | ticket.comment_added |
     * ticket.assignee_changed | ticket.resolved | ticket.reopened |
     * sla.reminder_threshold_reached | sla.breached
     */
    eventType: text('event_type').notNull(),
    /** Delivery channel: 'email' (future: 'slack', 'teams'). */
    channel: text('channel').notNull().default('email'),
    /** 'immediate' (default) or 'off' (suppressed for this scope). */
    mode: text('mode').$type<NotificationMode>().notNull().default('immediate'),
    /** UUID of the staff/portal user who made the last change. */
    updatedBy: uuid('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * Partial unique index for contact-level preferences.
     * WHERE scope = 'contact' AND contact_id IS NOT NULL
     * Defined in SQL migration because Drizzle cannot express partial indexes.
     */
    tenantContactIdx: index('notification_prefs_tenant_contact_idx').on(
      t.tenantId,
      t.contactId,
    ),
    /**
     * Partial unique index for organization-level defaults.
     * WHERE scope = 'organization'
     * Defined in SQL migration.
     */
    tenantOrgIdx: index('notification_prefs_tenant_org_idx').on(
      t.tenantId,
      t.organizationId,
    ),
    /**
     * Cache-key: (tenant_id, event_type, channel) composite lookup.
     */
    tenantEventIdx: index('notification_prefs_tenant_event_idx').on(
      t.tenantId,
      t.eventType,
      t.channel,
    ),
  }),
);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
