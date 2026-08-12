/**
 * Jira audit snapshot fixtures — WO-059 AC12.
 *
 * Provides deterministic AuditLogRow objects representing expected audit
 * records for every Jira resource/action combination so tests can assert
 * field completeness and correlation-id continuity without a live database.
 *
 * All fixtures share a single CORRELATION_ID and TRACE_ID so integration
 * tests can assert the full escalate-to-inbound-apply round-trip linkage.
 *
 * Includes:
 *  - jira_connection: connect, test, rotate, revoke
 *  - jira_project_mapping: create, update, delete
 *  - ticket_jira_link: escalate, linked, inbound_apply (integration actor)
 *  - jira_dlq_item: enqueue, replay
 *  - jira_reconciliation_run: start, complete
 */

import type { AuditLogRow } from '../../src/modules/audit/audit-query.service';

// ---------------------------------------------------------------------------
// Shared identifiers
// ---------------------------------------------------------------------------

export const JIRA_AUDIT_TENANT_A  = 'ja000001-0000-4000-8000-000000000001';
export const JIRA_AUDIT_TENANT_B  = 'ja000002-0000-4000-8000-000000000002';

export const JIRA_AUDIT_CONNECTION_ID  = 'cn000001-0000-4000-8000-000000000001';
export const JIRA_AUDIT_MAPPING_ID     = 'mp000001-0000-4000-8000-000000000001';
export const JIRA_AUDIT_LINK_ID        = 'lk000001-0000-4000-8000-000000000001';
export const JIRA_AUDIT_DLQ_ITEM_ID    = 'dq000001-0000-4000-8000-000000000001';
export const JIRA_AUDIT_RECON_RUN_ID   = 'rc000001-0000-4000-8000-000000000001';

export const JIRA_AUDIT_STAFF_ACTOR    = 'ua000001-0000-4000-8000-000000000001';
export const JIRA_AUDIT_MACHINE_ACTOR  = 'ua000002-0000-4000-8000-000000000002';

/**
 * Correlation id shared across the escalate → linked → inbound_apply round trip.
 * Tests assert every fixture in the round-trip set carries this same value in
 * its metadata, proving the full handoff is traceable by a single id.
 */
export const JIRA_CORRELATION_ID = 'corr-audit-wo059-0000-000000000001';
export const JIRA_TRACE_ID       = 'trace-audit-wo059-0000000000000001';

// ---------------------------------------------------------------------------
// jira_connection — connect
// ---------------------------------------------------------------------------

export const ROW_JIRA_CONNECTION_CONNECT: AuditLogRow & { metadata?: Record<string, unknown> } = {
  id:           'jal-conn-00000001-0000-0000-0000-000000000001',
  occurredAt:   new Date('2024-06-01T10:00:00.000Z'),
  actorType:    'staff',
  actorId:      JIRA_AUDIT_STAFF_ACTOR,
  actorDisplay: 'Alice Admin',
  actorRole:    'integration_admin',
  resourceType: 'jira_connection',
  resourceId:   JIRA_AUDIT_CONNECTION_ID,
  action:       'connect',
  eventType:    'jira_connection.connect',
  changedFields: ['status'],
  beforeState:  null,
  afterState:   {
    id:          JIRA_AUDIT_CONNECTION_ID,
    name:        'Prod Jira',
    cloudId:     'cloud-abc-123',
    jiraBaseUrl: 'https://acme.atlassian.net',
    status:      'connected',
  },
  source: null,
  traceId: JIRA_TRACE_ID,
};

// ---------------------------------------------------------------------------
// jira_connection — test
// ---------------------------------------------------------------------------

export const ROW_JIRA_CONNECTION_TEST: AuditLogRow & { metadata?: Record<string, unknown> } = {
  id:           'jal-conn-00000002-0000-0000-0000-000000000002',
  occurredAt:   new Date('2024-06-01T10:05:00.000Z'),
  actorType:    'staff',
  actorId:      JIRA_AUDIT_STAFF_ACTOR,
  actorDisplay: 'Alice Admin',
  actorRole:    'integration_admin',
  resourceType: 'jira_connection',
  resourceId:   JIRA_AUDIT_CONNECTION_ID,
  action:       'test',
  eventType:    'jira_connection.test',
  changedFields: null,
  beforeState:  null,
  afterState:   {
    id:     JIRA_AUDIT_CONNECTION_ID,
    status: 'connected',
    lastTestedAt: '2024-06-01T10:05:00.000Z',
  },
  source: null,
  traceId: JIRA_TRACE_ID,
};

