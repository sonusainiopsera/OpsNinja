/**
 * Deterministic seed script for OpsNinja.
 *
 * Produces two-tenant fixture data with fixed UUIDs so all later stories share
 * a predictable starting state. Safe to run multiple times — all inserts use
 * ON CONFLICT DO NOTHING.
 *
 * Fixture overview:
 *   Tenant A (Acme Corp — growth plan):
 *     - 2 organizations: Acme Ops, Acme Platform
 *     - 4 contacts (2 per org)
 *     - 3 users: 1 admin, 1 agent, 1 portal user
 *     - Role assignments + agent org scopes
 *     - 1 custom field def (cloud_provider)
 *     - Categories: Pipeline → [Jenkins Integration, GitHub Actions], Infra → [Kubernetes]
 *     - 3 tickets with comments
 *
 *   Tenant B (Beta Ltd — starter plan):
 *     - 1 organization: Beta Infra
 *     - 2 contacts
 *     - 2 users: 1 admin, 1 portal user
 *     - 2 tickets with comments
 *
 * Usage:
 *   DATABASE_URL=postgres://user:pass@localhost:5432/opsninja tsx scripts/seed.ts
 */
import postgres from 'postgres';

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// ---------------------------------------------------------------------------
// Fixed UUIDs — deterministic across runs
// ---------------------------------------------------------------------------
const IDs = {
  // Tenants
  TENANT_A: '10000000-0000-0000-0000-000000000001',
  TENANT_B: '10000000-0000-0000-0000-000000000002',

  // Organizations
  ORG_ACME_OPS:      '20000000-0000-0000-0000-000000000001',
  ORG_ACME_PLATFORM: '20000000-0000-0000-0000-000000000002',
  ORG_BETA_INFRA:    '20000000-0000-0000-0000-000000000003',

  // Custom field defs
  CFD_CLOUD_PROVIDER: '25000000-0000-0000-0000-000000000001',
  CFD_DEPLOYMENT_MODEL: '25000000-0000-0000-0000-000000000002',

  // Users
  USER_ACME_ADMIN:   '30000000-0000-0000-0000-000000000001',
  USER_ACME_AGENT:   '30000000-0000-0000-0000-000000000002',
  USER_ACME_PORTAL:  '30000000-0000-0000-0000-000000000003',
  USER_BETA_ADMIN:   '30000000-0000-0000-0000-000000000004',
  USER_BETA_PORTAL:  '30000000-0000-0000-0000-000000000005',

  // Contacts
  CONTACT_ACME_1: '40000000-0000-0000-0000-000000000001',
  CONTACT_ACME_2: '40000000-0000-0000-0000-000000000002',
  CONTACT_ACME_3: '40000000-0000-0000-0000-000000000003',
  CONTACT_ACME_4: '40000000-0000-0000-0000-000000000004',
  CONTACT_BETA_1: '40000000-0000-0000-0000-000000000005',
  CONTACT_BETA_2: '40000000-0000-0000-0000-000000000006',

  // Categories (Tenant A)
  CAT_PIPELINE:    '50000000-0000-0000-0000-000000000001',
  CAT_JENKINS:     '50000000-0000-0000-0000-000000000002',
  CAT_GH_ACTIONS:  '50000000-0000-0000-0000-000000000003',
  CAT_INFRA:       '50000000-0000-0000-0000-000000000004',
  CAT_KUBERNETES:  '50000000-0000-0000-0000-000000000005',

  // Tickets
  TICKET_A1: '60000000-0000-0000-0000-000000000001',
  TICKET_A2: '60000000-0000-0000-0000-000000000002',
  TICKET_A3: '60000000-0000-0000-0000-000000000003',
  TICKET_B1: '60000000-0000-0000-0000-000000000004',
  TICKET_B2: '60000000-0000-0000-0000-000000000005',

  // Comments
  COMMENT_A1_1: '70000000-0000-0000-0000-000000000001',
  COMMENT_A1_2: '70000000-0000-0000-0000-000000000002',
  COMMENT_A2_1: '70000000-0000-0000-0000-000000000003',
  COMMENT_B1_1: '70000000-0000-0000-0000-000000000004',
} as const;

