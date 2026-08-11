/**
 * Categories schema module.
 *
 * Supports multi-level categorization (e.g. Category: Pipeline,
 * Sub-category: Jenkins Integration) as required by the ticket routing engine.
 *
 * Design rules:
 * - tenant_id leads the composite PK (tenant_id, id).
 * - parent_id is a nullable self-FK within the tenant: (tenant_id, parent_id)
 *   → (tenant_id, id). This is enforced in the SQL migration with a composite
 *   FK; Drizzle schema carries the Typescript shape.
 * - path is a materialised slug-chain text path maintained by the application
 *   service (e.g. "pipeline/jenkins-integration"). An index on (tenant_id, path)
 *   accelerates path-prefix lookups.
 * - Sibling-name uniqueness: two partial unique indexes (one for root nodes
 *   where parent_id IS NULL and one for child nodes where parent_id IS NOT
 *   NULL) enforce lower(name) uniqueness within the same parent. These are
 *   created in the SQL migration.
 * - depth: 0 for root nodes, incremented by 1 for each level.
 * - is_active: soft-delete; deactivated nodes are excluded from new-assignment
 *   selectors but remain valid for historical ticket resolution.
 */
import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const categories = pgTable(
  'categories',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    id: uuid('id').notNull().defaultRandom(),
    /**
     * parent_id: nullable self-reference. NULL means root category.
     * Composite FK (tenant_id, parent_id) → (tenant_id, id) ensures the
     * parent belongs to the same tenant. Enforced in SQL migration.
     */
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    /** URL-safe slug derived from name; forms one segment of path. */
    slug: text('slug').notNull().default(''),
    /**
     * path: materialised slug-chain path, maintained by the CategoryService.
     * Format: "root-slug/child-slug/grandchild-slug"
     * Application is responsible for updating descendants when a category
     * is renamed or reparented. Index on (tenant_id, path) enables prefix-lookup.
     */
    path: text('path').notNull(),
    /** 0 = root, 1 = child, 2 = grandchild, etc. */
    depth: integer('depth').notNull().default(0),
    /** Display order within siblings; lower value = displayed first. */
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * Soft-delete flag. Deactivated categories remain valid for historical
     * ticket references but are hidden from new-assignment selectors.
     */
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
