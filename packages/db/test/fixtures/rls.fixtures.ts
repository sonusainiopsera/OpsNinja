/**
 * RLS test fixtures — extends the identity fixture set with ticket and comment
 * data for testing tenant isolation and portal visibility policies.
 *
 * Dataset:
 *   Ticket A1: in ORG_A1 (Tenant A)
 *     - Comment A1_PUBLIC:   visibility = 'public'  (portal can see)
 *     - Comment A1_INTERNAL: visibility = 'internal' (portal cannot see)
 *   Ticket B1: in ORG_B1 (Tenant B)
 *     - Comment B1_PUBLIC:   visibility = 'public'
 *
 * Portal session setup for Tenant A:
 *   app.current_tenant   = TENANT_A
 *   app.principal_kind   = 'portal'
 *   app.current_org_ids  = ORG_A1  (single org, comma-separated)
 */
import type postgres from 'postgres';
import { FIXTURE_IDS } from './identity.fixtures.js';

type Sql = ReturnType<typeof postgres>;

// ---------------------------------------------------------------------------
// Fixed UUIDs
// ---------------------------------------------------------------------------
export const RLS_FIXTURE_IDS = {
  // Tickets
  TICKET_A1: 'e1000000-0000-0000-0000-000000000001',
  TICKET_B1: 'e1000000-0000-0000-0000-000000000002',
  // Ticket A2: different org within tenant A (for empty org-list portal test)
  TICKET_A2: 'e1000000-0000-0000-0000-000000000003',

  // Ticket comments
  COMMENT_A1_PUBLIC:   'e2000000-0000-0000-0000-000000000001',
  COMMENT_A1_INTERNAL: 'e2000000-0000-0000-0000-000000000002',
  COMMENT_B1_PUBLIC:   'e2000000-0000-0000-0000-000000000003',
  COMMENT_A2_PUBLIC:   'e2000000-0000-0000-0000-000000000004',

  // A fixed timestamp used for all fixtures (partition key)
  CREATED_AT: '2026-01-15 10:00:00+00',
} as const;

/**
 * Loads ticket + comment fixtures on top of the identity fixtures.
 * Must be called AFTER loadIdentityFixtures() (depends on organizations).
 * Runs as the connected role (superuser) so RLS is bypassed for seeding.
 */
export async function loadRlsFixtures(sql: Sql): Promise<void> {
  // Ensure the ticket partition exists for Jan 2026
  await sql.unsafe(`
    SELECT ensure_monthly_partitions('tickets', 0);
    SELECT ensure_monthly_partitions('ticket_comments', 0);
  `);

  // Tickets — Tenant A
  await sql.unsafe(`
    INSERT INTO tickets (tenant_id, id, created_at, organization_id, subject, status, priority)
    VALUES
      -- Ticket A1: owned by ORG_A1 (portal user's org)
      (
        '${FIXTURE_IDS.TENANT_A}'::uuid,
        '${RLS_FIXTURE_IDS.TICKET_A1}'::uuid,
        '${RLS_FIXTURE_IDS.CREATED_AT}'::timestamptz,
        '${FIXTURE_IDS.ORG_A1}'::uuid,
        'Ticket A1 - portal org',
        'open', 'P3'
      ),
      -- Ticket A2: owned by ORG_A2 (portal user has NO access to this org)
      (
        '${FIXTURE_IDS.TENANT_A}'::uuid,
        '${RLS_FIXTURE_IDS.TICKET_A2}'::uuid,
        '${RLS_FIXTURE_IDS.CREATED_AT}'::timestamptz,
        '${FIXTURE_IDS.ORG_A2}'::uuid,
        'Ticket A2 - outside portal org',
        'open', 'P3'
      )
    ON CONFLICT DO NOTHING;
  `);

  // Ticket — Tenant B
  await sql.unsafe(`
    INSERT INTO tickets (tenant_id, id, created_at, organization_id, subject, status, priority)
    VALUES
      (
        '${FIXTURE_IDS.TENANT_B}'::uuid,
        '${RLS_FIXTURE_IDS.TICKET_B1}'::uuid,
        '${RLS_FIXTURE_IDS.CREATED_AT}'::timestamptz,
        '${FIXTURE_IDS.ORG_B1}'::uuid,
        'Ticket B1 - tenant B',
        'open', 'P3'
      )
    ON CONFLICT DO NOTHING;
  `);

  // Comments on Ticket A1
  await sql.unsafe(`
    INSERT INTO ticket_comments (tenant_id, id, created_at, ticket_id, author_user_id, visibility, body)
    VALUES
      -- Public comment — portal should see this
      (
        '${FIXTURE_IDS.TENANT_A}'::uuid,
        '${RLS_FIXTURE_IDS.COMMENT_A1_PUBLIC}'::uuid,
        '${RLS_FIXTURE_IDS.CREATED_AT}'::timestamptz,
        '${RLS_FIXTURE_IDS.TICKET_A1}'::uuid,
        '${FIXTURE_IDS.USER_A_AGENT}'::uuid,
        'public',
        'Hello from a public comment on ticket A1'
      ),
      -- Internal comment — portal must NOT see this
      (
        '${FIXTURE_IDS.TENANT_A}'::uuid,
        '${RLS_FIXTURE_IDS.COMMENT_A1_INTERNAL}'::uuid,
        '${RLS_FIXTURE_IDS.CREATED_AT}'::timestamptz,
        '${RLS_FIXTURE_IDS.TICKET_A1}'::uuid,
        '${FIXTURE_IDS.USER_A_ADMIN}'::uuid,
        'internal',
        'Internal agent note — NOT for portal'
      )
    ON CONFLICT DO NOTHING;
  `);

  // Comment on Ticket A2 (different org)
  await sql.unsafe(`
    INSERT INTO ticket_comments (tenant_id, id, created_at, ticket_id, author_user_id, visibility, body)
    VALUES
      (
        '${FIXTURE_IDS.TENANT_A}'::uuid,
        '${RLS_FIXTURE_IDS.COMMENT_A2_PUBLIC}'::uuid,
        '${RLS_FIXTURE_IDS.CREATED_AT}'::timestamptz,
        '${RLS_FIXTURE_IDS.TICKET_A2}'::uuid,
        '${FIXTURE_IDS.USER_A_AGENT}'::uuid,
        'public',
        'Public comment on ticket A2 (different org)'
      )
    ON CONFLICT DO NOTHING;
  `);

  // Comment on Tenant B ticket
  await sql.unsafe(`
    INSERT INTO ticket_comments (tenant_id, id, created_at, ticket_id, author_user_id, visibility, body)
    VALUES
      (
        '${FIXTURE_IDS.TENANT_B}'::uuid,
        '${RLS_FIXTURE_IDS.COMMENT_B1_PUBLIC}'::uuid,
        '${RLS_FIXTURE_IDS.CREATED_AT}'::timestamptz,
        '${RLS_FIXTURE_IDS.TICKET_B1}'::uuid,
        '${FIXTURE_IDS.USER_B_ADMIN}'::uuid,
        'public',
        'Public comment on tenant B ticket'
      )
    ON CONFLICT DO NOTHING;
  `);
}
