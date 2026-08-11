/**
 * JiraLinksService — business logic for ticket ↔ Jira issue links (WO-053).
 *
 * Public entry points:
 *   escalate(ticketId, dto, principal)  — create pending link + outbox event atomically
 *   list(ticketId, principal)           — get all links for a ticket
 *   retry(ticketId, linkId, principal)  — re-emit outbox event for failed link
 *   unlink(ticketId, linkId, principal) — soft-delete the association
 *
 * Constraints:
 *   - No Jira HTTP calls; all third-party interaction is deferred to the worker.
 *   - The link row and its outbox event are written in a single DB transaction.
 *   - Internal notes are excluded unless BOTH caller requests AND mapping allows it.
 *   - Duplicate escalation returns 409 JIRA_LINK_ALREADY_EXISTS.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  tickets,
  ticketComments,
  organizationsRegistry,
  type TicketJiraLink,
} from '@opsninja/db';
import { eq, and, desc } from 'drizzle-orm';
import { TenantRepository } from '../../../data/tenant-repository';
import { JiraLinksRepository } from './jira-links.repository';
import { JiraMappingRepository } from '../mapping/jira-mapping.repository';
import { JiraPayloadBuilder } from './jira-payload.builder';
import { AuditWriter } from '../../audit/audit-writer';
import type { PrincipalContext } from '../../../observability/request-context';
import type { EscalateLinkDto, JiraLinkResponse, JiraLinksListResponse, EscalateLinkResponse } from './jira-links.dto';
import type { SyncRules } from '@opsninja/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toResponse(link: TicketJiraLink): JiraLinkResponse {
  return {
    id: link.id,
    ticketId: link.ticketId,
    connectionId: link.connectionId,
    mappingId: link.mappingId,
    projectKey: link.projectKey,
    jiraIssueId: link.jiraIssueId ?? null,
    jiraIssueKey: link.jiraIssueKey ?? null,
    jiraIssueUrl: link.jiraIssueUrl ?? null,
    jiraStatus: link.jiraStatus ?? null,
    jiraAssignee: link.jiraAssignee ?? null,
    linkState: link.linkState,
    mode: link.mode,
    lastSyncedAt: link.lastSyncedAt ? link.lastSyncedAt.toISOString() : null,
    errorCode: link.errorCode ?? null,
    errorMessage: link.errorMessage ?? null,
    createdBy: link.createdBy ?? null,
    createdAt: link.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// TicketDataRepository — minimal inner repository for ticket + comment reads
// ---------------------------------------------------------------------------

@Injectable()
class TicketDataRepository extends TenantRepository {
  async findTicketBasic(tenantId: string, ticketId: string) {
    const rows = await this.tx
      .select({
        id: tickets.id,
        tenantId: tickets.tenantId,
        ticketNumber: tickets.ticketNumber,
        subject: tickets.subject,
        priority: tickets.priority,
        organizationId: tickets.organizationId,
        categoryId: tickets.categoryId,
      })
      .from(tickets)
      .where(and(eq(tickets.id, ticketId), eq(tickets.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findOrgName(tenantId: string, orgId: string): Promise<string | null> {
    const rows = await this.tx
      .select({ name: organizationsRegistry.name })
      .from(organizationsRegistry)
      .where(and(
        eq(organizationsRegistry.tenantId, tenantId),
        eq(organizationsRegistry.id, orgId),
      ))
      .limit(1);
    return rows[0]?.name ?? null;
  }

  async findRecentComments(tenantId: string, ticketId: string, limit: number) {
    return this.tx
      .select({
        id: ticketComments.id,
        body: ticketComments.body,
        visibility: ticketComments.visibility,
        authorId: ticketComments.authorId,
        createdAt: ticketComments.createdAt,
      })
      .from(ticketComments)
      .where(and(
        eq(ticketComments.tenantId, tenantId),
        eq(ticketComments.ticketId, ticketId),
      ))
      .orderBy(desc(ticketComments.createdAt))
      .limit(limit);
  }
}

// ---------------------------------------------------------------------------
// JiraLinksService
// ---------------------------------------------------------------------------

@Injectable()
export class JiraLinksService {
  private readonly logger = new Logger(JiraLinksService.name);

  constructor(
    private readonly repo: JiraLinksRepository,
    private readonly mappingRepo: JiraMappingRepository,
    private readonly ticketData: TicketDataRepository,
    private readonly payloadBuilder: JiraPayloadBuilder,
    private readonly auditWriter: AuditWriter,
  ) {}

  // --------------------------------------------------------------------------
  // escalate — POST /tickets/:id/jira-links
  // --------------------------------------------------------------------------

  async escalate(
    ticketId: string,
    dto: EscalateLinkDto,
    principal: PrincipalContext,
  ): Promise<EscalateLinkResponse> {
    const tenantId = principal.tenantId;
    const actorId = principal.userId ?? null;

    // ── Resolve mapping ──────────────────────────────────────────────────────
    const mapping = await this.mappingRepo.findById(tenantId, dto.mappingId);
    if (!mapping || !mapping.enabled) {
      throw new NotFoundException({
        error: { code: 'JIRA_MAPPING_NOT_FOUND', message: 'Jira project mapping not found or disabled.' },
      });
    }

    // ── Validate link_existing scope ─────────────────────────────────────────
    if (dto.mode === 'link_existing' && dto.issueKey) {
      const keyProject = dto.issueKey.replace(/-\d+$/, '');
      if (keyProject !== mapping.projectKey) {
        throw new UnprocessableEntityException({
          error: {
            code: 'JIRA_LINK_OUT_OF_SCOPE',
            message: `Issue key ${dto.issueKey} belongs to project ${keyProject}, not ${mapping.projectKey}.`,
          },
        });
      }
    }

    // ── Duplicate check ──────────────────────────────────────────────────────
    const existing = await this.repo.findActive(tenantId, ticketId, mapping.projectKey);
    if (existing) {
      throw new ConflictException({
        error: {
          code: 'JIRA_LINK_ALREADY_EXISTS',
          message: 'A pending or linked Jira issue already exists for this ticket and project.',
          details: [{ existingLinkId: existing.id, linkState: existing.linkState }],
        },
      });
    }

    // ── Validate ticket exists ────────────────────────────────────────────────
    const ticket = await this.ticketData.findTicketBasic(tenantId, ticketId);
    if (!ticket) {
      throw new NotFoundException({
        error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' },
      });
    }

    // ── Build ADF description payload ────────────────────────────────────────
    const orgName = await this.ticketData.findOrgName(tenantId, ticket.organizationId);
    const recentComments = await this.ticketData.findRecentComments(tenantId, ticketId, 5);
    const syncRules = (mapping.syncRules ?? {}) as SyncRules;

    const ticketUrl = `${process.env['OPSNINJA_APP_BASE_URL'] ?? 'https://app.opsninja.io'}/tickets/${ticketId}`;
    const adfDescription = this.payloadBuilder.buildDescription(
      {
        ticketId,
        ticketNumber: ticket.ticketNumber,
        ticketUrl,
        subject: ticket.subject,
        organizationName: orgName ?? 'Unknown',
        priority: ticket.priority,
        categoryPath: null, // category path enrichment done by worker
        slaTargetAt: null,  // SLA target enrichment done by worker
        comments: recentComments.map((c) => ({
          id: c.id,
          body: c.body,
          visibility: c.visibility as 'public' | 'internal',
          authorName: null, // worker enriches author name
          createdAt: c.createdAt.toISOString(),
        })),
      },
      {
        includeInternalNotes: dto.includeInternalNotes,
        syncRules,
      },
    );

    // ── Insert link row (pending) ─────────────────────────────────────────────
    const linkId = randomUUID();
    const link = await this.repo.insert({
      id: linkId,
      tenantId,
      ticketId,
      connectionId: mapping.connectionId,
      mappingId: mapping.id,
      projectKey: mapping.projectKey,
      linkState: 'pending',
      mode: dto.mode,
      jiraIssueKey: dto.mode === 'link_existing' ? (dto.issueKey ?? null) : null,
      createdBy: actorId,
    });

    // ── Emit outbox event (same transaction) ─────────────────────────────────
    await this.repo.emitOutboxEvent(
      tenantId,
      linkId,
      'jira.link.requested',
      {
        tenantId,
        linkId,
        ticketId,
        mode: dto.mode,
        mappingId: mapping.id,
        connectionId: mapping.connectionId,
        projectKey: mapping.projectKey,
        issueTypeId: dto.issueTypeId ?? mapping.defaultIssueTypeId,
        issueKey: dto.mode === 'link_existing' ? (dto.issueKey ?? null) : null,
        adfDescription,
        includeInternalNotes: dto.includeInternalNotes,
      },
    );

    // ── Audit ─────────────────────────────────────────────────────────────────
    await this.auditWriter.append({
      resourceType: 'ticket_jira_link',
      resourceId: linkId,
      action: 'escalate',
      beforeState: null,
      afterState: {
        linkId,
        ticketId,
        connectionId: mapping.connectionId,
        projectKey: mapping.projectKey,
        mode: dto.mode,
        linkState: 'pending',
      },
      metadata: { tenantId, actorId, mappingId: mapping.id },
    });

    this.logger.log('Jira link created', {
      tenantId,
      ticketId,
      linkId,
      mappingId: mapping.id,
      projectKey: mapping.projectKey,
      mode: dto.mode,
    });

    return {
      link: {
        id: link.id,
        linkState: link.linkState,
        ticketId: link.ticketId,
        mappingId: link.mappingId,
        projectKey: link.projectKey,
      },
    };
  }

  // --------------------------------------------------------------------------
  // list — GET /tickets/:id/jira-links
  // --------------------------------------------------------------------------

  async list(ticketId: string, principal: PrincipalContext): Promise<JiraLinksListResponse> {
    const links = await this.repo.findByTicketId(principal.tenantId, ticketId);
    return { data: links.map(toResponse) };
  }

  // --------------------------------------------------------------------------
  // retry — POST /tickets/:id/jira-links/:linkId/retry
  // --------------------------------------------------------------------------

  async retry(
    ticketId: string,
    linkId: string,
    principal: PrincipalContext,
  ): Promise<void> {
    const { tenantId } = principal;
    const link = await this.repo.findById(tenantId, linkId);

    if (!link || link.ticketId !== ticketId) {
      throw new NotFoundException({ error: { code: 'JIRA_LINK_NOT_FOUND', message: 'Link not found.' } });
    }
    if (link.linkState !== 'failed') {
      throw new UnprocessableEntityException({
        error: { code: 'JIRA_LINK_NOT_FAILED', message: 'Retry is only allowed for failed links.' },
      });
    }

    // Re-emit the outbox event; do not mutate link_state directly.
    await this.repo.emitOutboxEvent(
      tenantId,
      linkId,
      'jira.link.retry',
      {
        tenantId,
        linkId,
        ticketId,
        mappingId: link.mappingId,
        connectionId: link.connectionId,
        projectKey: link.projectKey,
        mode: link.mode,
      },
    );

    await this.auditWriter.append({
      resourceType: 'ticket_jira_link',
      resourceId: linkId,
      action: 'retry',
      beforeState: { linkState: link.linkState },
      afterState: { linkState: 'pending_retry' },
      metadata: { tenantId, actorId: principal.userId ?? null, ticketId },
    });
  }

  // --------------------------------------------------------------------------
  // unlink — DELETE /tickets/:id/jira-links/:linkId
  // --------------------------------------------------------------------------

  async unlink(
    ticketId: string,
    linkId: string,
    principal: PrincipalContext,
  ): Promise<void> {
    const { tenantId } = principal;
    const link = await this.repo.findById(tenantId, linkId);

    if (!link || link.ticketId !== ticketId) {
      throw new NotFoundException({ error: { code: 'JIRA_LINK_NOT_FOUND', message: 'Link not found.' } });
    }
    if (link.linkState === 'unlinked') {
      return; // Idempotent — already unlinked.
    }

    await this.repo.updateLinkState(tenantId, linkId, { linkState: 'unlinked' });

    await this.auditWriter.append({
      resourceType: 'ticket_jira_link',
      resourceId: linkId,
      action: 'unlink',
      beforeState: { linkState: link.linkState, jiraIssueKey: link.jiraIssueKey },
      afterState: { linkState: 'unlinked' },
      metadata: { tenantId, actorId: principal.userId ?? null, ticketId },
    });

    this.logger.log('Jira link unlinked', { tenantId, ticketId, linkId });
  }
}

// Re-export the inner repository so JiraModule can provide it.
export { TicketDataRepository };
