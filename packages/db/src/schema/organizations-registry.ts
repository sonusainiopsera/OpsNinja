/**
 * Organization registry schema — WO-023.
 *
 * Data classification (per retention policy):
 *   organizations        — Internal
 *   customer_accounts    — Internal
 *   contacts             — Confidential (contains PII)
 *   organization_verified_domains — Internal
 *   custom_field_defs    — Internal
 *
 * All tables carry tenant_id uuid NOT NULL as the leading column of every
 * composite index and foreign key so cross-tenant joins are structurally
 * invalid. RLS USING/WITH CHECK policies are added in the SQL migration.
 *
 * DevOps metadata is stored in custom_field_values JSONB (validated by
 * custom_field_defs at application layer) — no per-tenant DDL.
 */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Extended organizations table columns (expanded from base schema)
//
// The base organizations table (in schema.ts) has: id, tenant_id, name, tier,
// active, custom_fields, created_at, updated_at.
// WO-023 adds slug, sla_tier, region, status, custom_field_values,
// primary_contact_id, deactivated_at.
// The migration uses ADD COLUMN (expand pattern) for backward compatibility.
// ---------------------------------------------------------------------------

export const organizationsRegistry = pgTable(
  'organizations',
  {
    // ── Core columns (already exist in base schema) ───────────────────────
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    name: text('name').notNull(),

    // ── WO-023 additions ──────────────────────────────────────────────────

    /** URL-safe slug, unique per tenant. Used in portal URLs. */
    slug: text('slug'),

    /** SLA tier (replaces 'tier' column semantically). e.g. 'standard', 'premium', 'enterprise'. */
    slaTier: text('sla_tier').notNull().default('standard'),

    /** Deployment region. e.g. 'us-east-1', 'eu-west-1'. */
    region: text('region'),

    /**
     * Lifecycle status. Constrained to 'active' | 'inactive' in the migration.
     * Default 'active'. No hard-delete — use deactivated_at + status='inactive'.
     */
    status: text('status').notNull().default('active'),

    /**
     * DevOps metadata from custom field definitions.
     * Keys are validated against custom_field_defs at application layer.
     * GIN-indexed for JSONB containment queries.
     */
    customFieldValues: jsonb('custom_field_values').notNull().default({}),

    /** Primary contact (FK to contacts); nullable for new/migrated records. */
    primaryContactId: uuid('primary_contact_id'),

    /** Set when status transitions to 'inactive'. Null for active records. */
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('organizations_tenant_status_idx').on(t.tenantId, t.status),
    tenantSlaTierIdx: index('organizations_tenant_sla_tier_idx').on(t.tenantId, t.slaTier),
    // Case-insensitive unique name per tenant for active organizations.
    // The partial unique index (WHERE status='active') is in the SQL migration.
    tenantIdIdx: index('organizations_tenant_id_idx').on(t.tenantId),
    // GIN index on custom_field_values is in the SQL migration.
  }),
);

export type OrganizationRegistry = typeof organizationsRegistry.$inferSelect;
export type NewOrganizationRegistry = typeof organizationsRegistry.$inferInsert;

// ---------------------------------------------------------------------------
// customer_accounts — billing / parent grouping above individual organizations
//
// Composite FK to organizations includes tenant_id so cross-tenant references
// are impossible at the constraint level.
// ---------------------------------------------------------------------------

export const customerAccounts = pgTable(
  'customer_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    /** Display name for the billing account. */
    name: text('name').notNull(),

    /** Billing/CRM external reference. */
    externalId: text('external_id'),

    /** Composite FK reference: (tenant_id, organization_id) → organizations. */
    organizationId: uuid('organization_id').notNull(),

    status: text('status').notNull().default('active'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('customer_accounts_tenant_id_idx').on(t.tenantId),
    tenantOrgIdx: index('customer_accounts_tenant_org_idx').on(t.tenantId, t.organizationId),
  }),
);

export type CustomerAccount = typeof customerAccounts.$inferSelect;
export type NewCustomerAccount = typeof customerAccounts.$inferInsert;

