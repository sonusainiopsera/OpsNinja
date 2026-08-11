import { describe, it, expect } from 'vitest';
import { SeededRandom } from '../src/prng';
import { buildTenants } from '../src/factories/tenant.factory';
import { buildOrganizations } from '../src/factories/organization.factory';
import { buildUsers, ALLOWED_EMAIL_DOMAINS } from '../src/factories/user.factory';
import { buildTickets, TICKET_STATUSES, TICKET_PRIORITIES } from '../src/factories/ticket.factory';
import { buildComments } from '../src/factories/comment.factory';
import { buildAuditLogs } from '../src/factories/audit-log.factory';
import { buildPartitionWindow } from '../src/partition-dates';
import { COLLISION_MATRIX, SEED_TENANT_SLUGS } from '../src/collision-matrix';

const SEED = 42;
const NOW = new Date('2025-06-15T12:00:00Z');

describe('tenant factory', () => {
  it('produces 3 tenants with expected slugs', () => {
    const rng = new SeededRandom(SEED);
    const tenants = buildTenants(rng, NOW);
    expect(tenants).toHaveLength(3);
    expect(tenants.map((t) => t.slug).sort()).toEqual([...SEED_TENANT_SLUGS].sort());
  });

  it('is deterministic under the same seed', () => {
    const r1 = new SeededRandom(SEED);
    const r2 = new SeededRandom(SEED);
    const t1 = buildTenants(r1, NOW);
    const t2 = buildTenants(r2, NOW);
    expect(t1[0]!.id).toBe(t2[0]!.id);
    expect(t1[1]!.id).toBe(t2[1]!.id);
  });
});

describe('organization factory', () => {
  it('produces the requested count', () => {
    const rng = new SeededRandom(SEED);
    const tenantId = 'tenant-1';
    const orgs = buildOrganizations(rng, tenantId, 12, NOW);
    expect(orgs).toHaveLength(12);
  });

  it('all orgs belong to the given tenant', () => {
    const rng = new SeededRandom(SEED);
    const tenantId = 'tenant-1';
    const orgs = buildOrganizations(rng, tenantId, 8, NOW);
    for (const org of orgs) {
      expect(org.tenantId).toBe(tenantId);
    }
  });

  it('first orgs use shared names from collision matrix', () => {
    const rng = new SeededRandom(SEED);
    const orgs = buildOrganizations(rng, 'tenant-1', 5, NOW);
    const names = orgs.slice(0, COLLISION_MATRIX.sharedOrgNames.length).map((o) => o.record.name);
    for (const name of COLLISION_MATRIX.sharedOrgNames) {
      expect(names).toContain(name);
    }
  });
});

describe('user factory', () => {
  it('produces the requested count', () => {
    const rng = new SeededRandom(SEED);
    const users = buildUsers(rng, 'tenant-1', 20, NOW);
    expect(users).toHaveLength(20);
  });

  it('all emails use allowed domains only', () => {
    const rng = new SeededRandom(SEED);
    const users = buildUsers(rng, 'tenant-1', 50, NOW);
    for (const user of users) {
      const domain = user.email.split('@')[1]!;
      expect(ALLOWED_EMAIL_DOMAINS as readonly string[]).toContain(domain);
    }
  });

  it('first users have shared email local-parts for collision testing', () => {
    const rng = new SeededRandom(SEED);
    const users = buildUsers(rng, 'tenant-1', 10, NOW);
    const localParts = users
      .slice(0, COLLISION_MATRIX.sharedEmailLocalParts.length)
      .map((u) => u.email.split('@')[0]!);
    for (const lp of COLLISION_MATRIX.sharedEmailLocalParts) {
      expect(localParts).toContain(lp);
    }
  });
});

describe('ticket factory', () => {
  const partitionWindow = buildPartitionWindow(14, 1, NOW);

  it('produces the requested count', () => {
    const rng = new SeededRandom(SEED);
    const tickets = buildTickets(rng, 'tenant-1', ['org-1', 'org-2'], ['user-1'], 400, partitionWindow);
    expect(tickets).toHaveLength(400);
  });

  it('all statuses are valid', () => {
    const rng = new SeededRandom(SEED);
    const tickets = buildTickets(rng, 'tenant-1', ['org-1'], ['user-1'], 100, partitionWindow);
    for (const t of tickets) {
      expect(TICKET_STATUSES as readonly string[]).toContain(t.record.status);
    }
  });

  it('all priorities are valid', () => {
    const rng = new SeededRandom(SEED);
    const tickets = buildTickets(rng, 'tenant-1', ['org-1'], ['user-1'], 100, partitionWindow);
    for (const t of tickets) {
      expect(TICKET_PRIORITIES as readonly string[]).toContain(t.record.priority);
    }
  });

  it('spans multiple distinct monthly partitions', () => {
    const rng = new SeededRandom(SEED);
    const tickets = buildTickets(rng, 'tenant-1', ['org-1'], ['user-1'], 400, partitionWindow);
    const months = new Set(tickets.map((t) => {
      const d = t.record.createdAt!;
      return `${d.getFullYear()}-${d.getMonth()}`;
    }));
    expect(months.size).toBeGreaterThanOrEqual(14);
  });

  it('first tickets use shared subjects from collision matrix', () => {
    const rng = new SeededRandom(SEED);
    const tickets = buildTickets(rng, 'tenant-1', ['org-1'], [], 20, partitionWindow);
    const subjects = tickets
      .slice(0, COLLISION_MATRIX.sharedTicketSubjects.length)
      .map((t) => t.record.subject);
    for (const subject of COLLISION_MATRIX.sharedTicketSubjects) {
      expect(subjects).toContain(subject);
    }
  });
});

describe('comment factory', () => {
  it('generates comments for all tickets', () => {
    const rng = new SeededRandom(SEED);
    const tickets = [
      { id: 't1', organizationId: 'org-1' },
      { id: 't2', organizationId: 'org-1' },
    ];
    const comments = buildComments(rng, 'tenant-1', tickets, 5, ['user-1']);
    expect(comments.length).toBeGreaterThan(0);
    const ticketIds = new Set(comments.map((c) => c.ticketId));
    expect(ticketIds).toContain('t1');
    expect(ticketIds).toContain('t2');
  });

  it('includes both public and internal comments', () => {
    const rng = new SeededRandom(SEED);
    const tickets = Array.from({ length: 20 }, (_, i) => ({
      id: `ticket-${i}`,
      organizationId: 'org-1',
    }));
    const comments = buildComments(rng, 'tenant-1', tickets, 7, ['user-1']);
    const visibilities = new Set(comments.map((c) => c.record.visibility));
    expect(visibilities).toContain('public');
    expect(visibilities).toContain('internal');
  });
});

describe('audit log factory', () => {
  const partitionWindow = buildPartitionWindow(14, 1, NOW);

  it('produces the requested count', () => {
    const rng = new SeededRandom(SEED);
    const logs = buildAuditLogs(rng, 'tenant-1', ['user-1'], 100, partitionWindow);
    expect(logs.length).toBeGreaterThanOrEqual(100);
  });

  it('spans multiple distinct monthly partitions', () => {
    const rng = new SeededRandom(SEED);
    const logs = buildAuditLogs(rng, 'tenant-1', ['user-1'], 200, partitionWindow);
    const months = new Set(logs.map((l) => {
      const d = l.record.createdAt!;
      return `${d.getFullYear()}-${d.getMonth()}`;
    }));
    expect(months.size).toBeGreaterThanOrEqual(14);
  });
});
