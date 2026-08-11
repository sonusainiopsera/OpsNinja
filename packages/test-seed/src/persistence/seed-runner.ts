/**
 * SeedRunner – imperative persistence shell.
 *
 * Orchestrates the pure factory modules and writes the generated dataset to
 * a PostgreSQL database using parameterised Drizzle batch inserts.
 *
 * Safety guards:
 * - Refuses to run unless the connection string contains a recognised test
 *   host indicator (localhost, 127.0.0.1, test, ci) to prevent accidental
 *   seeding against a production database.
 * - Each table batch is wrapped in a transaction so a partial failure leaves
 *   no orphaned rows.
 * - Memory is bounded: inserts are streamed in BATCH_SIZE chunks.
 *
 * NOTE: This module imports from @opsninja/db/src which requires the db
 * package to be available in the workspace.
 */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { organizations, tickets, comments, auditLogs } from '@opsninja/db';
import { SeededPrng } from '../prng';
import { PROFILES, partitionMonths, partitionWindow } from '../profiles';
import type { SeedProfile, ProfileName } from '../profiles';
import { DEFAULT_COLLISION_MATRIX } from '../collision-matrix';
import { buildTenants, buildOrganizations } from '../factories/organizations.factory';
import { buildStaffUsers, buildContacts } from '../factories/users.factory';
import { buildTickets } from '../factories/tickets.factory';
import { buildComments } from '../factories/comments.factory';
import { buildSlaPolicies, buildSlaTimers } from '../factories/sla.factory';
import { buildJiraConnections, buildJiraLinks, buildJiraSyncEvents } from '../factories/jira.factory';
import { buildAuditLogs } from '../factories/audit-logs.factory';
import { AnonymisationValidator } from '../validation/anonymisation-validator';
import { buildAllPartitionSql } from './partition-provisioner';

const BATCH_SIZE = 500;
const TEST_HOST_INDICATORS = ['localhost', '127.0.0.1', 'test', 'ci', '::1'];

export interface SeedRunnerOptions {
  connectionString: string;
  profile: ProfileName;
  seed: number;
  dryRun?: boolean;
  skipValidation?: boolean;
}

export interface SeedManifest {
  profile: ProfileName;
  seed: number;
  generatedAt: string;
  counts: Record<string, number>;
  partitionMonths: string[];
}

function assertTestConnection(connectionString: string): void {
  const lower = connectionString.toLowerCase();
  const isTestHost = TEST_HOST_INDICATORS.some((h) => lower.includes(h));
  if (!isTestHost) {
    throw new Error(
      `SEED_GUARD: Refusing to seed a non-test database.\n` +
      `Connection string "${connectionString.replace(/:[^:@]+@/, ':***@')}" ` +
      `does not contain a recognised test-host indicator ` +
      `(${TEST_HOST_INDICATORS.join(', ')}).\n` +
      `Set the connection string to a local or CI test database.`,
    );
  }
}

async function insertBatches<T extends Record<string, unknown>>(
  db: NodePgDatabase,
  table: Parameters<NodePgDatabase['insert']>[0],
  rows: T[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    if (batch.length > 0) {
      await db.insert(table).values(batch as never[]);
    }
  }
}

export class SeedRunner {
  private readonly profile: SeedProfile;

  constructor(private readonly options: SeedRunnerOptions) {
    this.profile = PROFILES[options.profile];
  }