// ---------------------------------------------------------------------------
// Seed logic
// ---------------------------------------------------------------------------
async function seed() {
  const sql = postgres(DATABASE_URL!, { max: 1 });

  try {
    console.log('Seeding Tenant A (Acme Corp)…');
    await sql.unsafe(`
      -- Tenants
      INSERT INTO tenants (id, name, plan_tier, ai_synthesis_enabled, is_active)
      VALUES
        ('${IDs.TENANT_A}', 'Acme Corp', 'growth',  true,  true),
        ('${IDs.TENANT_B}', 'Beta Ltd',  'starter', false, true)
      ON CONFLICT (id) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Organizations
      INSERT INTO organizations (tenant_id, id, name, tier, region, is_active, custom_field_values)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.ORG_ACME_OPS}',
         'Acme Ops', 'premium', 'us-east-1', true,
         '{"cloud_provider":"aws","deployment_model":"kubernetes","active_pipeline_count":12}'::jsonb),
        ('${IDs.TENANT_A}', '${IDs.ORG_ACME_PLATFORM}',
         'Acme Platform', 'enterprise', 'eu-west-1', true,
         '{"cloud_provider":"azure","deployment_model":"vm","active_pipeline_count":5}'::jsonb),
        ('${IDs.TENANT_B}', '${IDs.ORG_BETA_INFRA}',
         'Beta Infra', 'standard', 'us-west-2', true,
         '{"cloud_provider":"gcp","deployment_model":"serverless","active_pipeline_count":3}'::jsonb)
      ON CONFLICT (tenant_id, id) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Verified domains
      INSERT INTO organization_verified_domains (tenant_id, organization_id, domain)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.ORG_ACME_OPS}',      'acme-ops.example.com'),
        ('${IDs.TENANT_A}', '${IDs.ORG_ACME_PLATFORM}',  'acme-platform.example.com'),
        ('${IDs.TENANT_B}', '${IDs.ORG_BETA_INFRA}',     'beta-infra.example.com')
      ON CONFLICT (tenant_id, domain) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Custom field definitions (Tenant A)
      INSERT INTO custom_field_defs (tenant_id, id, key, label, data_type, required, applies_to, validation)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.CFD_CLOUD_PROVIDER}',
         'cloud_provider', 'Cloud Provider', 'select', true, 'organization',
         '{"options":["aws","azure","gcp","other"]}'::jsonb),
        ('${IDs.TENANT_A}', '${IDs.CFD_DEPLOYMENT_MODEL}',
         'deployment_model', 'Deployment Model', 'select', false, 'organization',
         '{"options":["kubernetes","vm","serverless","bare-metal"]}'::jsonb)
      ON CONFLICT (tenant_id, id) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Users
      INSERT INTO users (tenant_id, id, email, kind, status)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.USER_ACME_ADMIN}',  'admin@acme.example.com',  'staff',  'active'),
        ('${IDs.TENANT_A}', '${IDs.USER_ACME_AGENT}',  'agent@acme.example.com',  'staff',  'active'),
        ('${IDs.TENANT_A}', '${IDs.USER_ACME_PORTAL}', 'portal@acme.example.com', 'portal', 'active'),
        ('${IDs.TENANT_B}', '${IDs.USER_BETA_ADMIN}',  'admin@beta.example.com',  'staff',  'active'),
        ('${IDs.TENANT_B}', '${IDs.USER_BETA_PORTAL}', 'portal@beta.example.com', 'portal', 'active')
      ON CONFLICT (tenant_id, id) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Contacts
      INSERT INTO customer_contacts (tenant_id, id, organization_id, email, name, portal_access_enabled)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.CONTACT_ACME_1}', '${IDs.ORG_ACME_OPS}',      'alice@acme-ops.example.com',      'Alice Ops',      true),
        ('${IDs.TENANT_A}', '${IDs.CONTACT_ACME_2}', '${IDs.ORG_ACME_OPS}',      'bob@acme-ops.example.com',        'Bob Ops',        false),
        ('${IDs.TENANT_A}', '${IDs.CONTACT_ACME_3}', '${IDs.ORG_ACME_PLATFORM}', 'carol@acme-platform.example.com', 'Carol Platform', true),
        ('${IDs.TENANT_A}', '${IDs.CONTACT_ACME_4}', '${IDs.ORG_ACME_PLATFORM}', 'dave@acme-platform.example.com',  'Dave Platform',  false),
        ('${IDs.TENANT_B}', '${IDs.CONTACT_BETA_1}', '${IDs.ORG_BETA_INFRA}',    'eve@beta-infra.example.com',      'Eve Infra',      true),
        ('${IDs.TENANT_B}', '${IDs.CONTACT_BETA_2}', '${IDs.ORG_BETA_INFRA}',    'frank@beta-infra.example.com',    'Frank Infra',    false)
      ON CONFLICT (tenant_id, id) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Role assignments
      INSERT INTO role_assignments (tenant_id, user_id, role, scope_version)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.USER_ACME_ADMIN}',  'admin',      1),
        ('${IDs.TENANT_A}', '${IDs.USER_ACME_AGENT}',  'agent',      1),
        ('${IDs.TENANT_A}', '${IDs.USER_ACME_PORTAL}', 'portal_user',1),
        ('${IDs.TENANT_B}', '${IDs.USER_BETA_ADMIN}',  'admin',      1),
        ('${IDs.TENANT_B}', '${IDs.USER_BETA_PORTAL}', 'portal_user',1)
      ON CONFLICT (tenant_id, user_id, role) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Agent org scopes (agent can access both Acme orgs)
      INSERT INTO agent_org_scopes (tenant_id, user_id, organization_id, access_level)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.USER_ACME_AGENT}', '${IDs.ORG_ACME_OPS}',      'write'),
        ('${IDs.TENANT_A}', '${IDs.USER_ACME_AGENT}', '${IDs.ORG_ACME_PLATFORM}', 'read')
      ON CONFLICT (tenant_id, user_id, organization_id) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Categories (Tenant A) — two-level tree
      -- Root categories
      INSERT INTO categories (tenant_id, id, parent_id, name, path)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.CAT_PIPELINE}', NULL, 'Pipeline', 'Pipeline'),
        ('${IDs.TENANT_A}', '${IDs.CAT_INFRA}',    NULL, 'Infra',    'Infra')
      ON CONFLICT (tenant_id, id) DO NOTHING;

      -- Child categories
      INSERT INTO categories (tenant_id, id, parent_id, name, path)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.CAT_JENKINS}',    '${IDs.CAT_PIPELINE}', 'Jenkins Integration', 'Pipeline / Jenkins Integration'),
        ('${IDs.TENANT_A}', '${IDs.CAT_GH_ACTIONS}', '${IDs.CAT_PIPELINE}', 'GitHub Actions',      'Pipeline / GitHub Actions'),
        ('${IDs.TENANT_A}', '${IDs.CAT_KUBERNETES}', '${IDs.CAT_INFRA}',    'Kubernetes',          'Infra / Kubernetes')
      ON CONFLICT (tenant_id, id) DO NOTHING;
    `);

    console.log('Seeding tickets and comments…');
    await sql.unsafe(`
      -- Ensure partitions exist for the seed date range
      SELECT ensure_monthly_partitions('tickets', 3);
      SELECT ensure_monthly_partitions('ticket_comments', 3);
      SELECT ensure_monthly_partitions('audit_logs', 3);
    `);

    await sql.unsafe(`
      -- Tickets (Tenant A)
      INSERT INTO tickets (tenant_id, id, organization_id, requester_contact_id, assignee_user_id,
                           status, priority, category_id, subject, created_at)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.TICKET_A1}',
         '${IDs.ORG_ACME_OPS}', '${IDs.CONTACT_ACME_1}', '${IDs.USER_ACME_AGENT}',
         'open', 'P1', '${IDs.CAT_JENKINS}',
         'Pipeline failing: Jenkins unable to reach Vault', now()),
        ('${IDs.TENANT_A}', '${IDs.TICKET_A2}',
         '${IDs.ORG_ACME_PLATFORM}', '${IDs.CONTACT_ACME_3}', '${IDs.USER_ACME_AGENT}',
         'pending', 'P2', '${IDs.CAT_KUBERNETES}',
         'Kubernetes node pool autoscaler stuck at max', now()),
        ('${IDs.TENANT_A}', '${IDs.TICKET_A3}',
         '${IDs.ORG_ACME_OPS}', '${IDs.CONTACT_ACME_2}', NULL,
         'open', 'P3', '${IDs.CAT_GH_ACTIONS}',
         'GitHub Actions workflow intermittently fails on matrix builds', now())
      ON CONFLICT (tenant_id, id, created_at) DO NOTHING;

      -- Tickets (Tenant B)
      INSERT INTO tickets (tenant_id, id, organization_id, requester_contact_id, assignee_user_id,
                           status, priority, category_id, subject, created_at)
      VALUES
        ('${IDs.TENANT_B}', '${IDs.TICKET_B1}',
         '${IDs.ORG_BETA_INFRA}', '${IDs.CONTACT_BETA_1}', NULL,
         'open', 'P2', NULL,
         'Cloud function cold-start latency exceeds SLA', now()),
        ('${IDs.TENANT_B}', '${IDs.TICKET_B2}',
         '${IDs.ORG_BETA_INFRA}', '${IDs.CONTACT_BETA_2}', NULL,
         'solved', 'P4', NULL,
         'Documentation request: deployment runbook for Q4 release', now())
      ON CONFLICT (tenant_id, id, created_at) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Comments (Tenant A)
      INSERT INTO ticket_comments (tenant_id, id, ticket_id, author_user_id, visibility, body, created_at)
      VALUES
        ('${IDs.TENANT_A}', '${IDs.COMMENT_A1_1}', '${IDs.TICKET_A1}',
         '${IDs.USER_ACME_AGENT}', 'internal',
         'Checked Vault audit logs. Agent token expired. Rotating now.', now()),
        ('${IDs.TENANT_A}', '${IDs.COMMENT_A1_2}', '${IDs.TICKET_A1}',
         '${IDs.USER_ACME_AGENT}', 'public',
         'We have identified the root cause and are applying a fix. ETA 30 minutes.', now()),
        ('${IDs.TENANT_A}', '${IDs.COMMENT_A2_1}', '${IDs.TICKET_A2}',
         '${IDs.USER_ACME_AGENT}', 'internal',
         'Autoscaler log shows throttled AWS API calls. Raising the rate limit request.', now())
      ON CONFLICT (tenant_id, id, created_at) DO NOTHING;

      -- Comment (Tenant B)
      INSERT INTO ticket_comments (tenant_id, id, ticket_id, author_user_id, visibility, body, created_at)
      VALUES
        ('${IDs.TENANT_B}', '${IDs.COMMENT_B1_1}', '${IDs.TICKET_B1}',
         '${IDs.USER_BETA_ADMIN}', 'public',
         'We are investigating the cold-start issue with our cloud function provider.', now())
      ON CONFLICT (tenant_id, id, created_at) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Seed outbox events for bootstrapped tickets
      INSERT INTO outbox_events (tenant_id, id, aggregate_type, aggregate_id, event_type, payload)
      VALUES
        ('${IDs.TENANT_A}',
         gen_random_uuid(),
         'ticket', '${IDs.TICKET_A1}', 'ticket.created',
         '{"priority":"P1","organization_id":"${IDs.ORG_ACME_OPS}"}'::jsonb),
        ('${IDs.TENANT_B}',
         gen_random_uuid(),
         'ticket', '${IDs.TICKET_B1}', 'ticket.created',
         '{"priority":"P2","organization_id":"${IDs.ORG_BETA_INFRA}"}'::jsonb)
      ON CONFLICT (tenant_id, id) DO NOTHING;
    `);

    await sql.unsafe(`
      -- Audit log entries for seed operations
      INSERT INTO audit_logs (tenant_id, id, occurred_at, actor_type, actor_id, action,
                              resource_type, resource_id, before_state, after_state, trace_id)
      VALUES
        ('${IDs.TENANT_A}',
         gen_random_uuid(), now(),
         'system', NULL, 'create', 'ticket', '${IDs.TICKET_A1}',
         NULL, '{"subject":"Pipeline failing: Jenkins unable to reach Vault","priority":"P1"}'::jsonb,
         'seed-run-001'),
        ('${IDs.TENANT_B}',
         gen_random_uuid(), now(),
         'system', NULL, 'create', 'ticket', '${IDs.TICKET_B1}',
         NULL, '{"subject":"Cloud function cold-start latency exceeds SLA","priority":"P2"}'::jsonb,
         'seed-run-001')
      ON CONFLICT (tenant_id, id, occurred_at) DO NOTHING;
    `);

    console.log('✓ Seed complete.');
    console.log(`  Tenants:  ${IDs.TENANT_A} (Acme Corp), ${IDs.TENANT_B} (Beta Ltd)`);
    console.log(`  Orgs:     3 (2 × Acme, 1 × Beta)`);
    console.log(`  Users:    5 (3 × Acme, 2 × Beta)`);
    console.log(`  Tickets:  5 (3 × Acme, 2 × Beta)`);
    console.log(`  Comments: 4`);
  } finally {
    await sql.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