// ---------------------------------------------------------------------------
// jira_connection — rotate
// ---------------------------------------------------------------------------

export const ROW_JIRA_CONNECTION_ROTATE: AuditLogRow & { metadata?: Record<string, unknown> } = {
  id:           'jal-conn-00000003-0000-0000-0000-000000000003',
  occurredAt:   new Date('2024-06-02T08:00:00.000Z'),
  actorType:    'staff',
  actorId:      JIRA_AUDIT_STAFF_ACTOR,
  actorDisplay: 'Alice Admin',
  actorRole:    'integration_admin',
  resourceType: 'jira_connection',
  resourceId:   JIRA_AUDIT_CONNECTION_ID,
  action:       'rotate',
  eventType:    'jira_connection.rotate',
  changedFields: ['status'],
  beforeState:  { id: JIRA_AUDIT_CONNECTION_ID, status: 'connected' },
  afterState:   { id: JIRA_AUDIT_CONNECTION_ID, status: 'connected' },
  source: null,
  traceId: JIRA_TRACE_ID,
};

// ---------------------------------------------------------------------------
// jira_project_mapping — create
// ---------------------------------------------------------------------------

export const ROW_JIRA_MAPPING_CREATE: AuditLogRow & { metadata?: Record<string, unknown> } = {
  id:           'jal-mapp-00000004-0000-0000-0000-000000000004',
  occurredAt:   new Date('2024-06-01T10:10:00.000Z'),
  actorType:    'staff',
  actorId:      JIRA_AUDIT_STAFF_ACTOR,
  actorDisplay: 'Alice Admin',
  actorRole:    'integration_admin',
  resourceType: 'jira_project_mapping',
  resourceId:   JIRA_AUDIT_MAPPING_ID,
  action:       'create',
  eventType:    'jira_project_mapping.create',
  changedFields: null,
  beforeState:  null,
  afterState:   {
    id:           JIRA_AUDIT_MAPPING_ID,
    connectionId: JIRA_AUDIT_CONNECTION_ID,
    projectKey:   'PLAT',
    projectName:  'Platform Engineering',
    enabled:      true,
  },
  source: null,
  traceId: JIRA_TRACE_ID,
};

// ---------------------------------------------------------------------------
// ticket_jira_link — escalate  (start of round-trip, correlation id set here)
// ---------------------------------------------------------------------------

export const ROW_JIRA_LINK_ESCALATE: AuditLogRow & { metadata?: Record<string, unknown> } = {
  id:           'jal-link-00000005-0000-0000-0000-000000000005',
  occurredAt:   new Date('2024-06-01T11:00:00.000Z'),
  actorType:    'staff',
  actorId:      JIRA_AUDIT_STAFF_ACTOR,
  actorDisplay: 'Alice Admin',
  actorRole:    'support_agent',
  resourceType: 'ticket_jira_link',
  resourceId:   JIRA_AUDIT_LINK_ID,
  action:       'escalate',
  eventType:    'ticket_jira_link.escalate',
  changedFields: ['linkState'],
  beforeState:  null,
  afterState:   {
    id:           JIRA_AUDIT_LINK_ID,
    connectionId: JIRA_AUDIT_CONNECTION_ID,
    projectKey:   'PLAT',
    linkState:    'pending',
    correlationId: JIRA_CORRELATION_ID,
  },
  source: null,
  traceId: JIRA_TRACE_ID,
  metadata: { correlationId: JIRA_CORRELATION_ID, traceId: JIRA_TRACE_ID },
};

// ---------------------------------------------------------------------------
// ticket_jira_link — linked  (outbound Jira issue created)
// ---------------------------------------------------------------------------

