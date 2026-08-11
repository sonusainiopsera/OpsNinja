/**
 * Webhook test fixtures.
 *
 * Two-tenant fixtures for cross-tenant isolation tests.
 * Malicious URL table for SSRF validation tests.
 * Valid URL fixture for happy-path tests.
 * Event catalogue snapshot fixture.
 */

export const TENANT_A = '00000000-0000-0000-0001-000000000001';
export const TENANT_B = '00000000-0000-0000-0001-000000000002';

export const ACTOR_A = '00000000-0000-0000-0002-000000000001';
export const ACTOR_B = '00000000-0000-0000-0002-000000000002';

export const VALID_WEBHOOK_URL = 'https://hooks.example.com/opsninja';
export const VALID_WEBHOOK_URL_8443 = 'https://hooks.example.com:8443/opsninja';

/** Each entry: [url, expectedErrorCode, description] */
export const MALICIOUS_URL_TABLE: Array<[string, string, string]> = [
  ['http://example.com/hook', 'WEBHOOK_URL_NOT_HTTPS', 'plain http'],
  ['ftp://example.com/hook', 'WEBHOOK_URL_NOT_HTTPS', 'ftp scheme'],
  ['file:///etc/passwd', 'WEBHOOK_URL_NOT_HTTPS', 'file scheme'],
  ['https://user:pass@example.com/hook', 'WEBHOOK_URL_EMBEDDED_CREDENTIALS', 'embedded creds'],
  ['https://example.com:22/hook', 'WEBHOOK_URL_DISALLOWED_PORT', 'ssh port'],
  ['https://example.com:8080/hook', 'WEBHOOK_URL_DISALLOWED_PORT', 'http-alt port'],
  ['https://10.0.0.1/hook', 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS', 'RFC1918 10/8 literal'],
  ['https://192.168.1.1/hook', 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS', 'RFC1918 192.168 literal'],
  ['https://169.254.169.254/latest/meta-data', 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS', 'IMDS v1'],
  ['https://[::1]/hook', 'WEBHOOK_URL_BLOCKED_PRIVATE_ADDRESS', 'IPv6 loopback literal'],
];

export const VALID_EVENT_TYPES = ['ticket.created', 'ticket.closed'];
export const INVALID_EVENT_TYPES = ['ticket.created', 'not.real.event'];

export const CREATE_DTO_VALID = {
  url: VALID_WEBHOOK_URL,
  description: 'Test hook for CI',
  eventTypes: VALID_EVENT_TYPES,
};

export const CREATE_DTO_INVALID_EVENTS = {
  url: VALID_WEBHOOK_URL,
  eventTypes: INVALID_EVENT_TYPES,
};

export const EVENT_CATALOGUE_SNAPSHOT = [
  'ticket.created',
  'ticket.updated',
  'ticket.closed',
  'ticket.comment_added',
  'ticket.sla_breached',
  'ticket.assigned',
  'webhook.ping',
];
