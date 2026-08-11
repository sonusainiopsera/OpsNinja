/**
 * Shared fixtures for audit-related tests.
 * Covers: Jira webhook payload, OIDC callback claims, SLA timer row,
 * and an org record with JSONB custom fields.
 */

/** Jira issue-updated webhook envelope (redaction-relevant: no personal data). */
export const JIRA_WEBHOOK_PAYLOAD = {
  webhookEvent: 'jira:issue_updated',
  issue: {
    id: '10042',
    key: 'OPS-123',
    fields: {
      summary: 'Fix login timeout',
      status: { name: 'In Progress' },
      priority: { name: 'High' },
      assignee: {
        accountId: 'abc123',
        emailAddress: 'engineer@example.com',  // PII — should be redacted
        displayName: 'Alice Engineer',
      },
    },
  },
  changelog: {
    items: [
      { field: 'status', fromString: 'Open', toString: 'In Progress' },
    ],
  },
};

/** OIDC id_token claims (redaction-relevant: email, IP). */
export const OIDC_ID_TOKEN_CLAIMS = {
  sub: 'auth0|user-0001',
  email: 'user@example.com',           // PII — should be redacted
  email_verified: true,
  iss: 'https://auth.opsninja.example.com/',
  aud: 'opsninja-api',
  iat: 1_700_000_000,
  exp: 1_700_003_600,
  ip: '203.0.113.45',                  // PII — should be redacted
  nonce: 'random-nonce-value',
};

/** SLA timer row snapshot — before/after for audit diff. */
export const SLA_TIMER_BEFORE = {
  id: 'sla-001',
  ticketId: 'tkt-999',
  policy: 'business_hours_4h',
  status: 'running',
  breachAt: '2024-01-15T14:00:00.000Z',
  pausedAt: null,
};

export const SLA_TIMER_AFTER = {
  id: 'sla-001',
  ticketId: 'tkt-999',
  policy: 'business_hours_4h',
  status: 'paused',
  breachAt: '2024-01-15T14:00:00.000Z',
  pausedAt: '2024-01-15T10:30:00.000Z',
};

/** Expected changed fields for SLA_TIMER_BEFORE → SLA_TIMER_AFTER. */
export const SLA_TIMER_CHANGED_FIELDS = ['status', 'pausedAt'];

/** Organization record with JSONB custom_fields (nested diff scenario). */
export const ORG_WITH_CUSTOM_FIELDS_BEFORE = {
  id: 'org-007',
  name: 'Acme Corp',
  plan: 'enterprise',
  custom_fields: {
    cloud_provider: 'aws',
    region: 'us-east-1',
    sso_enabled: true,
    contract_ends: '2025-12-31',
  },
};

export const ORG_WITH_CUSTOM_FIELDS_AFTER = {
  id: 'org-007',
  name: 'Acme Corp',
  plan: 'enterprise',
  custom_fields: {
    cloud_provider: 'gcp',      // changed
    region: 'us-east-1',        // unchanged
    sso_enabled: true,           // unchanged
    contract_ends: '2026-12-31', // changed
  },
};

/** Expected changed fields for nested custom_fields diff. */
export const ORG_CUSTOM_FIELDS_CHANGED = [
  'custom_fields.cloud_provider',
  'custom_fields.contract_ends',
];

/** Webhook endpoint snapshot — contains signing_key (must be redacted). */
export const WEBHOOK_ENDPOINT_BEFORE = {
  id: 'wh-001',
  tenantId: 'tenant-1',
  url: 'https://example.com/webhook',
  status: 'active',
  signing_key: 'whsec_supersecretvalue123',   // must be redacted
  eventTypes: ['ticket.created'],
};

export const WEBHOOK_ENDPOINT_AFTER = {
  id: 'wh-001',
  tenantId: 'tenant-1',
  url: 'https://example.com/webhook',
  status: 'inactive',
  signing_key: 'whsec_supersecretvalue123',   // must be redacted
  eventTypes: ['ticket.created'],
};
