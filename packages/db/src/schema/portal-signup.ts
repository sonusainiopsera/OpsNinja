import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';

const textArray = customType<{ data: string[]; driverData: string[] }>({
  dataType() { return 'text[]'; },
});

// ── Enums ─────────────────────────────────────────────────────────────────────

export const portalSignupStatusEnum = pgEnum('portal_signup_status', [
  'pending_verification',
  'verified',
  'rejected',
]);

export const portalUserStatusEnum = pgEnum('portal_user_status', [
  'active',
  'suspended',
  'deactivated',
]);

// ── portal_signup_requests ────────────────────────────────────────────────────

export const portalSignupRequests = pgTable(
  'portal_signup_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    email: text('email').notNull(),
    emailHash: text('email_hash').notNull(),
    applicantName: text('applicant_name'),
    organizationId: uuid('organization_id'),
    status: portalSignupStatusEnum('status').notNull().default('pending_verification'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationEmailStatus: text('verification_email_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('portal_signup_requests_tenant_status_idx').on(t.tenantId, t.status),
  }),
);

export type PortalSignupRequest = typeof portalSignupRequests.$inferSelect;
export type NewPortalSignupRequest = typeof portalSignupRequests.$inferInsert;
export type PortalSignupStatus = typeof portalSignupStatusEnum.enumValues[number];

// ── portal_users ──────────────────────────────────────────────────────────────

export const portalUsers = pgTable(
  'portal_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    organizationId: uuid('organization_id'),
    signupRequestId: uuid('signup_request_id').notNull(),
    email: text('email').notNull(),
    emailHash: text('email_hash').notNull(),
    roles: textArray('roles').notNull(),
    status: portalUserStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantEmailHashIdx: uniqueIndex('portal_users_tenant_email_idx').on(t.tenantId, t.emailHash),
    tenantOrgIdx: index('portal_users_tenant_org_idx').on(t.tenantId, t.organizationId),
  }),
);

export type PortalUser = typeof portalUsers.$inferSelect;
export type NewPortalUser = typeof portalUsers.$inferInsert;
export type PortalUserStatus = typeof portalUserStatusEnum.enumValues[number];

// ── portal_verification_tokens ────────────────────────────────────────────────

export const portalVerificationTokens = pgTable(
  'portal_verification_tokens',
  {
    tokenId: uuid('token_id').primaryKey().defaultRandom(),
    signupRequestId: uuid('signup_request_id').notNull(),
    tenantId: uuid('tenant_id'),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    attemptCount: integer('attempt_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    expiresIdx: index('portal_verification_tokens_expires_idx').on(t.expiresAt),
  }),
);

export type PortalVerificationToken = typeof portalVerificationTokens.$inferSelect;
export type NewPortalVerificationToken = typeof portalVerificationTokens.$inferInsert;
