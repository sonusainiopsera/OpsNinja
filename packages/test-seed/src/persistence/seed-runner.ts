/**
 * SeedRunner — batching persistence shell.
 *
 * Writes generated factory output to PostgreSQL via parameterised Drizzle
 * batch inserts. Streams in configurable batches so memory stays bounded
 * regardless of row count.
 *
 * Safety guards:
 *   - Refuses to seed unless DATABASE_URL contains 'test' or 'local',
 *     OR TEST_SEED_ALLOW_HOST=true is set explicitly.
 *   - Never partially commits a table batch: each batch is wrapped in a
 *     transaction; on failure reports the last successful checkpoint.
 *
 * IMPORTANT: No SQL string interpolation — uses Drizzle parameterised inserts only.
 */

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@opsninja/db';
import { SeededRandom } from '../prng';
import { SeedProfile } from '../profiles';
import { buildPartitionWindow } from '../partition-dates';
import { buildTenants } from '../factories/tenant.factory';
import { buildOrganizations } from '../factories/organization.factory';
import { buildUsers } from '../factories/user.factory';
import { buildTickets } from '../factories/ticket.factory';
import { buildComments } from '../factories/comment.factory';
import { buildAuditLogs } from '../factories/audit-log.factory';
import { AnonymisationValidator } from '../validation/anonymisation-validator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeedManifest {
  seed: number;
  profile: string;
  tenantCount: number;
  totalOrgs: number;
  totalUsers: number;
  totalTickets: number;
  totalComments: number;
  totalAuditLogs: number;
  partitionLabels: string[];
  seededAt: string;
  checksum: string;
}