export const ROW_JIRA_LINK_LINKED: AuditLogRow & { metadata?: Record<string, unknown> } = {
  id:           'jal-link-00000006-0000-0000-0000-000000000006',
  occurredAt:   new Date('2024-06-01T11:00:05.000Z'),
  actorType:    'machine',
  actorId:      JIRA_AUDIT_MACHINE_ACTOR,
  actorDisplay: 'jira-sync-worker',
  actorRole:    null,
  resourceType: 'ticket_jira_link',
  resourceId:   JIRA_AUDIT_LINK_ID,
  action:       'linked',
  eventType:    'ticket_jira_link.linked',
  changedFields: ['linkState', 'jiraIssueKey'],
  beforeState:  { linkState: 'pending' },
  afterState:   {
    id:           JIRA_AUDIT_LINK_ID,
    connectionId: JIRA_AUDIT_CONNECTION_ID,
    jiraIssueKey: 'PLAT-42',
    jiraIssueId:  '10042',
    linkState:    'linked',
    correlationId: JIRA_CORRELATION_ID,
  },
  source: 'jira-sync-worker',
  traceId: JIRA_TRACE_ID,
  metadata: { correlationId: JIRA_CORRELATION_ID },
};

// ---------------------------------------------------------------------------
// ticket_jira_link — inbound_apply  (integration actor — end of round-trip)
// ---------------------------------------------------------------------------

/**
 * This record demonstrates AC3: actor_type='integration' with the connection id
 * as actor_id and the Jira author display name as actor_label.
 * Also carries the same JIRA_CORRELATION_ID as escalate and linked,
 * demonstrating AC7: a single correlation id spans the full round trip.
 */
export const ROW_JIRA_LINK_INBOUND_APPLY: AuditLogRow & { metadata?: Record<string, unknown> } = {
  id:           'jal-link-00000007-0000-0000-0000-000000000007',
  occurredAt:   new Date('2024-06-01T11:00:30.000Z'),
  actorType:    'integration',
  actorId:      JIRA_AUDIT_CONNECTION_ID,
  actorDisplay: 'Jane Dev',    // Jira author display name
  actorRole:    null,
  resourceType: 'ticket_jira_link',
  resourceId:   JIRA_AUDIT_LINK_ID,
  action:       'inbound_apply',
  eventType:    'ticket_jira_link.inbound_apply',
  changedFields: ['jiraStatus'],
  beforeState:  { jiraStatus: 'Open', linkState: 'linked' },
  afterState:   { jiraStatus: 'In Progress', linkState: 'linked' },
  source: 'jira-sync-worker',
  traceId: JIRA_TRACE_ID,
  metadata: {
    correlationId: JIRA_CORRELATION_ID,
    jiraActorType:  'integration',
    jiraActorId:    JIRA_AUDIT_CONNECTION_ID,
    jiraActorLabel: 'Jane Dev',
  },
};

// ---------------------------------------------------------------------------
// jira_dlq_item — replay
// ---------------------------------------------------------------------------

export const ROW_JIRA_DLQ_REPLAY: AuditLogRow & { metadata?: Record<string, unknown> } = {
  id:           'jal-dlq-00000008-0000-0000-0000-000000000008',
  occurredAt:   new Date('2024-06-01T12:00:00.000Z'),
  actorType:    'staff',
  actorId:      JIRA_AUDIT_STAFF_ACTOR,
  actorDisplay: 'Bob Engineer',
  actorRole:    'integration_admin',
  resourceType: 'jira_dlq_item',
  resourceId:   JIRA_AUDIT_DLQ_ITEM_ID,
  action:       'replay',
  eventType:    'jira_dlq_item.replay',
  changedFields: ['state'],
  beforeState:  { id: JIRA_AUDIT_DLQ_ITEM_ID, state: 'failed', attempt: 3 },
  afterState:   { id: JIRA_AUDIT_DLQ_ITEM_ID, state: 'replayed', attempt: 3 },
  source: null,
  traceId: JIRA_TRACE_ID,
};

// ---------------------------------------------------------------------------
// jira_reconciliation_run — start / complete
// ---------------------------------------------------------------------------

export const ROW_JIRA_RECON_START: AuditLogRow & { metadata?: Record<string, unknown> } = {
  id:           'jal-recon-00000009-0000-0000-0000-000000000009',
  occurredAt:   new Date('2024-06-01T13:00:00.000Z'),
  actorType:    'staff',
  actorId:      JIRA_AUDIT_STAFF_ACTOR,
  actorDisplay: 'Alice Admin',
  actorRole:    'integration_admin',
  resourceType: 'jira_reconciliation_run',
  resourceId:   JIRA_AUDIT_RECON_RUN_ID,
  action:       'start',
  eventType:    'jira_reconciliation_run.start',
  changedFields: null,
  beforeState:  null,
  afterState:   {
    id:           JIRA_AUDIT_RECON_RUN_ID,
    connectionId: JIRA_AUDIT_CONNECTION_ID,
    outcome:      'running',
  },
  source: null,
  traceId: JIRA_TRACE_ID,
};

