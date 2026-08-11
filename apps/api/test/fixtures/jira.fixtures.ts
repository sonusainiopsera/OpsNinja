/**
 * Test fixtures for WO-051 — Jira connection tests.
 *
 * Deterministic UUIDs ensure reproducible tests and clear entity boundaries.
 */

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export const JIRA_FIXTURE_TENANT_A = 'f1000001-0000-0000-0000-000000000001';
export const JIRA_FIXTURE_TENANT_B = 'f1000001-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const JIRA_FIXTURE_ADMIN_A = 'f1000002-0000-0000-0000-000000000001';
export const JIRA_FIXTURE_ADMIN_B = 'f1000002-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export const JIRA_CONNECTION_ID_A = 'f1000003-0000-0000-0000-000000000001';
export const JIRA_CONNECTION_ID_B = 'f1000003-0000-0000-0000-000000000002';

/** Cloud Jira connection for tenant A (oauth3lo). */
export const JIRA_CONNECTION_CLOUD_A = {
  id: JIRA_CONNECTION_ID_A,
  tenantId: JIRA_FIXTURE_TENANT_A,
  siteUrl: 'https://acme.atlassian.net',
  cloudId: 'cloud-abc-123',
  authMethod: 'oauth3lo' as const,
  scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
  secretRef: 'opsninja/f1000001-tenant-a/jira/conn-a',
  state: 'active' as const,
};

/** Data Center connection for tenant B (api_token). */
export const JIRA_CONNECTION_DC_B = {
  id: JIRA_CONNECTION_ID_B,
  tenantId: JIRA_FIXTURE_TENANT_B,
  siteUrl: 'https://jira.company.internal',
  cloudId: null,
  authMethod: 'api_token' as const,
  scopes: [],
  secretRef: 'opsninja/f1000001-tenant-b/jira/conn-b',
  state: 'active' as const,
};

// ---------------------------------------------------------------------------
// Invalid DTOs (for DTO validation tests)
// ---------------------------------------------------------------------------

export const INVALID_API_TOKEN_MISSING_SITE = {
  email: 'admin@company.com',
  apiToken: 'ATATT...',
  // siteUrl missing
};

export const INVALID_API_TOKEN_BAD_URL = {
  siteUrl: 'not-a-url',
  email: 'admin@company.com',
  apiToken: 'ATATT...',
};

export const INVALID_API_TOKEN_UNKNOWN_FIELD = {
  siteUrl: 'https://jira.internal',
  email: 'admin@company.com',
  apiToken: 'ATATT...',
  secretKey: 'should-be-rejected', // strict mode
};

// ---------------------------------------------------------------------------
// Canned Jira API responses (for MSW/nock mocking)
// ---------------------------------------------------------------------------

export const CANNED_ACCESSIBLE_RESOURCES = [
  {
    id: 'cloud-abc-123',
    url: 'https://acme.atlassian.net',
    name: 'Acme Corp',
    scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user'],
    avatarUrl: 'https://site-admin-avatar-cdn.prod.public.atl-paas.net/acme.png',
  },
];

export const CANNED_TOKEN_RESPONSE = {
  access_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.stub',
  refresh_token: 'xxxxxxxxxx-stub-refresh-token-xxxxxxxxxx',
  expires_in: 3600,
  scope: 'read:jira-work write:jira-work read:jira-user offline_access',
  token_type: 'Bearer',
};

export const CANNED_SERVER_INFO = {
  version: '9.12.0',
  deploymentType: 'Server',
  baseUrl: 'https://acme.atlassian.net',
};
