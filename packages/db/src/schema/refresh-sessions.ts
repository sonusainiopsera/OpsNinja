import { pgTable, uuid, text, timestamp, integer, boolean } from 'drizzle-orm/pg-core';

/**
 * Audit records for refresh sessions.
 * Redis is the authoritative hot store; this table records issue/rotate/revoke
 * timestamps to satisfy one-year audit retention.
 *
 * NOTE: This table is auth infrastructure and does not carry tenant data.
 * Application code must supply explicit tenantId predicates; RLS is not applied
 * because the auth service operates outside the normal tenant transaction context.
 */
export const refreshSessions = pgTable('refresh_sessions', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  userId: uuid('user_id').notNull(),
  familyId: uuid('family_id').notNull(),
  rotationCount: integer('rotation_count').notNull().default(0),
  isRevoked: boolean('is_revoked').notNull().default(false),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  lastRotatedAt: timestamp('last_rotated_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export type RefreshSession = typeof refreshSessions.$inferSelect;
export type NewRefreshSession = typeof refreshSessions.$inferInsert;
