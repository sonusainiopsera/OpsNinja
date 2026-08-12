/**
 * Audit query test fixtures — WO-096 AC12.
 *
 * Provides:
 *   - Multi-tenant audit log fixtures with varied actors, resources, and actions.
 *   - A deliberately tampered audit chain for chain-verify tests.
 *   - Subject fixtures with tickets, public/internal comments, CSAT, attachments.
 *   - All emails use example.invalid — no real PII.
 */

// ---------------------------------------------------------------------------
// Fixed deterministic identifiers
// ---------------------------------------------------------------------------

export const AUDIT_TENANT_A = 'at000001-0000-0000-0000-000000000001';
export const AUDIT_TENANT_B = 'at000002-0000-0000-0000-000000000001';

export const AUDIT_ACTOR_ADMIN   = 'ua000001-0000-0000-0000-000000000001';
export const AUDIT_ACTOR_AGENT   = 'ua000002-0000-0000-0000-000000000001';
export const AUDIT_ACTOR_MACHINE = 'ua000003-0000-0000-0000-000000000001';

export const AUDIT_RESOURCE_TICKET_1  = 'tk000001-0000-0000-0000-000000000001';
export const AUDIT_RESOURCE_TICKET_2  = 'tk000002-0000-0000-0000-000000000001';
export const AUDIT_RESOURCE_WEBHOOK_1 = 'wh000001-0000-0000-0000-000000000001';

export const AUDIT_CONTACT_SUBJECT = 'cs000001-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Audit log fixture rows
// ---------------------------------------------------------------------------

export interface AuditLogFixture {
  id:            string;
  tenantId:      string;
  actorKind:     'staff' | 'portal' | 'machine';
  actorId:       string;
  resourceType:  string;
  resourceId:    string;
  action:        string;
  eventType:     string;
  changedFields: string[];
  beforeState:   object | null;
  afterState:    object | null;
  source:        string;
  traceId:       string;
  createdAt:     Date;
}

/**
 * 10 audit log rows spread across two tenants, two actors, multiple resource types.
 * Used for filter-matrix and pagination tests.
 */
