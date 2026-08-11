import { SeededPrng } from '../prng';
import { DEFAULT_COLLISION_MATRIX } from '../collision-matrix';
import { buildTenants, buildOrganizations } from '../factories/organizations.factory';
import { buildContacts } from '../factories/users.factory';
import { buildTickets } from '../factories/tickets.factory';
import { buildJiraConnections, buildJiraLinks } from '../factories/jira.factory';
import { partitionWindow, SMALL_PROFILE } from '../profiles';

const NOW = new Date('2025-01-15T00:00:00.000Z');
const SEED = 42;

describe('Tenant collision matrix', () => {
  let prng: SeededPrng;

  beforeEach(() => {
    prng = new SeededPrng(SEED);
  });

  it('at least two tenants share a contact email local-part', () => {
    const tenants = buildTenants(prng, 3);
    const orgs = buildOrganizations(prng, tenants, 4, NOW);
    const contacts = buildContacts(
      prng, tenants, orgs.map((o) => o.id), 4, NOW, DEFAULT_COLLISION_MATRIX,
    );

    for (const collision of DEFAULT_COLLISION_MATRIX.contactEmailLocalParts) {
      const { tenantAIndex, tenantBIndex } = collision.pair;
      const tenantA = tenants[tenantAIndex];
      const tenantB = tenants[tenantBIndex];
      const aLocalParts = contacts
        .filter((c) => c.tenantId === tenantA.id)
        .map((c) => c.email.split('@')[0]);
      const bLocalParts = contacts
        .filter((c) => c.tenantId === tenantB.id)
        .map((c) => c.email.split('@')[0]);
      // At least the collision local-part should appear in one of the tenants
      const found = aLocalParts.includes(collision.localPart) || bLocalParts.includes(collision.localPart);
      expect(found).toBe(true);
    }
  });

  it('at least two tenants share a ticket subject', () => {
    const tenants = buildTenants(prng, 3);
    const orgs = buildOrganizations(prng, tenants, 4, NOW);
    const { start, end } = partitionWindow(SMALL_PROFILE, NOW);
    const userIds = tenants.map(() => prng.uuid());
    const tkts = buildTickets(
      prng, tenants, orgs.map((o) => o.id), userIds, 400, start, end, DEFAULT_COLLISION_MATRIX,
    );

    for (const collision of DEFAULT_COLLISION_MATRIX.ticketSubjects) {
      const { tenantAIndex, tenantBIndex } = collision.pair;
      const tenantA = tenants[tenantAIndex];
      const tenantB = tenants[tenantBIndex];
      const aSubjects = tkts.filter((t) => t.tenantId === tenantA.id).map((t) => t.subject);
      const bSubjects = tkts.filter((t) => t.tenantId === tenantB.id).map((t) => t.subject);
      expect(aSubjects).toContain(collision.subject);
      expect(bSubjects).toContain(collision.subject);
    }
  });

  it('jira issue keys collide across tenants but jira links within a tenant are unique per ticket', () => {
    const tenants = buildTenants(prng, 3);
    const orgs = buildOrganizations(prng, tenants, 4, NOW);
    const { start, end } = partitionWindow(SMALL_PROFILE, NOW);
    const userIds = tenants.map(() => prng.uuid());
    const tkts = buildTickets(
      prng, tenants, orgs.map((o) => o.id), userIds, 400, start, end, DEFAULT_COLLISION_MATRIX,
    );
    const connections = buildJiraConnections(prng, tenants, NOW);
    const links = buildJiraLinks(prng, tenants, tkts, connections, NOW, DEFAULT_COLLISION_MATRIX);

    // Within each tenant, (ticket_id, jira_issue_key) should be unique
    for (const tenant of tenants) {
      const tenantLinks = links.filter((l) => l.tenantId === tenant.id);
      const seen = new Set<string>();
      for (const link of tenantLinks) {
        const key = `${link.ticketId}:${link.jiraIssueKey}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});