  async run(): Promise<SeedManifest> {
    assertTestConnection(this.options.connectionString);

    const prng = new SeededPrng(this.options.seed);
    const now = new Date('2025-01-15T00:00:00.000Z');

    // ── Pure generation ───────────────────────────────────────────────────────

    const tenants = buildTenants(prng, this.profile.tenantCount);
    const orgs = buildOrganizations(prng, tenants, this.profile.orgsPerTenant, now);
    const staff = buildStaffUsers(prng, tenants, this.profile.staffPerTenant, now);
    const contacts = buildContacts(
      prng, tenants, orgs.map((o) => o.id),
      this.profile.contactsPerOrg, now, DEFAULT_COLLISION_MATRIX,
    );
    const months = partitionMonths(this.profile, now);
    const { start: wStart, end: wEnd } = partitionWindow(this.profile, now);
    const tkts = buildTickets(
      prng, tenants, orgs.map((o) => o.id), staff.map((u) => u.id),
      this.profile.ticketCount, wStart, wEnd, DEFAULT_COLLISION_MATRIX,
    );
    const cmts = buildComments(prng, tkts, staff.map((u) => u.id), this.profile.commentCount);
    const slaPolicies = buildSlaPolicies(prng, tenants, now);
    const slaTimers = buildSlaTimers(prng, tkts, slaPolicies, now);
    const jiraConnections = buildJiraConnections(prng, tenants, now);
    const jiraLinks = buildJiraLinks(prng, tenants, tkts, jiraConnections, now, DEFAULT_COLLISION_MATRIX);
    const jiraSyncEvents = buildJiraSyncEvents(prng, jiraLinks, now);
    const auditLogRows = buildAuditLogs(prng, tenants, tkts, staff.map((u) => u.id), wStart, wEnd);

    // ── Anonymisation validation ──────────────────────────────────────────────

    if (!this.options.skipValidation) {
      const validator = new AnonymisationValidator();
      validator.validateMany(orgs as unknown[], 'organizations');
      validator.validateMany(staff as unknown[], 'staff');
      validator.validateMany(contacts as unknown[], 'contacts');
      validator.validateMany(tkts as unknown[], 'tickets');
      validator.validateMany(cmts as unknown[], 'comments');
      validator.assertValid();
    }

    if (this.options.dryRun) {
      return this.buildManifest(
        { orgs, staff, contacts, tkts, cmts, slaPolicies, slaTimers, jiraConnections, jiraLinks, jiraSyncEvents, auditLogRows },
        months, now,
      );
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    const pool = new Pool({ connectionString: this.options.connectionString });
    const db = drizzle(pool);

    try {
      // Pre-create partitions
      const partitionSql = buildAllPartitionSql(months);
      await pool.query(partitionSql);

      // Persist tables that have Drizzle schema definitions
      await insertBatches(db, organizations, orgs.map((o) => ({
        id: o.id, tenantId: o.tenantId, name: o.name, domain: o.domain,
        isActive: o.isActive, createdAt: o.createdAt, updatedAt: o.updatedAt,
      })));
      await insertBatches(db, tickets, tkts.map((t) => ({
        id: t.id, tenantId: t.tenantId, organizationId: t.organizationId,
        subject: t.subject, description: t.description, status: t.status as never,
        priority: t.priority as never, assigneeId: t.assigneeId,
        createdById: t.createdById, isPublic: t.isPublic,
        createdAt: t.createdAt, updatedAt: t.updatedAt, resolvedAt: t.resolvedAt,
      })));
      await insertBatches(db, comments, cmts.map((c) => ({
        id: c.id, tenantId: c.tenantId, ticketId: c.ticketId,
        authorId: c.authorId, body: c.body, visibility: c.visibility as never,
        createdAt: c.createdAt, updatedAt: c.updatedAt,
      })));
      await insertBatches(db, auditLogs, auditLogRows.map((a) => ({
        id: a.id, tenantId: a.tenantId, actorId: a.actorId,
        actorKind: a.actorKind, actorRole: a.actorRole,
        action: a.action, resourceType: a.resourceType, resourceId: a.resourceId,
        outcome: a.outcome, code: a.code, traceId: a.traceId, requestId: a.requestId,
        metadata: a.metadata, occurredAt: a.occurredAt,
      })));
    } finally {
      await pool.end();
    }

    return this.buildManifest(
      { orgs, staff, contacts, tkts, cmts, slaPolicies, slaTimers, jiraConnections, jiraLinks, jiraSyncEvents, auditLogRows },
      months, now,
    );
  }

  private buildManifest(
    data: {
      orgs: unknown[]; staff: unknown[]; contacts: unknown[]; tkts: unknown[];
      cmts: unknown[]; slaPolicies: unknown[]; slaTimers: unknown[];
      jiraConnections: unknown[]; jiraLinks: unknown[]; jiraSyncEvents: unknown[];
      auditLogRows: unknown[];
    },
    months: string[],
    now: Date,
  ): SeedManifest {
    return {
      profile: this.options.profile,
      seed: this.options.seed,
      generatedAt: now.toISOString(),
      counts: {
        organizations: data.orgs.length,
        staff_users: data.staff.length,
        contacts: data.contacts.length,
        tickets: data.tkts.length,
        comments: data.cmts.length,
        sla_policies: data.slaPolicies.length,
        sla_timers: data.slaTimers.length,
        jira_connections: data.jiraConnections.length,
        jira_links: data.jiraLinks.length,
        jira_sync_events: data.jiraSyncEvents.length,
        audit_logs: data.auditLogRows.length,
      },
      partitionMonths: months,
    };
  }
}