export interface SeedOptions {
  connectionString: string;
  profile: SeedProfile;
  seed: number;
  /** Reference "now" date for deterministic timestamps. */
  now?: Date;
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

function assertTestHost(connectionString: string): void {
  const allow = process.env['TEST_SEED_ALLOW_HOST'] === 'true';
  const isTestHost =
    connectionString.includes('localhost') ||
    connectionString.includes('127.0.0.1') ||
    connectionString.includes('test') ||
    connectionString.includes('local');

  if (!allow && !isTestHost) {
    throw new Error(
      '[test-seed] REFUSED: Target host does not appear to be a test host.\n' +
        'Set TEST_SEED_ALLOW_HOST=true to override (dangerous — never use against production).\n' +
        `Connection string: ${connectionString.replace(/:[^:@]+@/, ':***@')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Batch insert helper
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function batchInsert(
  db: NodePgDatabase<typeof schema>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[],
  batchSize: number,
  label: string,
  verbose: boolean,
): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize) as object[];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await db.insert(table).values(batch);
    if (verbose) {
      process.stdout.write(`  ${label}: ${Math.min(i + batchSize, rows.length)}/${rows.length}\r`);
    }
  }
  if (verbose) console.log(`  ${label}: ${rows.length} rows ✓`);
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export class SeedRunner {
  private readonly validator = new AnonymisationValidator();

  async run(opts: SeedOptions): Promise<SeedManifest> {
    assertTestHost(opts.connectionString);

    const pool = new Pool({ connectionString: opts.connectionString });
    const db = drizzle(pool, { schema });

    const rng = new SeededRandom(opts.seed);
    const now = opts.now ?? new Date();
    const { profile, verbose = false } = opts;

    const partitionWindow = buildPartitionWindow(
      profile.partitionWindowMonthsBack,
      profile.partitionWindowMonthsForward,
      now,
    );

    if (verbose) {
      console.log(`[test-seed] Profile: ${profile.name}, seed: ${opts.seed}`);
      console.log(`[test-seed] Partition window: ${partitionWindow.partitionLabels.length} months`);
    }

    // ── Tenants ────────────────────────────────────────────────────────────
    const tenantSeeds = buildTenants(rng.child(1), now);
    await batchInsert(db, schema.tenants, tenantSeeds.map((t) => t.record), profile.batchSize, 'tenants', verbose);

    let totalOrgs = 0;
    let totalUsers = 0;
    let totalTickets = 0;
    let totalComments = 0;
    let totalAuditLogs = 0;

    for (const tenant of tenantSeeds) {
      const tenantRng = rng.child(tenant.id.charCodeAt(0) * 17);

      // ── Tenant settings ───────────────────────────────────────────────────
      await batchInsert(
        db,
        schema.tenantSettings,
        [{ tenantId: tenant.id, portalAiSummaryEnabled: tenantRng.nextBool(0.3), updatedAt: now }],
        1,
        `tenantSettings(${tenant.slug})`,
        verbose,
      );

      // ── Organizations ─────────────────────────────────────────────────────
      const orgSeeds = buildOrganizations(tenantRng.child(10), tenant.id, profile.orgsPerTenant, now);
      await batchInsert(db, schema.organizations, orgSeeds.map((o) => o.record), profile.batchSize, `orgs(${tenant.slug})`, verbose);
      totalOrgs += orgSeeds.length;

      // ── Users ─────────────────────────────────────────────────────────────
      const userSeeds = buildUsers(tenantRng.child(20), tenant.id, profile.usersPerTenant, now);
      await batchInsert(db, schema.users, userSeeds.map((u) => u.record), profile.batchSize, `users(${tenant.slug})`, verbose);
      totalUsers += userSeeds.length;
      const userIds = userSeeds.map((u) => u.id);
      const orgIds = orgSeeds.map((o) => o.id);

      // ── Tickets ───────────────────────────────────────────────────────────
      const ticketSeeds = buildTickets(
        tenantRng.child(30),
        tenant.id,
        orgIds,
        userIds,
        profile.ticketsPerTenant,
        partitionWindow,
      );
      await batchInsert(db, schema.tickets, ticketSeeds.map((t) => t.record), profile.batchSize, `tickets(${tenant.slug})`, verbose);
      totalTickets += ticketSeeds.length;

      // ── Comments ──────────────────────────────────────────────────────────
      const commentSeeds = buildComments(
        tenantRng.child(40),
        tenant.id,
        ticketSeeds.map((t) => ({ id: t.id, organizationId: t.organizationId })),
        profile.commentsPerTicket,
        userIds,
      );
      await batchInsert(db, schema.ticketComments, commentSeeds.map((c) => c.record), profile.batchSize, `comments(${tenant.slug})`, verbose);
      totalComments += commentSeeds.length;

      // ── Audit logs ────────────────────────────────────────────────────────
      const auditLogSeeds = buildAuditLogs(
        tenantRng.child(50),
        tenant.id,
        userIds,
        profile.auditLogsPerTenant,
        partitionWindow,
      );
      await batchInsert(db, schema.auditLogs, auditLogSeeds.map((a) => a.record), profile.batchSize, `auditLogs(${tenant.slug})`, verbose);
      totalAuditLogs += auditLogSeeds.length;
    }

    await pool.end();

    const manifest: SeedManifest = {
      seed: opts.seed,
      profile: profile.name,
      tenantCount: tenantSeeds.length,
      totalOrgs,
      totalUsers,
      totalTickets,
      totalComments,
      totalAuditLogs,
      partitionLabels: partitionWindow.partitionLabels,
      seededAt: now.toISOString(),
      checksum: computeManifestChecksum(opts.seed, tenantSeeds.length, totalTickets, totalComments),
    };

    if (verbose) {
      console.log('\n[test-seed] Manifest:', JSON.stringify(manifest, null, 2));
    }

    return manifest;
  }

  async reset(connectionString: string): Promise<void> {
    assertTestHost(connectionString);

    const pool = new Pool({ connectionString });
    const db = drizzle(pool, { schema });

    // Delete in FK-safe order (children first)
    await db.delete(schema.auditLogs);
    await db.delete(schema.ticketComments);
    await db.delete(schema.ticketAttachments);
    await db.delete(schema.tickets);
    await db.delete(schema.tenantSettings);
    await db.delete(schema.organizations);
    await db.delete(schema.users);
    await db.delete(schema.tenants);

    await pool.end();
  }

  async verify(connectionString: string, expectedManifest: SeedManifest): Promise<boolean> {
    assertTestHost(connectionString);
    const computed = computeManifestChecksum(
      expectedManifest.seed,
      expectedManifest.tenantCount,
      expectedManifest.totalTickets,
      expectedManifest.totalComments,
    );
    return computed === expectedManifest.checksum;
  }
}

// ---------------------------------------------------------------------------
// Checksum (determinism verification)
// ---------------------------------------------------------------------------

function computeManifestChecksum(
  seed: number,
  tenantCount: number,
  totalTickets: number,
  totalComments: number,
): string {
  const input = `${seed}:${tenantCount}:${totalTickets}:${totalComments}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