// ---------------------------------------------------------------------------
// contacts — Confidential (PII: email, full_name)
//
// email is stored as citext (case-insensitive text) — the citext extension
// must be enabled. FK to organizations is composite (tenant_id, organization_id).
// ---------------------------------------------------------------------------

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    /** Composite FK: (tenant_id, organization_id) → organizations. */
    organizationId: uuid('organization_id').notNull(),

    /** PII — citext (case-insensitive). Unique per tenant+organization. */
    email: text('email').notNull(),

    /** PII — display name. */
    fullName: text('full_name').notNull(),

    jobTitle: text('job_title'),

    /** When true, this contact may log in to the customer portal. */
    portalAccessEnabled: boolean('portal_access_enabled').notNull().default(false),

    /** 'active' | 'inactive' */
    status: text('status').notNull().default('active'),

    /** Timestamp of last portal login; null if never logged in. */
    lastPortalLoginAt: timestamp('last_portal_login_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('contacts_tenant_id_idx').on(t.tenantId),
    tenantOrgIdx: index('contacts_tenant_org_idx').on(t.tenantId, t.organizationId),
    tenantEmailUniq: uniqueIndex('contacts_tenant_email_uniq').on(t.tenantId, t.email),
  }),
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;

// ---------------------------------------------------------------------------
// organization_verified_domains
//
// Each domain may bind to at most one organization per tenant.
// Unique constraint on (tenant_id, lower(domain)) enforced in SQL migration.
// ---------------------------------------------------------------------------

export const organizationVerifiedDomains = pgTable(
  'organization_verified_domains',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    /** Composite FK: (tenant_id, organization_id) → organizations. */
    organizationId: uuid('organization_id').notNull(),

    /** Domain (stored lowercase). e.g. 'acmecorp.com'. */
    domain: text('domain').notNull(),

    /** Verification method used to prove domain ownership. */
    verifiedVia: text('verified_via').notNull().default('dns_txt'),

    verifiedAt: timestamp('verified_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('org_verified_domains_tenant_id_idx').on(t.tenantId),
    tenantOrgIdx: index('org_verified_domains_tenant_org_idx').on(t.tenantId, t.organizationId),
    // Unique (tenant_id, lower(domain)) enforced via SQL migration partial unique index.
  }),
);

export type OrganizationVerifiedDomain = typeof organizationVerifiedDomains.$inferSelect;
export type NewOrganizationVerifiedDomain = typeof organizationVerifiedDomains.$inferInsert;

// ---------------------------------------------------------------------------
// custom_field_defs — defines per-tenant metadata fields applied to orgs
//
// custom_field_values JSONB on organizations references these definitions.
// Orphan keys (keys in custom_field_values with no corresponding non-archived
// custom_field_def) are flagged by application validation, not DB constraints.
// ---------------------------------------------------------------------------

export const customFieldDefs = pgTable(
  'custom_field_defs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    /** Stable machine key used as the JSONB property name in custom_field_values. */
    fieldKey: text('field_key').notNull(),

    /** Human-readable label shown in the UI. */
    label: text('label').notNull(),

    /** Data type: string | number | boolean | date | single_select | multi_select */
    dataType: text('data_type').notNull(),

    /** Allowed options for single_select / multi_select. Null for other types. */
    options: jsonb('options'),

    required: boolean('required').notNull().default(false),

    /** Which entity this field applies to. Default 'organization'. */
    appliesTo: text('applies_to').notNull().default('organization'),

    displayOrder: integer('display_order').notNull().default(0),

    /** Soft-delete: set to archive. Null = active definition. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('custom_field_defs_tenant_id_idx').on(t.tenantId),
    tenantKeyUniq: uniqueIndex('custom_field_defs_tenant_key_uniq').on(t.tenantId, t.fieldKey),
  }),
);

export type CustomFieldDef = typeof customFieldDefs.$inferSelect;
export type NewCustomFieldDef = typeof customFieldDefs.$inferInsert;
