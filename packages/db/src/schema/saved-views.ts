/**
 * Saved views schema — WO-039.
 *
 * saved_views: persists validated filter ASTs, sort specs, column selections and
 *   scope classification (system | private | shared). System views are immutable
 *   and seeded per-tenant; private/shared views are agent-authored.
 *
 * saved_view_pins: per-agent pin state and display order. Composite PK on
 *   (tenant_id, user_id, view_id) makes upsert idempotent.
 *
 * Data classification: Internal.
 * RLS policies bound to app.current_tenant session variable via SQL migration.
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
// saved_views
// ---------------------------------------------------------------------------

export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),

    /**
     * NULL for scope='system'. For private/shared views this is the creating user.
     * Ownership rules are enforced at the service layer — only the owning user
     * or a manager (view:share) may mutate a shared view.
     */
    ownerUserId: uuid('owner_user_id'),

    name: text('name').notNull(),

    /**
     * Compiler-validated filter AST stored verbatim.
     * May contain placeholder tokens CURRENT_USER and CURRENT_ORG_SCOPE
     * that are substituted at read time.
     */
    filterAst: jsonb('filter_ast').notNull().default({}),

    /**
     * Allow-listed list of {field, direction} sort pairs.
     * Validated against the field registry at write time.
     */
    sortSpec: jsonb('sort_spec').notNull().default([]),

    /** Allow-listed display column keys rejected at write time if unknown. */
    columns: jsonb('columns').notNull().default([]),

    /**
     * 'system'  — seeded by the platform, immutable, visible to all agents.
     * 'private' — visible only to owner_user_id.
     * 'shared'  — visible to all agents in the tenant; requires view:share to publish.
     */
    scope: text('scope').notNull().default('private'),

    isActive: boolean('is_active').notNull().default(true),

    /**
     * Well-known slug for system views (e.g. 'all-open-tickets').
     * NULL for user-authored views.
     */
    slug: text('slug'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('saved_views_tenant_id_idx').on(t.tenantId),
    tenantOwnerIdx: index('saved_views_tenant_owner_idx').on(t.tenantId, t.ownerUserId),
    tenantScopeIdx: index('saved_views_tenant_scope_idx').on(t.tenantId, t.scope),
    /** Slug is unique per tenant — prevents duplicate system view seeding. */
    tenantSlugUniq: uniqueIndex('saved_views_tenant_slug_uniq').on(t.tenantId, t.slug),
  }),
);

export type SavedView = typeof savedViews.$inferSelect;
export type NewSavedView = typeof savedViews.$inferInsert;

// ---------------------------------------------------------------------------
// saved_view_pins
// ---------------------------------------------------------------------------

export const savedViewPins = pgTable(
  'saved_view_pins',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    viewId: uuid('view_id').notNull(),

    /** Display order — lower numbers appear first in the ViewsRail. */
    pinOrder: integer('pin_order').notNull().default(0),

    pinnedAt: timestamp('pinned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantUserViewPk: uniqueIndex('saved_view_pins_pk').on(
      t.tenantId,
      t.userId,
      t.viewId,
    ),
    tenantUserIdx: index('saved_view_pins_tenant_user_idx').on(t.tenantId, t.userId),
  }),
);

export type SavedViewPin = typeof savedViewPins.$inferSelect;
export type NewSavedViewPin = typeof savedViewPins.$inferInsert;
