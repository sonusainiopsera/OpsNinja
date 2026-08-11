/**
 * Fixtures for tags and assignment group integration tests.
 *
 * Provides deterministic UUIDs, tag rows, two assignment groups and three
 * agents with differing organisation scopes.
 */

import type { Sql } from 'postgres';

// ---------------------------------------------------------------------------
// Deterministic IDs
// ---------------------------------------------------------------------------

export const TAG_IDS = {
  bug:         'b0000001-0000-4000-8000-000000000001',
  enhancement: 'b0000001-0000-4000-8000-000000000002',
  critical:    'b0000001-0000-4000-8000-000000000003',
  regression:  'b0000001-0000-4000-8000-000000000004',
  performance: 'b0000001-0000-4000-8000-000000000005',
} as const;

export const GROUP_IDS = {
  frontline: 'a0000001-0000-4000-8000-000000000001',
  escalation: 'a0000001-0000-4000-8000-000000000002',
} as const;

export const AGENT_IDS = {
  /** Agent with org scope covering both orgs. */
  fullScope: 'd0000001-0000-4000-8000-000000000001',
  /** Agent with org scope covering only org A. */
  orgAOnly:  'd0000001-0000-4000-8000-000000000002',
  /** Agent with no org scope entries (unrestricted). */
  noScope:   'd0000001-0000-4000-8000-000000000003',
} as const;

export const ORG_IDS = {
  orgA: 'f0000001-0000-4000-8000-000000000001',
  orgB: 'f0000001-0000-4000-8000-000000000002',
} as const;

// ---------------------------------------------------------------------------
// Tag fixture rows
// ---------------------------------------------------------------------------

export const TAG_FIXTURES = [
  { id: TAG_IDS.bug,         name: 'Bug',         slug: 'bug',         colour: '#FF4444' },
  { id: TAG_IDS.enhancement, name: 'Enhancement', slug: 'enhancement', colour: '#4488FF' },
  { id: TAG_IDS.critical,    name: 'Critical',    slug: 'critical',    colour: '#FF8800' },
  { id: TAG_IDS.regression,  name: 'Regression',  slug: 'regression',  colour: '#AA44FF' },
  { id: TAG_IDS.performance, name: 'Performance', slug: 'performance', colour: '#00CC88' },
] as const;

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export async function loadTagFixtures(sql: Sql, tenantId: string): Promise<void> {
  for (const tag of TAG_FIXTURES) {
    await sql.unsafe(
      `INSERT INTO tags (tenant_id, id, name, slug, colour)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [tenantId, tag.id, tag.name, tag.slug, tag.colour],
    );
  }
}

export async function loadGroupFixtures(sql: Sql, tenantId: string): Promise<void> {
  await sql.unsafe(
    `INSERT INTO assignment_groups (tenant_id, id, name, description)
     VALUES
       ($1::uuid, $2::uuid, 'Frontline Support', 'First-tier agents handling initial contact'),
       ($1::uuid, $3::uuid, 'Escalation Team',   'Senior agents for complex issues')
     ON CONFLICT DO NOTHING`,
    [tenantId, GROUP_IDS.frontline, GROUP_IDS.escalation],
  );
}

/**
 * Seeds three agent rows in the users table.
 *
 * fullScope → org_access_scopes covering orgA + orgB
 * orgAOnly  → org_access_scopes covering orgA only
 * noScope   → no org_access_scopes rows (unrestricted or portal user)
 *
 * Caller is responsible for seeding org rows first.
 */
export async function loadAgentFixtures(sql: Sql, tenantId: string): Promise<void> {
  await sql.unsafe(
    `INSERT INTO users (tenant_id, id, email, display_name, is_active)
     VALUES
       ($1::uuid, $2::uuid, 'agent-full@test.example',  'Full Scope Agent', true),
       ($1::uuid, $3::uuid, 'agent-orga@test.example',  'Org A Agent',      true),
       ($1::uuid, $4::uuid, 'agent-none@test.example',  'No Scope Agent',   true)
     ON CONFLICT DO NOTHING`,
    [tenantId, AGENT_IDS.fullScope, AGENT_IDS.orgAOnly, AGENT_IDS.noScope],
  );
}
