/**
 * Audit log fixtures for organization-audit integration tests — WO-030.
 *
 * Provides multi-operation, multi-actor, multi-month AuditLogRow objects
 * so tests can run against deterministic fixture data without a live database.
 *
 * Spans three months (Jan–Mar 2024) across the full set of org-domain
 * operations, with staff, machine and portal actors, and includes rows that
 * exercise PII masking (fields in ORG_PII_FIELDS such as email, name).
 */

import type { AuditLogRow } from '../../src/modules/audit/audit-query.service';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const ORG_AUDIT_TENANT_A = 'aaaaaaaa-1111-0000-0000-000000000001';
export const ORG_AUDIT_TENANT_B = 'bbbbbbbb-2222-0000-0000-000000000002';
export const ORG_AUDIT_ORG_ID   = 'cccccccc-3333-0000-0000-000000000001';

export const AUDIT_ACTOR_STAFF   = 'actor-staff-0000-0000-000000000001';
export const AUDIT_ACTOR_MACHINE = 'actor-machine-000-0000-000000000002';
export const AUDIT_ACTOR_PORTAL  = 'actor-portal-000-0000-000000000003';

// ---------------------------------------------------------------------------
// Individual fixture rows
// ---------------------------------------------------------------------------

/** Row 1 — organization.create (Jan 2024, staff actor, no diff) */
export const ROW_ORG_CREATE: AuditLogRow = {
  id:           'audit-00000001-0000-0000-0000-000000000001',
  occurredAt:   new Date('2024-01-10T10:00:00.000Z'),
  actorType:    'staff',
  actorId:      AUDIT_ACTOR_STAFF,
  actorDisplay: 'Alice Admin',
  actorRole:    'admin',
  resourceType: 'organization',
  resourceId:   ORG_AUDIT_ORG_ID,
  action:       'organization.create',
  eventType:    'organization.create',
  changedFields: null,
  beforeState:  null,
  afterState:   { name: 'Acme Corp', slaTier: 'standard', status: 'active' },
  source:       null,
  traceId:      'trace-audit-0001',
};

/** Row 2 — organization.update name (Jan 2024, staff actor, PII field changed) */
export const ROW_ORG_UPDATE_NAME: AuditLogRow = {
  id:           'audit-00000002-0000-0000-0000-000000000002',
  occurredAt:   new Date('2024-01-20T14:30:00.000Z'),
  actorType:    'staff',
  actorId:      AUDIT_ACTOR_STAFF,
  actorDisplay: 'Alice Admin',
  actorRole:    'admin',
  resourceType: 'organization',
  resourceId:   ORG_AUDIT_ORG_ID,
  action:       'organization.update',
  eventType:    'organization.update',
  changedFields: ['name'],
  beforeState:  { name: 'Acme Corp', slaTier: 'standard' },
  afterState:   { name: 'Acme Corporation', slaTier: 'standard' },
  source:       null,
  traceId:      'trace-audit-0002',
};

/** Row 3 — organization.update slaTier (Feb 2024, machine actor, non-PII field) */
export const ROW_ORG_UPDATE_SLA: AuditLogRow = {
  id:           'audit-00000003-0000-0000-0000-000000000003',
  occurredAt:   new Date('2024-02-05T09:00:00.000Z'),
  actorType:    'machine',
  actorId:      AUDIT_ACTOR_MACHINE,
  actorDisplay: 'jira-sync-worker',
  actorRole:    null,
  resourceType: 'organization',
  resourceId:   ORG_AUDIT_ORG_ID,
  action:       'organization.update',
  eventType:    'organization.update',
  changedFields: ['slaTier'],
  beforeState:  { slaTier: 'standard' },
  afterState:   { slaTier: 'premium' },
  source:       'jira-sync-worker',
  traceId:      'trace-audit-0003',
};

/** Row 4 — contact.create with email (Feb 2024, staff actor, PII email field) */
export const ROW_CONTACT_CREATE: AuditLogRow = {
  id:           'audit-00000004-0000-0000-0000-000000000004',
  occurredAt:   new Date('2024-02-15T11:00:00.000Z'),
  actorType:    'staff',
  actorId:      AUDIT_ACTOR_STAFF,
  actorDisplay: 'Alice Admin',
  actorRole:    'admin',
  resourceType: 'organization',
  resourceId:   ORG_AUDIT_ORG_ID,
  action:       'contact.create',
  eventType:    'contact.create',
  changedFields: ['email', 'firstName', 'lastName'],
  beforeState:  null,
  afterState:   { email: '[redacted]', firstName: '[redacted]', lastName: '[redacted]', role: 'primary' },
  source:       null,
  traceId:      'trace-audit-0004',
};

