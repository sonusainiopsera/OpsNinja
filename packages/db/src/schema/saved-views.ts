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
  primaryKey,
} from 'drizzle-orm/pg-core';

export const viewScopeEnum = pgEnum('view_scope', ['system', 'private', 'shared']);

export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    ownerUserId: uuid('owner_user_id'),
    name: text('name').notNull(),
    filterAst: jsonb('filter_ast').notNull(),
    sortSpec: jsonb('sort_spec').notNull().default([]),
    columns: text('columns').array().notNull().default([]),
    scope: viewScopeEnum('scope').notNull().default('private'),
    isActive: boolean('is_active').notNull().default(true),
    astSignature: text('ast_signature').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('saved_views_tenant_idx').on(t.tenantId),
    tenantScopeIdx: index('saved_views_tenant_scope_idx').on(t.tenantId, t.scope),
    tenantOwnerIdx: index('saved_views_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
    // Unique name per owner (or system) within tenant
    tenantOwnerNameUidx: uniqueIndex('saved_views_tenant_owner_name_uidx').on(
      t.tenantId,
      t.ownerUserId,
      t.name,
    ),
  }),
);

export type SavedView = typeof savedViews.$inferSelect;
export type NewSavedView = typeof savedViews.$inferInsert;

export const savedViewPins = pgTable(
  'saved_view_pins',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    viewId: uuid('view_id').notNull(),
    pinOrder: integer('pin_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.userId, t.viewId] }),
    userPinsIdx: index('saved_view_pins_user_idx').on(t.tenantId, t.userId),
  }),
);

export type SavedViewPin = typeof savedViewPins.$inferSelect;
export type NewSavedViewPin = typeof savedViewPins.$inferInsert;
