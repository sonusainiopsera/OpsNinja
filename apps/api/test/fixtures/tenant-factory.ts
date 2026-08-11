/**
 * Deterministic two-tenant fixture factory for isolation tests.
 *
 * Builds a complete in-memory dataset for two tenants with deliberately
 * colliding names to catch identifier-based logic errors.  All identifiers
 * are derived from readable seeds so CI failures are reproducible locally.
 *
 * The dataset does NOT write to a database — use it to populate mock
 * repositories in unit/integration tests, or pass it to a SeedRunner for
 * full database-backed e2e tests.
 */

// ── Deterministic identifiers ─────────────────────────────────────────────────

/** Tenant A – first seeded tenant. */
export const TENANT_A_ID = '00000000-0000-0000-0000-000000000001';
/** Tenant B – second seeded tenant. */
export const TENANT_B_ID = '00000000-0000-0000-0000-000000000002';

/** Organization A-1 (belongs to Tenant A). */
export const ORG_A1_ID = '00000000-0000-0000-aaaa-000000000001';
/** Organization A-2 (belongs to Tenant A). */
export const ORG_A2_ID = '00000000-0000-0000-aaaa-000000000002';
/** Organization B-1 (belongs to Tenant B, same name as A-1 by design). */
export const ORG_B1_ID = '00000000-0000-0000-bbbb-000000000001';
/** Organization B-2 (belongs to Tenant B, same name as A-2 by design). */
export const ORG_B2_ID = '00000000-0000-0000-bbbb-000000000002';

// ── Staff user IDs ────────────────────────────────────────────────────────────

export const ADMIN_A_ID    = '00000000-0000-0001-aaaa-000000000001';
export const MANAGER_A_ID  = '00000000-0000-0001-aaaa-000000000002';
/** Agent in Tenant A, scoped to ORG_A1 only. */
export const AGENT_A1_ID   = '00000000-0000-0001-aaaa-000000000003';
/** Agent in Tenant A, scoped to ORG_A2 only. */
export const AGENT_A2_ID   = '00000000-0000-0001-aaaa-000000000004';
export const LEAD_A_ID     = '00000000-0000-0001-aaaa-000000000005';
export const READONLY_A_ID = '00000000-0000-0001-aaaa-000000000006';

export const ADMIN_B_ID    = '00000000-0000-0001-bbbb-000000000001';
export const MANAGER_B_ID  = '00000000-0000-0001-bbbb-000000000002';
export const AGENT_B1_ID   = '00000000-0000-0001-bbbb-000000000003';
export const AGENT_B2_ID   = '00000000-0000-0001-bbbb-000000000004';

// ── Portal user IDs ────────────────────────────────────────────────────────────

/** Portal user in Tenant A, bound to ORG_A1. */
export const PORTAL_A1_ID = '00000000-0000-0002-aaaa-000000000001';
/** Portal user in Tenant A, bound to ORG_A2. */
export const PORTAL_A2_ID = '00000000-0000-0002-aaaa-000000000002';
/** Portal user in Tenant B, bound to ORG_B1. */
export const PORTAL_B1_ID = '00000000-0000-0002-bbbb-000000000001';

// ── Ticket IDs ────────────────────────────────────────────────────────────────

export const TICKET_A1_1_ID = '00000000-0000-0003-aaaa-000000000001'; // Tenant A / Org A1
export const TICKET_A1_2_ID = '00000000-0000-0003-aaaa-000000000002'; // Tenant A / Org A1
export const TICKET_A2_1_ID = '00000000-0000-0003-aaaa-000000000003'; // Tenant A / Org A2
export const TICKET_B1_1_ID = '00000000-0000-0003-bbbb-000000000001'; // Tenant B / Org B1
export const TICKET_B1_2_ID = '00000000-0000-0003-bbbb-000000000002'; // Tenant B / Org B1

// ── Comment IDs ────────────────────────────────────────────────────────────────

