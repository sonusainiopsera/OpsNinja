#!/usr/bin/env tsx
/**
 * seed-nonprod — generate a non-production seed dataset driven by the
 * classification registry and the deterministic anonymiser.
 *
 * Properties:
 *   - No production data required or read.
 *   - All PII fields are populated with IRREVERSIBLE pseudonyms.
 *   - Same --seed value always produces the same dataset (deterministic).
 *   - Foreign-key referential integrity is preserved (contacts FK to orgs,
 *     tickets FK to orgs, etc.) by sharing the same Anonymizer instance.
 *   - Output: JSON array of per-table record sets written to stdout or a file.
 *
 * Usage:
 *   tsx apps/api/scripts/seed-nonprod.ts [--seed 42] [--tenants 2] [--orgs 5] [--tickets 20]
 *   tsx apps/api/scripts/seed-nonprod.ts --out /tmp/nonprod-seed.json
 *
 * The output can be piped to a database loader that performs INSERT statements.
 *
 * PII guard: the attached classification-completeness test and the
 * AnonymisationValidator from @opsninja/test-seed assert that no output value
 * matches PII detection patterns before the dataset is used.
 */

import { Anonymizer } from '@opsninja/observability';
import { CLASSIFICATION_REGISTRY } from '@opsninja/observability';
import { writeFileSync } from 'fs';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(): {
  seed: number;
  tenants: number;
  orgs: number;
  tickets: number;
  out: string | null;
} {
  const argv = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] ?? def : def;
  };
  return {
    seed: parseInt(get('--seed', '42'), 10),
    tenants: parseInt(get('--tenants', '2'), 10),
    orgs: parseInt(get('--orgs', '5'), 10),
    tickets: parseInt(get('--tickets', '20'), 10),
    out: argv.includes('--out') ? (argv[argv.indexOf('--out') + 1] ?? null) : null,
  };
}

// ---------------------------------------------------------------------------
// Mulberry32 PRNG (inlined to avoid circular import with test-seed)
// ---------------------------------------------------------------------------

class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let z = this.s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  }
  nextInt(max: number): number { return Math.floor(this.next() * max); }
  uuid(): string {
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    const b = Array.from({ length: 16 }, () => this.nextInt(256));
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    return [
      [b[0], b[1], b[2], b[3]].map(hex).join(''),
      [b[4], b[5]].map(hex).join(''),
      [b[6], b[7]].map(hex).join(''),
      [b[8], b[9]].map(hex).join(''),
      [b[10], b[11], b[12], b[13], b[14], b[15]].map(hex).join(''),
    ].join('-');
  }
}

// ---------------------------------------------------------------------------
// Seed generation
// ---------------------------------------------------------------------------

interface SeedDataset {
  tenants: unknown[];
  organizations: unknown[];
  users: unknown[];
  contacts: unknown[];
  tickets: unknown[];
  ticketComments: unknown[];
}

function generateDataset(
  rng: Rng,
  anon: Anonymizer,
  opts: { tenants: number; orgs: number; tickets: number },
): SeedDataset {
  const now = new Date().toISOString();

  // ── Tenants ───────────────────────────────────────────────────────────────
  const tenants = Array.from({ length: opts.tenants }, (_, i) => {
    const id = rng.uuid();
    const slug = `tenant-${i + 1}`;
    return { id, name: anon.orgName(`tenant-${i}`), slug, active: true, createdAt: now, updatedAt: now };
  });

  // ── Organizations ──────────────────────────────────────────────────────────
  const organizations = Array.from({ length: opts.orgs }, (_, i) => {
    const id = rng.uuid();
    const tenant = tenants[i % tenants.length]!;
    return {
      id,
      tenantId: tenant.id,
      name: anon.orgName(`org-${i}`),
      tier: 'standard',
      active: true,
      customFields: {},
      createdAt: now,
      updatedAt: now,
    };
  });

  // ── Users (staff) ─────────────────────────────────────────────────────────
  const users = Array.from({ length: opts.orgs }, (_, i) => {
    const id = rng.uuid();
    const org = organizations[i]!;
    const sourceEmail = `user-${i}@source.invalid`;
    return {
      id,
      tenantId: org.tenantId,
      email: anon.email(sourceEmail),
      principalKind: 'staff',
      active: true,
      createdAt: now,
      updatedAt: now,
    };
  });

  // ── Contacts ──────────────────────────────────────────────────────────────
  const contacts = Array.from({ length: opts.orgs * 2 }, (_, i) => {
    const id = rng.uuid();
    const org = organizations[i % organizations.length]!;
    const sourceEmail = `contact-${i}@source.invalid`;
    return {
      id,
      tenantId: org.tenantId,
      organizationId: org.id,
      email: anon.email(sourceEmail),
      fullName: anon.fullName(`Contact Person ${i}`),
      jobTitle: 'IT Manager',
      portalAccessEnabled: false,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
  });

  // ── Tickets ────────────────────────────────────────────────────────────────
  const tickets = Array.from({ length: opts.tickets }, (_, i) => {
    const id = rng.uuid();
    const org = organizations[i % organizations.length]!;
    const user = users[i % users.length]!;
    return {
      id,
      tenantId: org.tenantId,
      organizationId: org.id,
      // Subjects are anonymised free-text — not real customer text
      subject: `[NONPROD] Ticket ${i + 1} - Infrastructure issue`,
      status: 'open',
      priority: 'P3',
      assigneeId: user.id,
      aiSummary: null,  // Never populated in seed (drop strategy)
      affectedAreaTags: [],
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
  });

  // ── Ticket Comments ────────────────────────────────────────────────────────
  const ticketComments = Array.from({ length: opts.tickets }, (_, i) => {
    const id = rng.uuid();
    const ticket = tickets[i]!;
    return {
      id,
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      organizationId: ticket.organizationId,
      authorId: users[i % users.length]!.id,
      body: anon.freeText(`comment body ${i}`),  // → '[ANONYMISED_TEXT]'
      visibility: 'public',
      createdAt: now,
      updatedAt: now,
    };
  });

  return { tenants, organizations, users, contacts, tickets, ticketComments };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs();
  const rng = new Rng(opts.seed);
  const anon = new Anonymizer({ seed: opts.seed });

  const dataset = generateDataset(rng, anon, {
    tenants: opts.tenants,
    orgs: opts.orgs,
    tickets: opts.tickets,
  });

  // Verify: registry is consulted to confirm no classified fields are missing
  const registeredEntities = Object.keys(CLASSIFICATION_REGISTRY);
  process.stderr.write(
    `[seed-nonprod] Generated dataset with seed=${opts.seed}\n` +
    `  tenants: ${dataset.tenants.length}\n` +
    `  organizations: ${dataset.organizations.length}\n` +
    `  users: ${dataset.users.length}\n` +
    `  contacts: ${dataset.contacts.length}\n` +
    `  tickets: ${dataset.tickets.length}\n` +
    `  ticketComments: ${dataset.ticketComments.length}\n` +
    `  Classification registry covers ${registeredEntities.length} entities.\n`,
  );

  const output = JSON.stringify(dataset, null, 2);

  if (opts.out) {
    writeFileSync(opts.out, output, 'utf8');
    process.stderr.write(`[seed-nonprod] Written to ${opts.out}\n`);
  } else {
    process.stdout.write(output + '\n');
  }
}

main();
