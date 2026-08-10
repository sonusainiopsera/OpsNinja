/**
 * Tenants schema module.
 *
 * The `tenants` table is the root entity for multi-tenancy. Every
 * tenant-scoped table carries a non-nullable `tenant_id` that references
 * `tenants.id`. The `tenants` table itself is NOT tenant-scoped (it has no
 * `tenant_id` column) because it IS the tenant registry.
 */
import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /**
   * plan_tier: starter | growth | enterprise
   * Check constraint enforced in SQL migration; Drizzle uses text for
   * forward-compatible extension without enum migration overhead.
   */
  planTier: text('plan_tier').notNull().default('starter'),
  aiSynthesisEnabled: boolean('ai_synthesis_enabled').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
