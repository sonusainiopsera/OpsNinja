import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';

// Data classification: Confidential (PII)
// Retention: delete within 30 days of contact deletion request (GDPR)

// Case-insensitive text for email and domain comparisons.
// Requires the citext PostgreSQL extension (created in migration 005).
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const contactStatusEnum = pgEnum('contact_status', ['active', 'inactive', 'bounced']);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').defaultRandom().notNull(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    // citext — case-insensitive email storage (PII: Confidential)
    email: citext('email').notNull(),
    fullName: text('full_name').notNull(),
    jobTitle: text('job_title'),
    portalAccessEnabled: boolean('portal_access_enabled').notNull().default(false),
    status: contactStatusEnum('status').notNull().default('active'),
    lastPortalLoginAt: timestamp('last_portal_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: { columns: [t.tenantId, t.id], name: 'contacts_pkey' },
    tenantOrgIdx: index('contacts_tenant_org_idx').on(t.tenantId, t.organizationId),
    tenantStatusIdx: index('contacts_tenant_status_idx').on(t.tenantId, t.status),
    // One email per tenant (case-insensitive via citext)
    tenantEmailUidx: uniqueIndex('contacts_tenant_email_uidx').on(t.tenantId, t.email),
  }),
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

// Re-export for FK reference clarity
export { organizations };