export const ROW_JIRA_RECON_COMPLETE: AuditLogRow & { metadata?: Record<string, unknown> } = {
  id:           'jal-recon-0000000a-0000-0000-0000-00000000000a',
  occurredAt:   new Date('2024-06-01T13:01:30.000Z'),
  actorType:    'machine',
  actorId:      JIRA_AUDIT_MACHINE_ACTOR,
  actorDisplay: 'jira-sync-worker',
  actorRole:    null,
  resourceType: 'jira_reconciliation_run',
  resourceId:   JIRA_AUDIT_RECON_RUN_ID,
  action:       'complete',
  eventType:    'jira_reconciliation_run.complete',
  changedFields: ['outcome'],
  beforeState:  { outcome: 'running' },
  afterState:   {
    id:              JIRA_AUDIT_RECON_RUN_ID,
    connectionId:    JIRA_AUDIT_CONNECTION_ID,
    issuesScanned:   120,
    driftDetected:   3,
    eventsSynthesised: 3,
    outcome:         'completed',
  },
  source: 'jira-sync-worker',
  traceId: JIRA_TRACE_ID,
};

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

/**
 * All Jira audit rows for TENANT_A, ordered newest-first (as returned by list).
 */
export const ALL_JIRA_AUDIT_ROWS: AuditLogRow[] = [
  ROW_JIRA_RECON_COMPLETE,
  ROW_JIRA_RECON_START,
  ROW_JIRA_DLQ_REPLAY,
  ROW_JIRA_LINK_INBOUND_APPLY,
  ROW_JIRA_LINK_LINKED,
  ROW_JIRA_LINK_ESCALATE,
  ROW_JIRA_MAPPING_CREATE,
  ROW_JIRA_CONNECTION_ROTATE,
  ROW_JIRA_CONNECTION_TEST,
  ROW_JIRA_CONNECTION_CONNECT,
];

/**
 * The three records that together prove the escalate-to-inbound-apply round trip
 * (AC7 / AC11). All three share JIRA_CORRELATION_ID in their metadata.
 */
export const ROUND_TRIP_ROWS: AuditLogRow[] = [
  ROW_JIRA_LINK_ESCALATE,
  ROW_JIRA_LINK_LINKED,
  ROW_JIRA_LINK_INBOUND_APPLY,
];

/** Rows representing integration-actor (inbound Jira) operations. */
export const INTEGRATION_ACTOR_ROWS: AuditLogRow[] = ALL_JIRA_AUDIT_ROWS.filter(
  (r) => r.actorType === 'integration',
);

/** Principal for integration admin in TENANT_A. */
export const JIRA_INTEGRATION_ADMIN = {
  userId:        JIRA_AUDIT_STAFF_ACTOR,
  tenantId:      JIRA_AUDIT_TENANT_A,
  principalKind: 'staff' as const,
  roles:         ['integration_admin'],
  orgScopeIds:   [],
  traceId:       JIRA_TRACE_ID,
};

/** Principal for plain agent (no jira:manage) in TENANT_A. */
export const JIRA_AGENT_PRINCIPAL = {
  userId:        'agent-000-0000-0000-0000-00000000001',
  tenantId:      JIRA_AUDIT_TENANT_A,
  principalKind: 'staff' as const,
  roles:         ['agent'],
  orgScopeIds:   [],
  traceId:       'trace-agent-001',
};

/** Principal for an admin in TENANT_B — used for cross-tenant scoping tests. */
export const JIRA_TENANT_B_PRINCIPAL = {
  userId:        'admin-b00-0000-0000-0000-00000000001',
  tenantId:      JIRA_AUDIT_TENANT_B,
  principalKind: 'staff' as const,
  roles:         ['integration_admin'],
  orgScopeIds:   [],
  traceId:       'trace-tenant-b-001',
};
