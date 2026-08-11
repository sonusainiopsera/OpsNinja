/**
 * JiraLinksRepository — data access for ticket_jira_links (WO-053).
 *
 * Extends TenantRepository so all queries run inside the RLS-bound tenant
 * transaction set up by TenantContextInterceptor.
 */

import { Injectable } from '@nestjs/common';
import { eq, and, inArray } from 'drizzle-orm';
import {
  ticketJiraLinks,
  outboxEvents,
  type TicketJiraLink,
  type NewTicketJiraLink,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';

@Injectable()
export class JiraLinksRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findById(tenantId: string, id: string): Promise<TicketJiraLink | null> {
    const rows = await this.tx
      .select()
      .from(ticketJiraLinks)
      .where(and(eq(ticketJiraLinks.tenantId, tenantId), eq(ticketJiraLinks.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByTicketId(tenantId: string, ticketId: string): Promise<TicketJiraLink[]> {
    return this.tx
      .select()
      .from(ticketJiraLinks)
      .where(and(
        eq(ticketJiraLinks.tenantId, tenantId),
        eq(ticketJiraLinks.ticketId, ticketId),
      ))
      .orderBy(ticketJiraLinks.createdAt);
  }

  /**
   * Find any active (pending|linked) link for this (ticket, projectKey).
   * Used to enforce the duplicate-escalation constraint before the unique index.
   */
  async findActive(
    tenantId: string,
    ticketId: string,
    projectKey: string,
  ): Promise<TicketJiraLink | null> {
    const rows = await this.tx
      .select()
      .from(ticketJiraLinks)
      .where(and(
        eq(ticketJiraLinks.tenantId, tenantId),
        eq(ticketJiraLinks.ticketId, ticketId),
        eq(ticketJiraLinks.projectKey, projectKey),
        inArray(ticketJiraLinks.linkState, ['pending', 'linked']),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Writes
  // --------------------------------------------------------------------------

  async insert(data: NewTicketJiraLink): Promise<TicketJiraLink> {
    const rows = await this.tx
      .insert(ticketJiraLinks)
      .values(data)
      .returning();
    return rows[0]!;
  }

  async updateLinkState(
    tenantId: string,
    id: string,
    patch: Partial<Pick<TicketJiraLink,
      'linkState' | 'jiraIssueId' | 'jiraIssueKey' | 'jiraIssueUrl' |
      'jiraStatus' | 'jiraAssignee' | 'lastSyncedAt' | 'errorCode' | 'errorMessage'
    >>,
  ): Promise<TicketJiraLink | null> {
    const rows = await this.tx
      .update(ticketJiraLinks)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(ticketJiraLinks.tenantId, tenantId), eq(ticketJiraLinks.id, id)))
      .returning();
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Outbox (same transaction)
  // --------------------------------------------------------------------------

  /** Emit a jira.link.* outbox event within the current transaction. */
  async emitOutboxEvent(
    tenantId: string,
    linkId: string,
    eventType: 'jira.link.requested' | 'jira.link.retry',
    payload: Record<string, unknown>,
    traceId?: string,
  ): Promise<void> {
    await this.tx
      .insert(outboxEvents)
      .values({
        tenantId,
        aggregateType: 'jira_link',
        aggregateId: linkId,
        eventType,
        payload,
        traceId: traceId ?? null,
        status: 'pending',
      });
  }
}
