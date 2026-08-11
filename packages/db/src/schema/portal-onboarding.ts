/**
 * Portal onboarding schema — WO-088.
 *
 * portal_onboarding_states — one row per portal user, JSONB step map.
 * organization_change_requests — admin-reviewable field corrections.
 */

import {
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
// portal_onboarding_states
// ---------------------------------------------------------------------------

export const portalOnboardingStates = pgTable(
  'portal_onboarding_states',
  {
    id:           uuid('id').defaultRandom().primaryKey(),
    tenantId:     uuid('tenant_id').notNull(),
    userId:       uuid('user_id').notNull(),
    currentStep:  text('current_step').notNull().default('verify-organization'),
    /** JSONB map of step key → { status, updatedAt, data?, contentVersion? } */
    steps:        jsonb('steps').notNull().default({}),
    version:      integer('version').notNull().default(1),
    completedAt:  timestamp('completed_at', { withTimezone: true }),
    createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUniq:   uniqueIndex('portal_onboarding_states_user_uniq').on(t.tenantId, t.userId),
    tenantIdx:  index('portal_onboarding_states_tenant_idx').on(t.tenantId),
  }),
);

export type PortalOnboardingState = typeof portalOnboardingStates.$inferSelect;
export type NewPortalOnboardingState = typeof portalOnboardingStates.$inferInsert;

// ---------------------------------------------------------------------------
// organization_change_requests
// ---------------------------------------------------------------------------

export const organizationChangeRequests = pgTable(
  'organization_change_requests',
  {
    id:                  uuid('id').defaultRandom().primaryKey(),
    tenantId:            uuid('tenant_id').notNull(),
    organizationId:      uuid('organization_id').notNull(),
    requestedByUserId:   uuid('requested_by_user_id').notNull(),
    /** JSON array of { key, currentValue, proposedValue, note? } */
    fields:              jsonb('fields').notNull(),
    status:              text('status').notNull().default('pending'),
    reviewerUserId:      uuid('reviewer_user_id'),
    decidedAt:           timestamp('decided_at', { withTimezone: true }),
    createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt:           timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantOrgIdx:  index('org_change_requests_tenant_org_idx').on(t.tenantId, t.organizationId),
    statusIdx:     index('org_change_requests_status_idx').on(t.tenantId, t.status),
  }),
);

export type OrganizationChangeRequest = typeof organizationChangeRequests.$inferSelect;
export type NewOrganizationChangeRequest = typeof organizationChangeRequests.$inferInsert;
