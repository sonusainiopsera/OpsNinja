/**
 * Fixtures for WO-025 organization lifecycle integration tests.
 *
 * Contains:
 *  - One tenant
 *  - One organization with 5 historical tickets, 3 contacts, 1 open ticket
 *  - A second organization (name collision target for reactivate tests)
 *  - Staff admin principal for lifecycle mutations
 *  - Staff agent principal for ticket reads (asserts history survives deactivation)
 */

export const LIFECYCLE_TENANT_ID = '25000000-0000-0000-0000-000000000001';

export const LIFECYCLE_ORG_ID = '25000000-0000-0000-0001-000000000001';
export const LIFECYCLE_ORG_NAME = 'Sunset Technologies';
export const LIFECYCLE_ORG_SLUG = 'sunset-technologies';

/** Second org — used as the name-conflict target for reactivation tests. */
export const LIFECYCLE_ORG2_ID = '25000000-0000-0000-0001-000000000002';
export const LIFECYCLE_ORG2_NAME = 'Sunrise Systems';

export const LIFECYCLE_ADMIN_ID = '25000000-0000-0000-0002-000000000001';
export const LIFECYCLE_AGENT_ID = '25000000-0000-0000-0002-000000000002';

export const LIFECYCLE_CONTACT_IDS = [
  '25000000-0000-0000-0003-000000000001',
  '25000000-0000-0000-0003-000000000002',
  '25000000-0000-0000-0003-000000000003',
];

/** 4 closed tickets + 1 open = 5 total */
export const LIFECYCLE_TICKET_IDS = [
  '25000000-0000-0000-0004-000000000001', // open
  '25000000-0000-0000-0004-000000000002', // closed
  '25000000-0000-0000-0004-000000000003', // closed
  '25000000-0000-0000-0004-000000000004', // closed
  '25000000-0000-0000-0004-000000000005', // closed
];

export const LIFECYCLE_OPEN_TICKET_ID = LIFECYCLE_TICKET_IDS[0]!;

/** Seed SQL executed in global setup for lifecycle tests. */
export const LIFECYCLE_SEED_SQL = `
-- Tenant
INSERT INTO tenants (id, name, slug, active) VALUES
  ('${LIFECYCLE_TENANT_ID}', 'Lifecycle Test Tenant', 'lifecycle-test', true)
ON CONFLICT DO NOTHING;

-- Primary org
INSERT INTO organizations (id, tenant_id, name, slug, sla_tier, status, custom_field_values, version)
VALUES
  ('${LIFECYCLE_ORG_ID}', '${LIFECYCLE_TENANT_ID}', '${LIFECYCLE_ORG_NAME}',
   '${LIFECYCLE_ORG_SLUG}', 'standard', 'active', '{}', 1)
ON CONFLICT DO NOTHING;

-- Second org (name-collision test)
INSERT INTO organizations (id, tenant_id, name, slug, sla_tier, status, custom_field_values, version)
VALUES
  ('${LIFECYCLE_ORG2_ID}', '${LIFECYCLE_TENANT_ID}', '${LIFECYCLE_ORG2_NAME}',
   'sunrise-systems', 'standard', 'active', '{}', 1)
ON CONFLICT DO NOTHING;

-- Contacts (portal_access_enabled = true initially)
INSERT INTO contacts (id, tenant_id, organization_id, email, full_name, portal_access_enabled)
VALUES
  ('${LIFECYCLE_CONTACT_IDS[0]}', '${LIFECYCLE_TENANT_ID}', '${LIFECYCLE_ORG_ID}',
   'alice@sunset.test', 'Alice', true),
  ('${LIFECYCLE_CONTACT_IDS[1]}', '${LIFECYCLE_TENANT_ID}', '${LIFECYCLE_ORG_ID}',
   'bob@sunset.test', 'Bob', true),
  ('${LIFECYCLE_CONTACT_IDS[2]}', '${LIFECYCLE_TENANT_ID}', '${LIFECYCLE_ORG_ID}',
   'carol@sunset.test', 'Carol', true)
ON CONFLICT DO NOTHING;

-- Tickets (1 open, 4 closed)
INSERT INTO tickets (id, tenant_id, organization_id, subject, status, priority)
VALUES
  ('${LIFECYCLE_TICKET_IDS[0]}', '${LIFECYCLE_TENANT_ID}', '${LIFECYCLE_ORG_ID}', 'Open ticket', 'open', 'medium'),
  ('${LIFECYCLE_TICKET_IDS[1]}', '${LIFECYCLE_TENANT_ID}', '${LIFECYCLE_ORG_ID}', 'Closed ticket 1', 'closed', 'low'),
  ('${LIFECYCLE_TICKET_IDS[2]}', '${LIFECYCLE_TENANT_ID}', '${LIFECYCLE_ORG_ID}', 'Closed ticket 2', 'closed', 'low'),
  ('${LIFECYCLE_TICKET_IDS[3]}', '${LIFECYCLE_TENANT_ID}', '${LIFECYCLE_ORG_ID}', 'Closed ticket 3', 'closed', 'low'),
  ('${LIFECYCLE_TICKET_IDS[4]}', '${LIFECYCLE_TENANT_ID}', '${LIFECYCLE_ORG_ID}', 'Closed ticket 4', 'closed', 'low')
ON CONFLICT DO NOTHING;
`;