export const AUDIT_LOG_FIXTURES: AuditLogFixture[] = [
  // Tenant A — ticket events
  {
    id:            'al000001-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_A,
    actorKind:     'staff',
    actorId:       AUDIT_ACTOR_ADMIN,
    resourceType:  'ticket',
    resourceId:    AUDIT_RESOURCE_TICKET_1,
    action:        'create',
    eventType:     'ticket.created',
    changedFields: [],
    beforeState:   null,
    afterState:    { status: 'open', priority: 'high' },
    source:        'api',
    traceId:       'trace-audit-001',
    createdAt:     new Date('2025-02-01T10:00:00Z'),
  },
  {
    id:            'al000002-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_A,
    actorKind:     'staff',
    actorId:       AUDIT_ACTOR_AGENT,
    resourceType:  'ticket',
    resourceId:    AUDIT_RESOURCE_TICKET_1,
    action:        'update',
    eventType:     'ticket.updated',
    changedFields: ['status', 'assignee_id'],
    beforeState:   { status: 'open' },
    afterState:    { status: 'in_progress' },
    source:        'api',
    traceId:       'trace-audit-002',
    createdAt:     new Date('2025-02-01T11:00:00Z'),
  },
  {
    id:            'al000003-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_A,
    actorKind:     'staff',
    actorId:       AUDIT_ACTOR_AGENT,
    resourceType:  'ticket',
    resourceId:    AUDIT_RESOURCE_TICKET_1,
    action:        'resolve',
    eventType:     'ticket.resolved',
    changedFields: ['status', 'resolved_at'],
    beforeState:   { status: 'in_progress' },
    afterState:    { status: 'resolved' },
    source:        'api',
    traceId:       'trace-audit-003',
    createdAt:     new Date('2025-02-02T09:00:00Z'),
  },
  {
    id:            'al000004-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_A,
    actorKind:     'staff',
    actorId:       AUDIT_ACTOR_ADMIN,
    resourceType:  'ticket',
    resourceId:    AUDIT_RESOURCE_TICKET_2,
    action:        'create',
    eventType:     'ticket.created',
    changedFields: [],
    beforeState:   null,
    afterState:    { status: 'open', priority: 'low' },
    source:        'api',
    traceId:       'trace-audit-004',
    createdAt:     new Date('2025-02-03T14:00:00Z'),
  },
  {
    id:            'al000005-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_A,
    actorKind:     'machine',
    actorId:       AUDIT_ACTOR_MACHINE,
    resourceType:  'webhook_endpoint',
    resourceId:    AUDIT_RESOURCE_WEBHOOK_1,
    action:        'create',
    eventType:     'webhook.created',
    changedFields: [],
    beforeState:   null,
    afterState:    { url: 'https://example.invalid/hook' },
    source:        'jira-sync',
    traceId:       'trace-audit-005',
    createdAt:     new Date('2025-02-04T08:00:00Z'),
  },

  // Tenant A — actor admin additional events
  {
    id:            'al000006-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_A,
    actorKind:     'staff',
    actorId:       AUDIT_ACTOR_ADMIN,
    resourceType:  'webhook_endpoint',
    resourceId:    AUDIT_RESOURCE_WEBHOOK_1,
    action:        'update',
    eventType:     'webhook.updated',
    changedFields: ['url', 'secret_hash'],
    beforeState:   { url: 'https://example.invalid/hook' },
    afterState:    { url: 'https://example.invalid/hook-v2' },
    source:        'api',
    traceId:       'trace-audit-006',
    createdAt:     new Date('2025-02-05T16:00:00Z'),
  },

  // Tenant B — cross-tenant isolation fixture
  {
    id:            'al000007-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_B,
    actorKind:     'staff',
    actorId:       'ub000001-0000-0000-0000-000000000001',
    resourceType:  'ticket',
    resourceId:    'tkb00001-0000-0000-0000-000000000001',
    action:        'create',
    eventType:     'ticket.created',
    changedFields: [],
    beforeState:   null,
    afterState:    { status: 'open' },
    source:        'api',
    traceId:       'trace-audit-b01',
    createdAt:     new Date('2025-02-01T10:30:00Z'),
  },
  {
    id:            'al000008-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_B,
    actorKind:     'staff',
    actorId:       'ub000001-0000-0000-0000-000000000001',
    resourceType:  'ticket',
    resourceId:    'tkb00002-0000-0000-0000-000000000001',
    action:        'update',
    eventType:     'ticket.updated',
    changedFields: ['status'],
    beforeState:   { status: 'open' },
    afterState:    { status: 'resolved' },
    source:        'api',
    traceId:       'trace-audit-b02',
    createdAt:     new Date('2025-02-02T12:00:00Z'),
  },

  // Tenant A — for changed_field filter test
  {
    id:            'al000009-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_A,
    actorKind:     'staff',
    actorId:       AUDIT_ACTOR_AGENT,
    resourceType:  'ticket',
    resourceId:    AUDIT_RESOURCE_TICKET_2,
    action:        'update',
    eventType:     'ticket.updated',
    changedFields: ['priority', 'custom_fields.category'],
    beforeState:   { priority: 'low' },
    afterState:    { priority: 'medium' },
    source:        'api',
    traceId:       'trace-audit-009',
    createdAt:     new Date('2025-02-06T10:00:00Z'),
  },
  {
    id:            'al000010-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_A,
    actorKind:     'portal',
    actorId:       AUDIT_CONTACT_SUBJECT,
    resourceType:  'portal_user',
    resourceId:    AUDIT_CONTACT_SUBJECT,
    action:        'login',
    eventType:     'portal_user.login',
    changedFields: [],
    beforeState:   null,
    afterState:    null,
    source:        'portal',
    traceId:       'trace-audit-010',
    createdAt:     new Date('2025-02-07T09:00:00Z'),
  },
];

// ---------------------------------------------------------------------------
// Tampered chain — for chain-verify tests
// ---------------------------------------------------------------------------

/**
 * A set of audit records where one record has been tampered (the action field
 * changed from 'create' to 'delete' after insertion).  The verify endpoint
 * should detect the chain break.
 */
