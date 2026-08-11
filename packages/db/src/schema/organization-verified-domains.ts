import {
  pgTable,
  uuid,
  timestamp,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';

// Data classification: Internal
// Tracks verified email domains that belong to an organization within a tenant.
// A single domain cannot bind to two organizations within the same tenant
// (enforced by unique index on lower(domain)).

const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

export const organizationVerifiedDomains = pgTable(
  'organization_verified_domains',
  {
    id: uuid('id').defaultRandom().notNull(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    // citext — case-insensitive domain comparison
    domain: citext('domain').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: { columns: [t.tenantId, t.id], name: 'organization_verified_domains_pkey' },
    // One domain per tenant — citext handles case-insensitive comparison
    tenantDomainUidx: uniqueIndex('org_verified_domains_tenant_domain_uidx').on(
      t.tenantId,
      t.domain,
    ),
    tenantOrgIdx: index('org_verified_domains_tenant_org_idx').on(t.tenantId, t.organizationId),
  }),
);

export type OrganizationVerifiedDomain = typeof organizationVerifiedDomains.$inferSelect;
export type NewOrganizationVerifiedDomain = typeof organizationVerifiedDomains.$inferInsert;
