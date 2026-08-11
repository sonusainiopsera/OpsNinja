/**
 * Two-tenant webhook endpoint fixtures for integration tests.
 */

export const TENANT_A_ID = '11111111-0000-0000-0000-000000000001';
export const TENANT_B_ID = '22222222-0000-0000-0000-000000000002';

export const TENANT_A_ACTOR_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
export const TENANT_B_ACTOR_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

export const ENDPOINT_FIXTURE_A = {
  tenantId: TENANT_A_ID,
  url: 'https://hooks.tenant-a.example.com/incoming',
  description: 'Tenant A primary webhook',
  eventTypes: ['ticket.created', 'ticket.closed'],
  createdBy: TENANT_A_ACTOR_ID,
};

export const ENDPOINT_FIXTURE_B = {
  tenantId: TENANT_B_ID,
  url: 'https://hooks.tenant-b.example.com/incoming',
  description: 'Tenant B primary webhook',
  eventTypes: ['comment.created'],
  createdBy: TENANT_B_ACTOR_ID,
};

/** Event catalogue snapshot – used to assert the catalogue doesn't drift silently. */
export const EVENT_CATALOGUE_SNAPSHOT = [
  'ticket.created',
  'ticket.updated',
  'ticket.assigned',
  'ticket.status_changed',
  'ticket.closed',
  'ticket.reopened',
  'comment.created',
  'webhook.ping',
];
