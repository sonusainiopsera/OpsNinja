/**
 * Pure factory for Jira integration records.
 * jira_connections, jira_links, jira_sync_events.
 * Collision matrix is applied to jira_issue_keys across tenant pairs.
 */

import type { SeededPrng } from '../prng';
import type { SeedTenant } from './organizations.factory';
import type { SeedTicket } from './tickets.factory';
import type { CollisionMatrix } from '../collision-matrix';

export interface SeedJiraConnection {
  id: string;
  tenantId: string;
  jiraBaseUrl: string;
  projectKey: string;
  isActive: boolean;
  createdAt: Date;
}

export interface SeedJiraLink {
  id: string;
  tenantId: string;
  ticketId: string;
  connectionId: string;
  jiraIssueKey: string;
  jiraIssueId: string;
  jiraSummary: string;
  jiraStatus: string;
  createdAt: Date;
  syncedAt: Date;
}

export interface SeedJiraSyncEvent {
  id: string;
  tenantId: string;
  connectionId: string;
  jiraIssueKey: string;
  eventType: 'inbound' | 'outbound';
  payload: Record<string, unknown>;
  processedAt: Date;
  createdAt: Date;
}

const PROJECT_KEYS = ['OPS', 'INFRA', 'PLATFORM', 'DEVEX', 'SRE', 'ONCALL'];
const JIRA_STATUSES = ['To Do', 'In Progress', 'Done', 'Blocked'];
const SYNC_EVENT_TYPES = ['issue_updated', 'issue_created', 'comment_added', 'status_changed'];

export function buildJiraConnections(
  prng: SeededPrng,
  tenants: SeedTenant[],
  now: Date,
): SeedJiraConnection[] {
  return tenants.map((tenant) => ({
    id: prng.uuid(),
    tenantId: tenant.id,
    jiraBaseUrl: `https://jira-${tenant.slug}.atlassian.net`,
    projectKey: prng.pick(PROJECT_KEYS),
    isActive: true,
    createdAt: new Date(now.getTime() - prng.int(30, 365) * 86_400_000),
  }));
}

export function buildJiraLinks(
  prng: SeededPrng,
  tenants: SeedTenant[],
  tickets: SeedTicket[],
  connections: SeedJiraConnection[],
  now: Date,
  collisionMatrix: CollisionMatrix,
): SeedJiraLink[] {
  const links: SeedJiraLink[] = [];
  const connectionByTenant = new Map(connections.map((c) => [c.tenantId, c]));

  for (let ti = 0; ti < tenants.length; ti++) {
    const tenant = tenants[ti];
    const connection = connectionByTenant.get(tenant.id);
    if (!connection) continue;

    const tenantTickets = tickets
      .filter((t) => t.tenantId === tenant.id)
      .filter(() => prng.chance(0.5)); // ~50% of tickets have a Jira link

    const collisionKeys = collisionMatrix.jiraIssueKeys
      .filter((c) => c.pair.tenantAIndex === ti || c.pair.tenantBIndex === ti)
      .map((c) => c.issueKey);

    let issueSeq = 1;
    let collisionIdx = 0;

    for (const ticket of tenantTickets) {
      let issueKey: string;
      if (collisionIdx < collisionKeys.length) {
        issueKey = collisionKeys[collisionIdx++];
      } else {
        issueKey = `${connection.projectKey}-${issueSeq++}`;
      }

      const createdAt = new Date(ticket.createdAt.getTime() + prng.int(60_000, 3_600_000));
      links.push({
        id: prng.uuid(),
        tenantId: tenant.id,
        ticketId: ticket.id,
        connectionId: connection.id,
        jiraIssueKey: issueKey,
        jiraIssueId: String(prng.int(10000, 99999)),
        jiraSummary: ticket.subject,
        jiraStatus: prng.pick(JIRA_STATUSES),
        createdAt,
        syncedAt: new Date(createdAt.getTime() + prng.int(1000, 60_000)),
      });
    }
  }
  return links;
}

export function buildJiraSyncEvents(
  prng: SeededPrng,
  links: SeedJiraLink[],
  now: Date,
): SeedJiraSyncEvent[] {
  const events: SeedJiraSyncEvent[] = [];
  for (const link of links) {
    const count = prng.int(1, 5);
    for (let i = 0; i < count; i++) {
      const processedAt = new Date(link.syncedAt.getTime() + i * prng.int(60_000, 3_600_000));
      events.push({
        id: prng.uuid(),
        tenantId: link.tenantId,
        connectionId: link.connectionId,
        jiraIssueKey: link.jiraIssueKey,
        eventType: prng.chance(0.6) ? 'inbound' : 'outbound',
        payload: {
          webhookEvent: prng.pick(SYNC_EVENT_TYPES),
          issueKey: link.jiraIssueKey,
          issueId: link.jiraIssueId,
        },
        processedAt,
        createdAt: processedAt,
      });
    }
  }
  return events;
}
