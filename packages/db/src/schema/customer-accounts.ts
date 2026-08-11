import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

// Data classification: Internal
// Represents billing or parent-account grouping; references organizations via
// composite FK (tenant_id, organization_id) to make cross-tenant references
// structurally invalid at the constraint level.

export const customerAccounts = pgTable(
  'customer_accounts',
  {
    id: uuid('id').defaultRandom().notNull(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    name: text('name').notNull(),
    billingEmail: text('billing_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: { columns: [t.tenantId, t.id], name: 'customer_accounts_pkey' },
    tenantOrgIdx: index('customer_accounts_tenant_org_idx').on(t.tenantId, t.organizationId),
  }),
);

export type CustomerAccount = typeof customerAccounts.$inferSelect;
export type NewCustomerAccount = typeof customerAccounts.$inferInsert;
