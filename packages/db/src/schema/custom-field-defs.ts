import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
} from 'drizzle-orm/pg-core';

// Data classification: Internal
// Defines the schema for tenant-specific custom fields on organization records.
// custom_field_values JSONB on organizations is validated against these definitions
// by application-layer service code. No per-tenant DDL — metadata only.

export const customFieldDataTypeEnum = pgEnum('custom_field_data_type', [
  'string',
  'number',
  'boolean',
  'date',
  'single_select',
  'multi_select',
]);

export const customFieldDefs = pgTable(
  'custom_field_defs',
  {
    id: uuid('id').defaultRandom().notNull(),
    tenantId: uuid('tenant_id').notNull(),
    fieldKey: text('field_key').notNull(),
    label: text('label').notNull(),
    dataType: customFieldDataTypeEnum('data_type').notNull(),
    // JSONB list of allowed values for single_select / multi_select fields
    options: jsonb('options'),
    required: boolean('required').notNull().default(false),
    appliesTo: text('applies_to').notNull().default('organization'),
    displayOrder: integer('display_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: { columns: [t.tenantId, t.id], name: 'custom_field_defs_pkey' },
    // field_key must be unique per tenant among active (non-archived) definitions
    tenantFieldKeyUidx: uniqueIndex('custom_field_defs_tenant_field_key_uidx').on(
      t.tenantId,
      t.fieldKey,
    ),
    tenantAppliesToIdx: index('custom_field_defs_tenant_applies_to_idx').on(
      t.tenantId,
      t.appliesTo,
    ),
  }),
);

export type CustomFieldDef = typeof customFieldDefs.$inferSelect;
export type NewCustomFieldDef = typeof customFieldDefs.$inferInsert;
