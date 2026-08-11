/**
 * Fixture data for Jira connections integration tests.
 *
 * Two tenants with one active connection each.
 * Tenant A uses OAuth 3LO; Tenant B uses API token.
 * Two distinct cloud IDs enforce the global unique constraint.
 */

export const JIRA_FIXTURE_TENANT_A = '10000000-0000-0000-0000-000000000001';
export const JIRA_FIXTURE_TENANT_B = '20000000-0000-0000-0000-000000000002';
export const JIRA_FIXTURE_ACTOR_A  = 'aaaa0000-0000-0000-0000-000000000010';
export const JIRA_FIXTURE_ACTOR_B  = 'bbbb0000-0000-0000-0000-000000000020';

/** Canned Jira cloud IDs — globally unique across all tenants. */
export const CLOUD_ID_A = 'cloudid-tenant-a-atlas-1234';
export const CLOUD_ID_B = 'cloudid-tenant-b-atlas-5678';

export const FIXTURE_CONNECTION_A = {
  id:              'cc000000-0000-0000-0000-000000000001',
  tenantId:        JIRA_FIXTURE_TENANT_A,
  siteUrl:         'https://acme.atlassian.net',
  cloudId:         CLOUD_ID_A,
  authMethod:      'oauth3lo' as const,
  scopes:          ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
  secretRef:       `jira/${JIRA_FIXTURE_TENANT_A}/cc000000-0000-0000-0000-000000000001`,
  tokenExpiresAt:  new Date('2026-09-01T00:00:00Z'),
  state:           'active' as const,
  lastTestedAt:    new Date('2026-08-10T12:00:00Z'),
  createdBy:       JIRA_FIXTURE_ACTOR_A,
  updatedBy:       JIRA_FIXTURE_ACTOR_A,
};

export const FIXTURE_CONNECTION_B = {
  id:              'cc000000-0000-0000-0000-000000000002',
  tenantId:        JIRA_FIXTURE_TENANT_B,
  siteUrl:         'https://globex.atlassian.net',
  cloudId:         CLOUD_ID_B,
  authMethod:      'api_token' as const,
  scopes:          [] as string[],
  secretRef:       `jira/${JIRA_FIXTURE_TENANT_B}/cc000000-0000-0000-0000-000000000002`,
  tokenExpiresAt:  null,
  state:           'active' as const,
  lastTestedAt:    null,
  createdBy:       JIRA_FIXTURE_ACTOR_B,
  updatedBy:       JIRA_FIXTURE_ACTOR_B,
};

/** Canned Atlassian OAuth token response (used by mocked Atlassian server). */
export const CANNED_OAUTH_TOKEN_RESPONSE = {
  access_token: 'eyJhbGciOiJSUzI1NiJ9.canned_access_payload.sig',
  refresh_token: 'canned-refresh-token-fixture',
  expires_in: 3600,
  token_type: 'Bearer',
  scope: 'read:jira-work write:jira-work read:jira-user offline_access',
};

/** Canned accessible resources response from Atlassian. */
export const CANNED_CLOUD_RESOURCES_RESPONSE = [
  {
    id: CLOUD_ID_A,
    name: 'Acme Inc.',
    url: 'https://acme.atlassian.net',
    scopes: ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'],
  },
];

/** Canned Jira serverInfo response. */
export const CANNED_SERVER_INFO_RESPONSE = {
  version: '1001.0.0-SNAPSHOT',
  versionNumbers: [1001, 0, 0],
  deploymentType: 'Cloud',
  buildNumber: 100000,
  buildDate: '2026-01-01T00:00:00.000+0000',
  serverTime: '2026-08-11T12:00:00.000+0000',
  scmInfo: 'canned-scm',
  serverTitle: 'Acme Jira',
};