export const TAMPERED_CHAIN_FIXTURES: AuditLogFixture[] = [
  {
    ...AUDIT_LOG_FIXTURES[0]!,
    id:        'tc000001-0000-0000-0000-000000000001',
    createdAt: new Date('2025-01-15T10:00:00Z'),
  },
  {
    // This record has been tampered — action changed post-insertion.
    id:            'tc000002-0000-0000-0000-000000000001',
    tenantId:      AUDIT_TENANT_A,
    actorKind:     'staff',
    actorId:       AUDIT_ACTOR_ADMIN,
    resourceType:  'ticket',
    resourceId:    AUDIT_RESOURCE_TICKET_1,
    action:        'delete',      // was 'update' — tampered!
    eventType:     'ticket.updated',
    changedFields: ['status'],
    beforeState:   { status: 'open' },
    afterState:    { status: 'closed' },
    source:        'api',
    traceId:       'trace-tampered',
    createdAt:     new Date('2025-01-15T11:00:00Z'),
  },
];

// ---------------------------------------------------------------------------
// Subject fixtures — for access/portability export tests
// ---------------------------------------------------------------------------

export const SUBJECT_TENANT_ID  = AUDIT_TENANT_A;
export const SUBJECT_CONTACT_ID = AUDIT_CONTACT_SUBJECT;
export const SUBJECT_EMAIL      = 'subject-export@example.invalid';

/** Ticket belonging to the export subject. */
export const SUBJECT_TICKET = {
  id:             'stk00001-0000-0000-0000-000000000001',
  tenantId:       SUBJECT_TENANT_ID,
  contactId:      SUBJECT_CONTACT_ID,
  subject:        'Need help with my account',
  status:         'open',
  priority:       'medium',
  createdAt:      new Date('2025-02-01T10:00:00Z'),
};

/** Public comment — must appear in portal exports. */
export const SUBJECT_PUBLIC_COMMENT = {
  id:         'scm00001-0000-0000-0000-000000000001',
  ticketId:   SUBJECT_TICKET.id,
  authorId:   SUBJECT_CONTACT_ID,
  body:       'Please help me reset my account password.',
  visibility: 'public',
  createdAt:  new Date('2025-02-01T10:05:00Z'),
};

/** Internal comment — must NEVER appear in portal exports. */
export const SUBJECT_INTERNAL_COMMENT = {
  id:         'scm00002-0000-0000-0000-000000000001',
  ticketId:   SUBJECT_TICKET.id,
  authorId:   AUDIT_ACTOR_AGENT,
  body:       'INTERNAL NOTE: customer flagged for fraud review',
  visibility: 'internal',
  createdAt:  new Date('2025-02-01T10:10:00Z'),
};

/** CSAT survey response for the subject. */
export const SUBJECT_CSAT = {
  id:          'scs00001-0000-0000-0000-000000000001',
  tenantId:    SUBJECT_TENANT_ID,
  contactId:   SUBJECT_CONTACT_ID,
  score:       4,
  comment:     'Issue resolved quickly, thanks.',
  respondedAt: new Date('2025-02-02T12:00:00Z'),
  createdAt:   new Date('2025-02-02T12:00:00Z'),
};

// ---------------------------------------------------------------------------
// Expected export shapes for assertion in tests
// ---------------------------------------------------------------------------

/** Tables that MUST appear in a staff access export. */
export const STAFF_EXPORT_REQUIRED_TABLES = [
  'contacts',
  'tickets',
  'ticket_comments',
  'ticket_attachments',
  'csat_surveys',
  'audit_logs',
  'notifications',
];

/** Tables that MUST appear in a portal access export. */
export const PORTAL_EXPORT_REQUIRED_TABLES = [
  'contacts',
  'tickets',
  'ticket_comments',  // public only
  'ticket_attachments',
  'csat_surveys',
  'notifications',
];

/** Internal notes must NEVER appear in portal exports. */
export const PORTAL_EXPORT_FORBIDDEN_CONTENT = [
  'INTERNAL NOTE',
  'fraud review',
];
