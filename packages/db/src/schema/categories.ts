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
 * - path is a materialised text path maintained by the application service
 *   (e.g. "Pipeline / Jenkins Integration"). An index on (tenant_id, path)
 *   accelerates path-prefix lookups.
 * - Sibling-name uniqueness: two partial unique indexes (one for root nodes
 *   where parent_id IS NULL and one for child nodes where parent_id IS NOT
 *   NULL) enforce lower(name) uniqueness within the same parent. These are
 *   created in the SQL migration.
 */
import {
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
    /**
     * path: materialised text path, maintained by the CategoryService.
     * Format: "Root Name / Child Name / Grandchild Name"
     * Application is responsible for updating descendants when a category
     * is renamed. Index on (tenant_id, path) enables prefix-lookup.
     */
    path: text('path').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