export const COMMENT_A1_PUBLIC_ID   = '00000000-0000-0004-aaaa-000000000001';
export const COMMENT_A1_INTERNAL_ID = '00000000-0000-0004-aaaa-000000000002';
export const COMMENT_B1_PUBLIC_ID   = '00000000-0000-0004-bbbb-000000000001';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TenantFixture {
  id: string;
  name: string;
  slug: string;
}

export interface OrgFixture {
  id: string;
  tenantId: string;
  name: string;
  domain: string;
  isActive: boolean;
}

export interface UserFixture {
  id: string;
  tenantId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  orgScopeIds: string[];
  isActive: boolean;
}

export interface TicketFixture {
  id: string;
  tenantId: string;
  organizationId: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  createdById: string;
}

export interface CommentFixture {
  id: string;
  tenantId: string;
  ticketId: string;
  authorId: string;
  body: string;
  visibility: 'public' | 'internal';
}

// ── Dataset ───────────────────────────────────────────────────────────────────

export interface TenantDataset {
  tenants: TenantFixture[];
  organizations: OrgFixture[];
  users: UserFixture[];
  tickets: TicketFixture[];
  comments: CommentFixture[];
}

/**
 * Returns the complete deterministic two-tenant dataset.
 *
 * Org names are deliberately colliding across tenants to ensure the
 * isolation harness tests name-based logic errors.
 */
