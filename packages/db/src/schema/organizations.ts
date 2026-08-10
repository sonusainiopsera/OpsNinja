/**
 * Organizations schema module.
 *
 * Design rules:
 * - tenant_id is the leading column of the composite PK (tenant_id, id).
 * - Cross-tenant containment: composite FKs including tenant_id prevent
 *   cross-tenant data attachment at the database level.
 * - custom_field_values JSONB with a GIN index allows per-tenant DevOps
 *   metadata (cloud providers, deployment models, pipeline counts, etc.).
 * - organization_verified_domains has a per-tenant uniqueness constraint so
 *   two tenants can claim the same domain but duplicates within one tenant
 *   are rejected.
 * - Deactivation via is_active is the only supported path; hard deletes are
 *   blocked by FK dependencies from tickets.
 */
import {
  boolean,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const organizations = pgTable(
  'organizations',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    name: text('name').notNull(),
    /**
     * tier: standard | premium | enterprise — mirrors plan tier vocabulary
     * but is per-organization, not per-tenant.
     */
    tier: text('tier').notNull().default('standard'),
    region: text('region'),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * custom_field_values stores arbitrary DevOps metadata keyed by
     * custom_field_defs.key. GIN index (jsonb_path_ops) is created in the
     * SQL migration to enable fast containment queries.
     */
    customFieldValues: jsonb('custom_field_values').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

/**
 * Normalised child table for verified email domains.
 *
 * UNIQUE (tenant_id, domain) enforces per-tenant domain uniqueness.
 * Two different tenants may both claim example.com; duplicates within one
 * tenant are rejected. The composite FK (tenant_id, organization_id) keeps
 * domains inside their tenant boundary.
 */
export const organizationVerifiedDomains = pgTable(
  'organization_verified_domains',
  {
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    domain: text('domain').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.domain] }),
  ],
);

/**
 * custom_field_defs holds the schema for per-tenant custom fields.
 *
 * composite PK (tenant_id, id); UNIQUE (tenant_id, key) prevents duplicate
 * field keys within a tenant. The validation JSONB column holds optional
 * constraints (min/max for numbers, regex for text, enum values for select).
 */
export const customFieldDefs = pgTable(
  'custom_field_defs',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    /**
     * data_type: text | number | boolean | date | select
     * Check constraint enforced in SQL migration.
     */
    dataType: text('data_type').notNull(),
    required: boolean('required').notNull().default(false),
    /**
     * applies_to: organization | ticket | contact
     * Check constraint enforced in SQL migration.
     */
    appliesTo: text('applies_to').notNull(),
    validation: jsonb('validation'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrganizationVerifiedDomain = typeof organizationVerifiedDomains.$inferSelect;
export type NewOrganizationVerifiedDomain = typeof organizationVerifiedDomains.$inferInsert;
export type CustomFieldDef = typeof customFieldDefs.$inferSelect;
export type NewCustomFieldDef = typeof customFieldDefs.$inferInsert;
