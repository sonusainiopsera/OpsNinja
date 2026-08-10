/**
 * Sessions schema module.
 *
 * Covers: refresh_sessions, email_verification_tokens, pending_user_approvals.
 *
 * Security invariants:
 * - token_hash columns store SHA-256 of the raw token. Plaintext tokens must
 *   never appear in any column or log output.
 * - user_agent_hash / ip_hash store SHA-256 for anomaly detection without
 *   retaining PII.
 * - email_verification_tokens.tenant_id is nullable: a signup email arrives
 *   before the domain is matched to a tenant. Once the domain resolves, the
 *   row is tenant-bound.
 * - pending_user_approvals.tenant_id is also nullable for the same reason.
 *
 * RLS policy (tenant_isolation) is applied in migration 0009. Tables with
 * nullable tenant_id use a permissive variant: NULL rows are accessible to
 * the global approval/verification flow.
 */
import {
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const refreshSessions = pgTable(
  'refresh_sessions',
  {
    tenantId:     uuid('tenant_id').notNull().references(() => tenants.id),
    id:           uuid('id').notNull().defaultRandom(),
    userId:       uuid('user_id').notNull(),
    tokenHash:    text('token_hash').notNull(),
    issuedAt:     timestamp('issued_at',   { withTimezone: true }).notNull().defaultNow(),
    expiresAt:    timestamp('expires_at',  { withTimezone: true }).notNull(),
    revokedAt:    timestamp('revoked_at',  { withTimezone: true }),
    userAgentHash: text('user_agent_hash'),
    ipHash:       text('ip_hash'),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.id] })],
);

export const emailVerificationTokens = pgTable('email_verification_tokens', {
  id:         uuid('id').notNull().defaultRandom(),
  tenantId:   uuid('tenant_id'),
  tokenHash:  text('token_hash').notNull(),
  email:      text('email').notNull(),
  expiresAt:  timestamp('expires_at',  { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt:  timestamp('created_at',  { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.id] }),
]);

export const pendingUserApprovals = pgTable('pending_user_approvals', {
  id:          uuid('id').notNull().defaultRandom(),
  tenantId:    uuid('tenant_id'),
  email:       text('email').notNull(),
  displayName: text('display_name'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  approvedAt:  timestamp('approved_at',  { withTimezone: true }),
  rejectedAt:  timestamp('rejected_at',  { withTimezone: true }),
  reviewedBy:  uuid('reviewed_by'),
}, (table) => [
  primaryKey({ columns: [table.id] }),
]);

export type RefreshSession = typeof refreshSessions.$inferSelect;
export type NewRefreshSession = typeof refreshSessions.$inferInsert;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert;
export type PendingUserApproval = typeof pendingUserApprovals.$inferSelect;
export type NewPendingUserApproval = typeof pendingUserApprovals.$inferInsert;
