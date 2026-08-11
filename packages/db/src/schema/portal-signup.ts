import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// portal_signup_requests
// ---------------------------------------------------------------------------

export const portalSignupRequests = pgTable(
  'portal_signup_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id'),
    organizationId: uuid('organization_id'),
    email: text('email').notNull(),
    applicantName: text('applicant_name').notNull(),
    status: text('status').notNull().default('pending_verification'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationEmailStatus: text('verification_email_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('portal_signup_requests_tenant_idx').on(t.tenantId),
  }),
);

export type PortalSignupRequest = typeof portalSignupRequests.$inferSelect;
export type NewPortalSignupRequest = typeof portalSignupRequests.$inferInsert;

export type PortalSignupStatus = 'pending_verification' | 'verified' | 'rejected' | 'expired';

// ---------------------------------------------------------------------------
// portal_verification_tokens
// ---------------------------------------------------------------------------

export const portalVerificationTokens = pgTable(
  'portal_verification_tokens',
  {
    tokenId: uuid('token_id').defaultRandom().primaryKey(),
    signupRequestId: uuid('signup_request_id').notNull(),
    tenantId: uuid('tenant_id'),
    /** SHA-256 hex of the raw token — the raw token is NEVER persisted. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    signupRequestIdx: index('portal_verification_tokens_signup_request_idx').on(t.signupRequestId),
  }),
);

export type PortalVerificationToken = typeof portalVerificationTokens.$inferSelect;
export type NewPortalVerificationToken = typeof portalVerificationTokens.$inferInsert;

// ---------------------------------------------------------------------------
// portal_users
// ---------------------------------------------------------------------------

export const portalUsers = pgTable(
  'portal_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id').notNull(),
    signupRequestId: uuid('signup_request_id').notNull(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: text('role').notNull().default('portal_user'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantEmailIdx: uniqueIndex('portal_users_tenant_email_idx').on(t.tenantId, t.email),
    tenantOrgIdx: index('portal_users_tenant_org_idx').on(t.tenantId, t.organizationId),
  }),
);

export type PortalUser = typeof portalUsers.$inferSelect;
export type NewPortalUser = typeof portalUsers.$inferInsert;