/** Row 5 — organization.deactivate (Mar 2024, staff actor) */
export const ROW_ORG_DEACTIVATE: AuditLogRow = {
  id:           'audit-00000005-0000-0000-0000-000000000005',
  occurredAt:   new Date('2024-03-01T08:00:00.000Z'),
  actorType:    'staff',
  actorId:      AUDIT_ACTOR_STAFF,
  actorDisplay: 'Alice Admin',
  actorRole:    'admin',
  resourceType: 'organization',
  resourceId:   ORG_AUDIT_ORG_ID,
  action:       'organization.deactivate',
  eventType:    'organization.deactivate',
  changedFields: ['status'],
  beforeState:  { status: 'active' },
  afterState:   { status: 'inactive' },
  source:       null,
  traceId:      'trace-audit-0005',
};

/** Row 6 — organization.reactivate (Mar 2024, machine actor) */
export const ROW_ORG_REACTIVATE: AuditLogRow = {
  id:           'audit-00000006-0000-0000-0000-000000000006',
  occurredAt:   new Date('2024-03-10T10:00:00.000Z'),
  actorType:    'machine',
  actorId:      AUDIT_ACTOR_MACHINE,
  actorDisplay: 'retention-worker',
  actorRole:    null,
  resourceType: 'organization',
  resourceId:   ORG_AUDIT_ORG_ID,
  action:       'organization.reactivate',
  eventType:    'organization.reactivate',
  changedFields: ['status'],
  beforeState:  { status: 'inactive' },
  afterState:   { status: 'active' },
  source:       'retention-worker',
  traceId:      'trace-audit-0006',
};

/** Row 7 — contact.update email (Mar 2024, portal actor, PII email changed) */
export const ROW_CONTACT_UPDATE_EMAIL: AuditLogRow = {
  id:           'audit-00000007-0000-0000-0000-000000000007',
  occurredAt:   new Date('2024-03-20T16:00:00.000Z'),
  actorType:    'portal',
  actorId:      AUDIT_ACTOR_PORTAL,
  actorDisplay: null,
  actorRole:    null,
  resourceType: 'organization',
  resourceId:   ORG_AUDIT_ORG_ID,
  action:       'contact.update',
  eventType:    'contact.update',
  changedFields: ['email'],
  beforeState:  { email: '[redacted]' },
  afterState:   { email: '[redacted]' },
  source:       null,
  traceId:      'trace-audit-0007',
};

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/** All rows newest-first (as returned by the list endpoint). */
export const ALL_AUDIT_ROWS: AuditLogRow[] = [
  ROW_CONTACT_UPDATE_EMAIL,
  ROW_ORG_REACTIVATE,
  ROW_ORG_DEACTIVATE,
  ROW_CONTACT_CREATE,
  ROW_ORG_UPDATE_SLA,
  ROW_ORG_UPDATE_NAME,
  ROW_ORG_CREATE,
];

/** Only rows with machine actorType. */
export const MACHINE_ACTOR_ROWS: AuditLogRow[] = ALL_AUDIT_ROWS.filter(
  (r) => r.actorType === 'machine',
);

/** Only rows with action 'organization.update'. */
export const ORG_UPDATE_ROWS: AuditLogRow[] = ALL_AUDIT_ROWS.filter(
  (r) => r.action === 'organization.update',
);

/** Jan 2024 rows only. */
export const JANUARY_ROWS: AuditLogRow[] = ALL_AUDIT_ROWS.filter(
  (r) => r.occurredAt >= new Date('2024-01-01') && r.occurredAt < new Date('2024-02-01'),
);

/**
 * Helper: build N stub AuditLogRow objects for testing the export row cap.
 * All rows use the same shape; only id and traceId are varied.
 */
export function buildExportCapRows(count: number): AuditLogRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id:           `cap-row-${String(i).padStart(6, '0')}`,
    occurredAt:   new Date('2024-01-15T12:00:00.000Z'),
    actorType:    'staff' as const,
    actorId:      AUDIT_ACTOR_STAFF,
    actorDisplay: 'Alice Admin',
    actorRole:    'admin',
    resourceType: 'organization',
    resourceId:   ORG_AUDIT_ORG_ID,
    action:       'organization.update',
    eventType:    'organization.update',
    changedFields: ['slaTier'],
    beforeState:  { slaTier: 'standard' },
    afterState:   { slaTier: 'premium' },
    source:       null,
    traceId:      `trace-cap-${i}`,
  }));
}
