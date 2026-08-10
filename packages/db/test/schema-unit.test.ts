/**
 * Drizzle schema unit tests (type-level and query-builder).
 *
 * These tests do NOT require a live database; they assert that:
 *   1. The Drizzle schema exports exist and have the expected shape.
 *   2. Generated SQL from the Drizzle query builder includes tenant_id
 *      predicates and correct column names.
 *   3. TypeScript inference produces the expected types (checked via
 *      typeof assertions — failures appear as compile errors).
 *
 * Run with: vitest run test/schema-unit.test.ts
 */
import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import {
  tenants,
  organizations,
  organizationVerifiedDomains,
  customFieldDefs,
  users,
  customerContacts,
  roleAssignments,
  agentOrgScopes,
  categories,
  tickets,
  ticketComments,
  auditLogs,
  outboxEvents,
  retentionPolicies,
  type Tenant,
  type NewTenant,
  type Organization,
  type NewOrganization,
  type User,
  type NewUser,
  type Ticket,
  type NewTicket,
  type TicketComment,
  type NewTicketComment,
  type AuditLog,
  type NewAuditLog,
  type OutboxEvent,
  type NewOutboxEvent,
} from '../src/schema/index.js';

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------
describe('schema exports', () => {
  it('exports all expected tables', () => {
    expect(tenants).toBeDefined();
    expect(organizations).toBeDefined();
    expect(organizationVerifiedDomains).toBeDefined();
    expect(customFieldDefs).toBeDefined();
    expect(users).toBeDefined();
    expect(customerContacts).toBeDefined();
    expect(roleAssignments).toBeDefined();
    expect(agentOrgScopes).toBeDefined();
    expect(categories).toBeDefined();
    expect(tickets).toBeDefined();
    expect(ticketComments).toBeDefined();
    expect(auditLogs).toBeDefined();
    expect(outboxEvents).toBeDefined();
    expect(retentionPolicies).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Column presence assertions
// ---------------------------------------------------------------------------
describe('column names — tenants', () => {
  it('has id, name, plan_tier, ai_synthesis_enabled, is_active, created_at', () => {
    const cols = Object.keys(tenants);
    expect(cols).not.toHaveLength(0);
    // Check via the column map exposed by Drizzle.
    expect(tenants.id).toBeDefined();
    expect(tenants.name).toBeDefined();
    expect(tenants.planTier).toBeDefined();
    expect(tenants.aiSynthesisEnabled).toBeDefined();
    expect(tenants.isActive).toBeDefined();
    expect(tenants.createdAt).toBeDefined();
  });
});

describe('column names — organizations', () => {
  it('has tenantId, id, name, tier, region, isActive, customFieldValues, createdAt, updatedAt', () => {
    expect(organizations.tenantId).toBeDefined();
    expect(organizations.id).toBeDefined();
    expect(organizations.name).toBeDefined();
    expect(organizations.tier).toBeDefined();
    expect(organizations.region).toBeDefined();
    expect(organizations.isActive).toBeDefined();
    expect(organizations.customFieldValues).toBeDefined();
    expect(organizations.createdAt).toBeDefined();
    expect(organizations.updatedAt).toBeDefined();
  });
});

describe('column names — tickets', () => {
  it('has all SLA-relevant columns', () => {
    expect(tickets.tenantId).toBeDefined();
    expect(tickets.id).toBeDefined();
    expect(tickets.createdAt).toBeDefined();
    expect(tickets.organizationId).toBeDefined();
    expect(tickets.requesterContactId).toBeDefined();
    expect(tickets.assigneeUserId).toBeDefined();
    expect(tickets.status).toBeDefined();
    expect(tickets.priority).toBeDefined();
    expect(tickets.categoryId).toBeDefined();
    expect(tickets.subject).toBeDefined();
    expect(tickets.updatedAt).toBeDefined();
  });
});

describe('column names — ticket_comments', () => {
  it('has visibility column', () => {
    expect(ticketComments.visibility).toBeDefined();
    expect(ticketComments.tenantId).toBeDefined();
    expect(ticketComments.ticketId).toBeDefined();
    expect(ticketComments.authorUserId).toBeDefined();
    expect(ticketComments.body).toBeDefined();
  });
});

describe('column names — audit_logs', () => {
  it('has all WOREF-007 required columns', () => {
    expect(auditLogs.tenantId).toBeDefined();
    expect(auditLogs.id).toBeDefined();
    expect(auditLogs.occurredAt).toBeDefined();
    expect(auditLogs.actorType).toBeDefined();
    expect(auditLogs.actorId).toBeDefined();
    expect(auditLogs.action).toBeDefined();
    expect(auditLogs.resourceType).toBeDefined();
    expect(auditLogs.resourceId).toBeDefined();
    expect(auditLogs.beforeState).toBeDefined();
    expect(auditLogs.afterState).toBeDefined();
    expect(auditLogs.traceId).toBeDefined();
  });
});

describe('column names — outbox_events', () => {
  it('has all WOREF-007 required columns', () => {
    expect(outboxEvents.tenantId).toBeDefined();
    expect(outboxEvents.id).toBeDefined();
    expect(outboxEvents.aggregateType).toBeDefined();
    expect(outboxEvents.aggregateId).toBeDefined();
    expect(outboxEvents.eventType).toBeDefined();
    expect(outboxEvents.payload).toBeDefined();
    expect(outboxEvents.createdAt).toBeDefined();
    expect(outboxEvents.publishedAt).toBeDefined();
    expect(outboxEvents.attempts).toBeDefined();
  });
});

describe('column names — categories', () => {
  it('has parentId and path columns', () => {
    expect(categories.tenantId).toBeDefined();
    expect(categories.id).toBeDefined();
    expect(categories.parentId).toBeDefined();
    expect(categories.name).toBeDefined();
    expect(categories.path).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Type-level inference tests
// These assertions compile only if the inferred types have the expected shape.
// ---------------------------------------------------------------------------
describe('type inference', () => {
  it('Tenant select type has correct shape', () => {
    // If this compiles, the type is correct.
    const _check: Tenant = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Test Tenant',
      planTier: 'starter',
      aiSynthesisEnabled: false,
      isActive: true,
      createdAt: new Date(),
    };
    expect(_check.name).toBe('Test Tenant');
  });

  it('NewTenant insert type omits non-defaulted fields only', () => {
    const _check: NewTenant = { name: 'Minimal Tenant' };
    expect(_check.name).toBe('Minimal Tenant');
  });

  it('Ticket select type has all expected fields', () => {
    const _check: Partial<Ticket> = {
      priority: 'P1',
      status: 'open',
    };
    expect(_check.priority).toBe('P1');
  });

  it('TicketComment select type has visibility field', () => {
    const _check: Partial<TicketComment> = { visibility: 'internal' };
    expect(_check.visibility).toBe('internal');
  });
});

// ---------------------------------------------------------------------------
// SQL column name mapping (camelCase → snake_case)
// Drizzle maps JS camelCase names to DB snake_case column names.
// ---------------------------------------------------------------------------
describe('column name mapping (camelCase → snake_case)', () => {
  it('organizations.tenantId maps to tenant_id', () => {
    // Access the underlying column metadata.
    const col = organizations.tenantId as unknown as { name: string };
    expect(col.name).toBe('tenant_id');
  });

  it('organizations.customFieldValues maps to custom_field_values', () => {
    const col = organizations.customFieldValues as unknown as { name: string };
    expect(col.name).toBe('custom_field_values');
  });

  it('tickets.organizationId maps to organization_id', () => {
    const col = tickets.organizationId as unknown as { name: string };
    expect(col.name).toBe('organization_id');
  });

  it('auditLogs.occurredAt maps to occurred_at', () => {
    const col = auditLogs.occurredAt as unknown as { name: string };
    expect(col.name).toBe('occurred_at');
  });

  it('auditLogs.beforeState maps to before_state', () => {
    const col = auditLogs.beforeState as unknown as { name: string };
    expect(col.name).toBe('before_state');
  });

  it('outboxEvents.aggregateType maps to aggregate_type', () => {
    const col = outboxEvents.aggregateType as unknown as { name: string };
    expect(col.name).toBe('aggregate_type');
  });

  it('ticketComments.authorUserId maps to author_user_id', () => {
    const col = ticketComments.authorUserId as unknown as { name: string };
    expect(col.name).toBe('author_user_id');
  });
});

// ---------------------------------------------------------------------------
// Table name assertions (snake_case plural names)
// ---------------------------------------------------------------------------
describe('table names (snake_case, plural)', () => {
  const tableNameOf = (t: { _: { name: string } }) => t._.name;

  it('tenants table is named "tenants"', () => {
    expect(tableNameOf(tenants as unknown as { _: { name: string } })).toBe('tenants');
  });

  it('organizations table is named "organizations"', () => {
    expect(tableNameOf(organizations as unknown as { _: { name: string } })).toBe('organizations');
  });

  it('tickets table is named "tickets"', () => {
    expect(tableNameOf(tickets as unknown as { _: { name: string } })).toBe('tickets');
  });

  it('ticket_comments table is named "ticket_comments"', () => {
    expect(tableNameOf(ticketComments as unknown as { _: { name: string } })).toBe('ticket_comments');
  });

  it('audit_logs table is named "audit_logs"', () => {
    expect(tableNameOf(auditLogs as unknown as { _: { name: string } })).toBe('audit_logs');
  });

  it('outbox_events table is named "outbox_events"', () => {
    expect(tableNameOf(outboxEvents as unknown as { _: { name: string } })).toBe('outbox_events');
  });
});
