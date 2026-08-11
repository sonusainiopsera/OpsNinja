/**
 * Audit test fixtures.
 *
 * Provides committed fixture data for audit-related tests so the suite
 * runs with no external service dependencies.
 *
 * Includes:
 *  - Jira webhook payload (issue transitioned to "In Progress")
 *  - OIDC callback claim set
 *  - SLA timer row
 *  - Organization with JSONB custom fields
 */

// ---------------------------------------------------------------------------
// Tenant / actor identifiers
// ---------------------------------------------------------------------------

export const TENANT_A = 'aaaaaaaa-0000-0000-0000-000000000001';
export const TENANT_B = 'bbbbbbbb-0000-0000-0000-000000000002';

export const ACTOR_STAFF = 'user-staff-0000-0000-000000000001';
export const ACTOR_PORTAL = 'user-portal-000-0000-000000000002';
export const ACTOR_MACHINE = 'machine-jira-00-0000-000000000003';

// ---------------------------------------------------------------------------
// Jira webhook payload
// ---------------------------------------------------------------------------

export const JIRA_WEBHOOK_TRANSITION_PAYLOAD = {
  webhookEvent: 'jira:issue_updated',
  issue_event_type_name: 'issue_generic',
  issue: {
    id: '10042',
    key: 'OPS-123',
    fields: {
      summary: 'Portal login fails intermittently',
      status: {
        name: 'In Progress',
        id: '3',
      },
      assignee: {
        accountId: 'jira-user-abc',
        displayName: 'Jane Smith',
      },
      priority: { name: 'High' },
      customfield_10001: 'customer-org-uuid',
    },
  },
  changelog: {
    items: [
      {
        field: 'status',
        fromString: 'Open',
        toString: 'In Progress',
      },
    ],
  },
  timestamp: 1700000000000,
};

export const JIRA_ENVELOPE = {
  messageId: 'sqs-msg-jira-0001',
  tenantId: TENANT_A,
  actorId: ACTOR_MACHINE,
  actorType: 'integration' as const,
  source: 'jira-sync-worker',
};

// ---------------------------------------------------------------------------
// OIDC callback claim set
// ---------------------------------------------------------------------------

export const OIDC_CLAIMS = {
  sub: 'oidc-sub-00000001',
  iss: 'https://auth.example.com',
  aud: 'opsninja-api',
  exp: Math.floor(Date.now() / 1000) + 3600,
  iat: Math.floor(Date.now() / 1000),
  email: 'agent@example.com',
  email_verified: true,
  name: 'Support Agent',
  'https://opsninja.io/tenant_id': TENANT_A,
  'https://opsninja.io/roles': ['support_agent'],
  'https://opsninja.io/org_scope_ids': [],
};

// ---------------------------------------------------------------------------
// SLA timer row
// ---------------------------------------------------------------------------

export const SLA_TIMER_ROW = {
  id: 'sla-timer-00000001',
  tenantId: TENANT_A,
  ticketId: 'ticket-00000001',
  policy: 'standard_response',
  breachAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  reminderSentAt: null,
  breachedAt: null,
  createdAt: new Date().toISOString(),
};

export const SLA_ENVELOPE = {
  messageId: 'sqs-msg-sla-0001',
  tenantId: TENANT_A,
  actorId: null,
  actorType: 'system' as const,
  source: 'sla-scheduler',
};

// ---------------------------------------------------------------------------
// Organization with JSONB custom fields
// ---------------------------------------------------------------------------

export const ORG_WITH_CUSTOM_FIELDS = {
  id: 'org-00000001',
  tenantId: TENANT_A,
  name: 'Acme Corp',
  tier: 'enterprise',
  active: true,
  customFields: {
    cloud_provider: 'aws',
    region: 'us-east-1',
    contract_tier: 'gold',
    support_email: 'support@acme.com',
    notes: 'VIP customer — escalate all P1 immediately',
  },
};

export const ORG_AFTER_PATCH = {
  ...ORG_WITH_CUSTOM_FIELDS,
  customFields: {
    ...ORG_WITH_CUSTOM_FIELDS.customFields,
    cloud_provider: 'gcp',
    region: 'eu-west-1',
  },
};

// Expected changed fields after patching cloud_provider and region
export const EXPECTED_ORG_CHANGED_FIELDS = [
  'customFields.cloud_provider',
  'customFields.region',
].sort();

// ---------------------------------------------------------------------------
// Audit context fixtures
// ---------------------------------------------------------------------------

export const STAFF_AUDIT_CONTEXT = {
  tenantId: TENANT_A,
  actorId: ACTOR_STAFF,
  actorType: 'user' as const,
  actorRole: 'support_agent',
  traceId: 'trace-test-00001',
  requestId: 'req-test-00001',
  ipHash: 'a'.repeat(64),
  userAgent: 'TestAgent/1.0',
  source: null as string | null,
};

export const WORKER_AUDIT_CONTEXT = {
  tenantId: TENANT_A,
  actorId: ACTOR_MACHINE,
  actorType: 'integration' as const,
  actorRole: null as string | null,
  traceId: 'sqs-msg-jira-0001',
  requestId: 'sqs-msg-jira-0001',
  ipHash: null as string | null,
  userAgent: null as string | null,
  source: 'jira-sync-worker',
};
