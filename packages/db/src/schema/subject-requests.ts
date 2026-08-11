/**
 * Drizzle schema for subject_requests — WO-096.
 *
 * Tracks GDPR data-subject rights requests (access, portability, rectification,
 * erasure). Status lifecycle: queued → running → (completed | deferred | failed).
 *
 * The unique partial index on (tenant_id, type, subject_id) WHERE status IN
 * ('queued', 'running') coalesces duplicate in-flight requests so only one
 * active job exists per subject/type.
 */

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';

export const subjectRequests = pgTable(
  'subject_requests',
  {
    id:             uuid('id').defaultRandom().primaryKey(),
    tenantId:       uuid('tenant_id').notNull(),
    type:           text('type').notNull(),
    subjectType:    text('subject_type').notNull(),
    subjectId:      text('subject_id').notNull(),
    requestedBy:    uuid('requested_by').notNull(),
    status:         text('status').notNull().default('queued'),
    deferralReason: text('deferral_reason'),
    artifactS3Key:  text('artifact_s3_key'),
    requestedAt:    timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt:    timestamp('completed_at', { withTimezone: true }),
    createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx:        index('subject_requests_tenant_idx').on(t.tenantId, t.createdAt),
    tenantSubjectIdx: index('subject_requests_tenant_subject_idx').on(
      t.tenantId, t.subjectType, t.subjectId, t.createdAt,
    ),
  }),
);

export type SubjectRequest    = typeof subjectRequests.$inferSelect;
export type NewSubjectRequest = typeof subjectRequests.$inferInsert;

export type SubjectRequestType    = 'access' | 'portability' | 'rectification' | 'erasure';
export type SubjectRequestStatus  = 'queued' | 'running' | 'deferred' | 'completed' | 'failed';