export function buildTwoTenantDataset(): TenantDataset {
  const tenants: TenantFixture[] = [
    { id: TENANT_A_ID, name: 'Acme Corp',  slug: 'acme' },
    { id: TENANT_B_ID, name: 'Beta GmbH',  slug: 'beta' },
  ];

  // Deliberately colliding names across tenants
  const organizations: OrgFixture[] = [
    { id: ORG_A1_ID, tenantId: TENANT_A_ID, name: 'Platform Engineering', domain: 'acme.example.com',  isActive: true },
    { id: ORG_A2_ID, tenantId: TENANT_A_ID, name: 'Security Operations',  domain: 'acme2.example.com', isActive: true },
    { id: ORG_B1_ID, tenantId: TENANT_B_ID, name: 'Platform Engineering', domain: 'beta.example.com',  isActive: true },
    { id: ORG_B2_ID, tenantId: TENANT_B_ID, name: 'Security Operations',  domain: 'beta2.example.com', isActive: true },
  ];

  const users: UserFixture[] = [
    // Tenant A staff
    { id: ADMIN_A_ID,    tenantId: TENANT_A_ID, email: 'admin@acme.example.com',    firstName: 'Alice', lastName: 'Admin',   role: 'admin',    orgScopeIds: [],             isActive: true },
    { id: MANAGER_A_ID,  tenantId: TENANT_A_ID, email: 'manager@acme.example.com',  firstName: 'Alice', lastName: 'Manager', role: 'manager',  orgScopeIds: [],             isActive: true },
    { id: AGENT_A1_ID,   tenantId: TENANT_A_ID, email: 'agent1@acme.example.com',   firstName: 'Alice', lastName: 'Agent1',  role: 'agent',    orgScopeIds: [ORG_A1_ID],    isActive: true },
    { id: AGENT_A2_ID,   tenantId: TENANT_A_ID, email: 'agent2@acme.example.com',   firstName: 'Alice', lastName: 'Agent2',  role: 'agent',    orgScopeIds: [ORG_A2_ID],    isActive: true },
    { id: LEAD_A_ID,     tenantId: TENANT_A_ID, email: 'lead@acme.example.com',     firstName: 'Alice', lastName: 'Lead',    role: 'lead',     orgScopeIds: [],             isActive: true },
    { id: READONLY_A_ID, tenantId: TENANT_A_ID, email: 'readonly@acme.example.com', firstName: 'Alice', lastName: 'Reader',  role: 'readonly', orgScopeIds: [],             isActive: true },
    // Portal users (Tenant A)
    { id: PORTAL_A1_ID, tenantId: TENANT_A_ID, email: 'user1@acme.example.com', firstName: 'Alice', lastName: 'Portal1', role: 'portal_user', orgScopeIds: [ORG_A1_ID], isActive: true },
    { id: PORTAL_A2_ID, tenantId: TENANT_A_ID, email: 'user2@acme.example.com', firstName: 'Alice', lastName: 'Portal2', role: 'portal_user', orgScopeIds: [ORG_A2_ID], isActive: true },
    // Tenant B staff
    { id: ADMIN_B_ID,   tenantId: TENANT_B_ID, email: 'admin@beta.example.com',   firstName: 'Bob', lastName: 'Admin',   role: 'admin',   orgScopeIds: [], isActive: true },
    { id: MANAGER_B_ID, tenantId: TENANT_B_ID, email: 'manager@beta.example.com', firstName: 'Bob', lastName: 'Manager', role: 'manager', orgScopeIds: [], isActive: true },
    { id: AGENT_B1_ID,  tenantId: TENANT_B_ID, email: 'agent1@beta.example.com',  firstName: 'Bob', lastName: 'Agent1',  role: 'agent',   orgScopeIds: [ORG_B1_ID], isActive: true },
    { id: AGENT_B2_ID,  tenantId: TENANT_B_ID, email: 'agent2@beta.example.com',  firstName: 'Bob', lastName: 'Agent2',  role: 'agent',   orgScopeIds: [ORG_B2_ID], isActive: true },
    { id: PORTAL_B1_ID, tenantId: TENANT_B_ID, email: 'user1@beta.example.com',   firstName: 'Bob', lastName: 'Portal1', role: 'portal_user', orgScopeIds: [ORG_B1_ID], isActive: true },
  ];

  const tickets: TicketFixture[] = [
    // Tenant A / Org A1
    { id: TICKET_A1_1_ID, tenantId: TENANT_A_ID, organizationId: ORG_A1_ID, subject: 'Platform incident', description: 'Cluster degraded', status: 'open',        priority: 'p1', createdById: AGENT_A1_ID },
    { id: TICKET_A1_2_ID, tenantId: TENANT_A_ID, organizationId: ORG_A1_ID, subject: 'Access request',    description: 'User needs access', status: 'in_progress', priority: 'p3', createdById: AGENT_A1_ID },
    // Tenant A / Org A2 (sibling org — agents scoped to A1 must not see these)
    { id: TICKET_A2_1_ID, tenantId: TENANT_A_ID, organizationId: ORG_A2_ID, subject: 'Security alert',    description: 'Suspicious login',  status: 'open',        priority: 'p2', createdById: AGENT_A2_ID },
    // Tenant B / Org B1 (cross-tenant — Tenant A agents must never see these)
    { id: TICKET_B1_1_ID, tenantId: TENANT_B_ID, organizationId: ORG_B1_ID, subject: 'Platform incident', description: 'Cluster degraded', status: 'open',        priority: 'p1', createdById: AGENT_B1_ID },
    { id: TICKET_B1_2_ID, tenantId: TENANT_B_ID, organizationId: ORG_B1_ID, subject: 'Security alert',    description: 'Access issue',     status: 'open',        priority: 'p3', createdById: AGENT_B1_ID },
  ];

  const comments: CommentFixture[] = [
    { id: COMMENT_A1_PUBLIC_ID,   tenantId: TENANT_A_ID, ticketId: TICKET_A1_1_ID, authorId: AGENT_A1_ID, body: 'Public reply to customer',  visibility: 'public'   },
    { id: COMMENT_A1_INTERNAL_ID, tenantId: TENANT_A_ID, ticketId: TICKET_A1_1_ID, authorId: AGENT_A1_ID, body: 'Internal note: escalate',    visibility: 'internal' },
    { id: COMMENT_B1_PUBLIC_ID,   tenantId: TENANT_B_ID, ticketId: TICKET_B1_1_ID, authorId: AGENT_B1_ID, body: 'Beta tenant public reply',   visibility: 'public'   },
  ];

  return { tenants, organizations, users, tickets, comments };
}

/** Singleton dataset — call once and share across tests in a suite. */
export const DATASET = buildTwoTenantDataset();
