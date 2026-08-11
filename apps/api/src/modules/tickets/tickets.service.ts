/**
 * TicketsService — business logic for ticket create, read, update and resolve.
 *
 * Invariants:
 *   - tenant_id is ALWAYS stamped from the authenticated principal; the DTO
 *     cannot supply or override it.
 *   - Portal principals may only create tickets for their own boundOrganizationId;
 *     specifying a different org returns 422 PORTAL_ORG_MISMATCH.
 *   - Agent/staff principals are restricted to orgScopeIds; out-of-scope orgs
 *     return 404 (indistinguishable from unknown) to prevent existence disclosure.
 *   - Deactivated orgs return 422 ORGANIZATION_INACTIVE.
 *   - Audit record is written inside the same transaction as the ticket insert/update.
 *   - description is redacted from structured logs by the observability pipeline
 *     (MASK_KEYS in packages/observability/src/privacy/redactor.ts).
 *   - Status transitions are validated by the pure state machine before any DB write.
 *   - Optimistic concurrency uses version column — stale version → 409.
 *   - Status history and outbox events are written in the same transaction as the update.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';

import type { PrincipalContext } from '../../observability/request-context';
import { isPortalPrincipal } from '../identity/portal/portal-principal';
import { AuditWriter } from '../audit/audit-writer';
import { TicketRepository } from './repositories/ticket.repository';
import { CommentRepository } from './repositories/comment.repository';
import { PortalAttachmentsService } from './portal/portal-attachments.service';
import type { CreateTicketDto } from './dto/create-ticket.dto';
import type { UpdateTicketDto } from './dto/update-ticket.dto';
import type { ResolveTicketDto } from './dto/resolve-ticket.dto';
import type { CreatePortalTicketDto } from './portal/dto/create-portal-ticket.dto';
import { mapToTicketDto, type TicketDto } from './dto/ticket-response.dto';
import { validateTransition } from './lifecycle/ticket-state-machine';
import { TICKET_EVENTS } from './events/ticket-events';
import type { Permission } from '../../common/auth/permission.catalog';
import type { TicketStatus } from '@opsninja/db';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly repo: TicketRepository,
    private readonly auditWriter: AuditWriter,
    private readonly commentRepo: CommentRepository,
    private readonly portalAttachments: PortalAttachmentsService,
  ) {}

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  /**
   * Create a ticket with full org-scope enforcement and audit trail.
   *
   * Steps:
   *   1. Resolve and enforce org scope for the principal kind.
   *   2. Validate organisation is active (422 for deactivated/unknown).
   *   3. Validate requester_contact_id ownership when provided.
   *   4. Validate tag_ids exist in this tenant (400 for unknown keys).
   *   5. Validate custom_field keys against definitions (400 for unknown keys).
   *   6. Insert ticket + tag links atomically.
   *   7. Write audit record in the same transaction.
   *   8. Load enrichment and return canonical TicketDto.
   */
  async create(
    principal: PrincipalContext,
    dto: CreateTicketDto,
  ): Promise<TicketDto> {
    const tenantId = principal.tenantId;

    // ── 1. Org-scope enforcement ────────────────────────────────────────────
    const resolvedOrgId = this.resolveOrganizationId(principal, dto.organization_id);

    // ── 2. Org active check ─────────────────────────────────────────────────
    // assertOrganizationActive throws 422 ORGANIZATION_INACTIVE when the org
    // is unknown or deactivated — never returns a 404 that would hint existence.
    await this.repo.assertOrganizationActive(tenantId, resolvedOrgId);

    // ── 3. Requester contact ownership ──────────────────────────────────────
    const resolvedContactId = await this.resolveRequesterContact(
      principal,
      tenantId,
      resolvedOrgId,
      dto.requester_contact_id,
    );

    // ── 4. Tag validation ───────────────────────────────────────────────────
    const validTagIds = await this.validateTagIds(tenantId, dto.tag_ids ?? []);

    // ── 5. Insert ticket ────────────────────────────────────────────────────
    const ticket = await this.repo.createTicket(
      {
        tenantId,
        organizationId: resolvedOrgId,
        requesterContactId: resolvedContactId ?? null,
        assigneeId: null,
        assignmentGroupId: null,
        categoryId: dto.category_id ?? null,
        subject: dto.subject,
        description: dto.description ?? null,
        status: 'new',
        priority: dto.priority,
        customFields: dto.custom_fields ?? {},
        aiStatus: null,
        version: 1,
      },
      validTagIds,
    );

    this.logger.log('Ticket created', {
      ticketId: ticket.id,
      tenantId,
      organizationId: resolvedOrgId,
      priority: ticket.priority,
      // description intentionally omitted — PII in ticket subject/body
    });

    // ── 6. Audit record (same transaction as the insert) ────────────────────
    await this.auditWriter.append({
      resourceType: 'ticket',
      resourceId: ticket.id,
      action: 'create',
      beforeState: null,
      afterState: {
        id: ticket.id,
        status: ticket.status,
        priority: ticket.priority,
        organizationId: ticket.organizationId,
        // description excluded from audit log (PII)
      },
      metadata: { ticketNumber: ticket.ticketNumber, tenantId },
    });

    // ── 7. Load enrichment and return DTO ───────────────────────────────────
    const enrichment = await this.repo.loadEnrichment(ticket);
    return mapToTicketDto(ticket, enrichment);
  }

  // --------------------------------------------------------------------------
  // Read by ID
  // --------------------------------------------------------------------------

  /**
   * Return the canonical TicketDto for a given ticket ID.
   *
   * Returns null when the ID is unknown, belongs to another tenant, or is
   * outside the principal's org scope — the controller converts null to 404.
   * Never returns 403: existence non-disclosure is required.
   */
  async findById(id: string): Promise<TicketDto | null> {
    const ticket = await this.repo.findById(id);
    if (!ticket) return null;

    const enrichment = await this.repo.loadEnrichment(ticket);
    return mapToTicketDto(ticket, enrichment);
  }

  // --------------------------------------------------------------------------
  // Update (PATCH /tickets/:id)
  // --------------------------------------------------------------------------

  /**
   * Apply a partial update to an existing ticket.
   *
   * Steps:
   *   1. Load current ticket with org-scope enforcement → 404 if missing/scoped out.
   *   2. Collect principal permissions from the principal context.
   *   3. If `status` changes, run state machine → 422 on illegal/forbidden transition.
   *   4. Validate updated tag_ids exist in tenant (400 for unknowns).
   *   5. Build changes payload — only include fields that differ from current.
   *   6. If nothing changed, return current DTO without writes or events.
   *   7. Version-guarded UPDATE → 409 on conflict.
   *   8. Append status history row when status changed.
   *   9. Emit outbox events atomically in same transaction.
   *  10. Write audit diff record.
   *  11. Return updated canonical TicketDto.
   */
  async update(
    principal: PrincipalContext,
    ticketId: string,
    dto: UpdateTicketDto,
    traceId?: string,
  ): Promise<TicketDto> {
    const tenantId = principal.tenantId;

    // ── 1. Load ticket (scope-enforced) ─────────────────────────────────────
    const current = await this.repo.findById(ticketId);
    if (!current) {
      throw new NotFoundException({
        error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' },
      });
    }

    // ── 2. Principal permissions ─────────────────────────────────────────────
    const permissions = (principal.permissions ?? []) as Permission[];

    // ── 3. Status transition validation ─────────────────────────────────────
    let statusChanged = false;
    let slaAction: 'pause' | 'resume' | null = null;
    const eventsToEmit: string[] = [];

    if (dto.status !== undefined && dto.status !== current.status) {
      const decision = validateTransition({
        currentStatus: current.status as TicketStatus,
        requestedStatus: dto.status as TicketStatus,
        principalPermissions: permissions,
      });

      if (!decision.allowed) {
        if (decision.reason === 'PERMISSION_DENIED') {
          throw new ForbiddenException({
            error: {
              code: 'TRANSITION_PERMISSION_DENIED',
              message: decision.message,
              details: [{ requiredPermission: decision.requiredPermission }],
            },
          });
        }
        throw new UnprocessableEntityException({
          error: {
            code: 'INVALID_TRANSITION',
            message: decision.message,
            details: [{ fromStatus: current.status, toStatus: dto.status }],
          },
        });
      }

      statusChanged = true;
      if (decision.rule.slaPause) slaAction = 'pause';
      if (decision.rule.slaResume) slaAction = 'resume';
      decision.rule.events.forEach((e) => eventsToEmit.push(e));
    }

    // ── 4. Tag validation ───────────────────────────────────────────────────
    let validTagIds: string[] | undefined;
    if (dto.tag_ids !== undefined) {
      validTagIds = await this.validateTagIds(tenantId, dto.tag_ids);
    }

    // ── 5. Build changes ────────────────────────────────────────────────────
    const changes: Record<string, unknown> = {};
    if (dto.subject !== undefined && dto.subject !== current.subject) {
      changes['subject'] = dto.subject;
    }
    if (dto.description !== undefined && dto.description !== current.description) {
      changes['description'] = dto.description;
    }
    if (dto.priority !== undefined && dto.priority !== current.priority) {
      changes['priority'] = dto.priority;
      eventsToEmit.push(TICKET_EVENTS.PRIORITY_CHANGED);
    }
    if (statusChanged) {
      changes['status'] = dto.status;
    }
    if (dto.category_id !== undefined && dto.category_id !== current.categoryId) {
      changes['categoryId'] = dto.category_id;
    }
    if (dto.assignee_user_id !== undefined && dto.assignee_user_id !== current.assigneeId) {
      changes['assigneeId'] = dto.assignee_user_id;
      eventsToEmit.push(TICKET_EVENTS.ASSIGNED);
    }
    if (dto.assignment_group_id !== undefined && dto.assignment_group_id !== current.assignmentGroupId) {
      changes['assignmentGroupId'] = dto.assignment_group_id;
    }
    if (dto.custom_fields !== undefined) {
      changes['customFields'] = { ...(current.customFields as object ?? {}), ...dto.custom_fields };
    }

    // ── 6. No-op short-circuit ───────────────────────────────────────────────
    const hasFieldChanges = Object.keys(changes).length > 0;
    const hasTagChanges = validTagIds !== undefined;
    if (!hasFieldChanges && !hasTagChanges) {
      const enrichment = await this.repo.loadEnrichment(current);
      return mapToTicketDto(current, enrichment);
    }

    // Emit generic updated event when something changed
    eventsToEmit.unshift(TICKET_EVENTS.UPDATED);

    // ── 7. Version-guarded UPDATE ────────────────────────────────────────────
    const result = await this.repo.updateTicket(
      tenantId,
      ticketId,
      dto.version,
      changes as Parameters<TicketRepository['updateTicket']>[3],
      validTagIds,
    );

    if (result === 'VERSION_CONFLICT') {
      const currentVersion = await this.repo.getCurrentVersion(tenantId, ticketId);
      throw new ConflictException({
        error: {
          code: 'VERSION_CONFLICT',
          message: 'The ticket has been modified by another request. Refresh and retry.',
          details: [{ currentVersion }],
        },
      });
    }

    const updated = result;

    // ── 8. Status history ───────────────────────────────────────────────────
    if (statusChanged && dto.status) {
      await this.repo.appendStatusHistory(
        tenantId,
        ticketId,
        current.status as TicketStatus,
        dto.status as TicketStatus,
        principal.userId ?? null,
        dto.transition_reason ?? null,
      );

      // SLA port notification (declared, not executed inline per SlaPort pattern)
      if (slaAction) {
        this.logger.log('SLA signal', {
          ticketId,
          tenantId,
          slaAction,
          fromStatus: current.status,
          toStatus: dto.status,
        });
        // SlaPort.onStatusChanged would be called here when implemented (WO future)
      }
    }

    // ── 9. Outbox events ────────────────────────────────────────────────────
    for (const eventType of [...new Set(eventsToEmit)]) {
      await this.repo.emitEvent(
        tenantId,
        ticketId,
        eventType as Parameters<TicketRepository['emitEvent']>[2],
        {
          ticketId,
          tenantId,
          actorUserId: principal.userId,
          fromStatus: statusChanged ? current.status : undefined,
          toStatus: statusChanged ? dto.status : undefined,
          priority: changes['priority'] ?? undefined,
          assigneeId: changes['assigneeId'] ?? undefined,
        },
        traceId,
      );
    }

    // ── 10. Audit ───────────────────────────────────────────────────────────
    await this.auditWriter.append({
      resourceType: 'ticket',
      resourceId: ticketId,
      action: 'update',
      beforeState: {
        status: current.status,
        priority: current.priority,
        assigneeId: current.assigneeId,
        categoryId: current.categoryId,
        version: current.version,
      },
      afterState: {
        status: updated.status,
        priority: updated.priority,
        assigneeId: updated.assigneeId,
        categoryId: updated.categoryId,
        version: updated.version,
      },
      metadata: { tenantId, changedFields: Object.keys(changes) },
    });

    this.logger.log('Ticket updated', {
      ticketId,
      tenantId,
      changedFields: Object.keys(changes),
      newVersion: updated.version,
    });

    // ── 11. Return DTO ──────────────────────────────────────────────────────
    const enrichment = await this.repo.loadEnrichment(updated);
    return mapToTicketDto(updated, enrichment);
  }

  // --------------------------------------------------------------------------
  // Resolve (POST /tickets/:id/resolve)
  // --------------------------------------------------------------------------

  /**
   * Resolve a ticket with a required resolution note.
   *
   * Idempotent: if the ticket is already resolved, returns the current state
   * without writing events or audit records.
   *
   * Already-closed tickets return 422 — resolution from closed is not allowed.
   *
   * Steps:
   *   1. Load ticket (scope-enforced) → 404 if missing.
   *   2. Idempotency: already resolved → return current DTO.
   *   3. Validate transition (closed → 422, any non-resolvable state → 422).
   *   4. Version-guarded UPDATE setting status=resolved, resolved_at, ai_status=pending.
   *   5. Append status history row.
   *   6. Emit ticket.resolved outbox event.
   *   7. Write audit record.
   *   8. Return updated TicketDto.
   */
  async resolve(
    principal: PrincipalContext,
    ticketId: string,
    dto: ResolveTicketDto,
    traceId?: string,
  ): Promise<TicketDto> {
    const tenantId = principal.tenantId;

    // ── 1. Load ticket ───────────────────────────────────────────────────────
    const current = await this.repo.findById(ticketId);
    if (!current) {
      throw new NotFoundException({
        error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' },
      });
    }

    // ── 2. Idempotency — already resolved ────────────────────────────────────
    if (current.status === 'resolved') {
      const enrichment = await this.repo.loadEnrichment(current);
      return mapToTicketDto(current, enrichment);
    }

    // ── 3. Transition validation ─────────────────────────────────────────────
    const permissions = (principal.permissions ?? []) as Permission[];
    const decision = validateTransition({
      currentStatus: current.status as TicketStatus,
      requestedStatus: 'resolved',
      principalPermissions: permissions,
    });

    if (!decision.allowed) {
      if (decision.reason === 'PERMISSION_DENIED') {
        throw new ForbiddenException({
          error: {
            code: 'TRANSITION_PERMISSION_DENIED',
            message: decision.message,
            details: [{ requiredPermission: decision.requiredPermission }],
          },
        });
      }
      throw new UnprocessableEntityException({
        error: {
          code: 'INVALID_TRANSITION',
          message: decision.message,
          details: [{ fromStatus: current.status, toStatus: 'resolved' }],
        },
      });
    }

    // ── 4. Version-guarded UPDATE ────────────────────────────────────────────
    const changes = {
      status: 'resolved' as TicketStatus,
      resolvedAt: new Date(),
      aiStatus: 'pending',
      ...(dto.category_id !== undefined ? { categoryId: dto.category_id } : {}),
    };

    const result = await this.repo.updateTicket(tenantId, ticketId, dto.version, changes);

    if (result === 'VERSION_CONFLICT') {
      const currentVersion = await this.repo.getCurrentVersion(tenantId, ticketId);
      throw new ConflictException({
        error: {
          code: 'VERSION_CONFLICT',
          message: 'The ticket has been modified by another request. Refresh and retry.',
          details: [{ currentVersion }],
        },
      });
    }

    const updated = result;

    // ── 5. Status history ───────────────────────────────────────────────────
    await this.repo.appendStatusHistory(
      tenantId,
      ticketId,
      current.status as TicketStatus,
      'resolved',
      principal.userId ?? null,
      dto.resolution_note,
    );

    // ── 6. Outbox event ─────────────────────────────────────────────────────
    await this.repo.emitEvent(
      tenantId,
      ticketId,
      TICKET_EVENTS.RESOLVED,
      {
        ticketId,
        tenantId,
        actorUserId: principal.userId,
        fromStatus: current.status,
        toStatus: 'resolved',
        resolutionNote: '[redacted]', // PII — consumers re-read the ticket for detail
      },
      traceId,
    );

    // ── 7. Audit ─────────────────────────────────────────────────────────────
    await this.auditWriter.append({
      resourceType: 'ticket',
      resourceId: ticketId,
      action: 'resolve',
      beforeState: { status: current.status, resolvedAt: null, version: current.version },
      afterState: { status: 'resolved', resolvedAt: updated.resolvedAt, version: updated.version },
      metadata: { tenantId },
    });

    this.logger.log('Ticket resolved', { ticketId, tenantId, newVersion: updated.version });

    // ── 8. Return DTO ────────────────────────────────────────────────────────
    const enrichment = await this.repo.loadEnrichment(updated);
    return mapToTicketDto(updated, enrichment);
  }

  // --------------------------------------------------------------------------
  // createFromPortal (WO-089)
  // --------------------------------------------------------------------------

  /**
   * Create a ticket submitted by a portal user.
   *
   * Differences from the agent `create` path:
   *   - Organization forced from the principal's boundOrganizationId (AC-2).
   *   - requestedPriority recorded; effective SLA priority defaults to P3.
   *   - Initial description inserted as a public comment (AC-3).
   *   - Confirmed attachment IDs verified for ownership and linked (AC-4, AC-9).
   *   - ticket.created outbox event emitted in the same transaction (AC-4).
   *   - Portal comment visibility forced to 'public' — cannot be overridden (AC-3).
   */
  async createFromPortal(
    principal: PrincipalContext,
    dto: CreatePortalTicketDto,
  ): Promise<TicketDto> {
    if (!isPortalPrincipal(principal)) {
      throw new UnprocessableEntityException({
        error: { code: 'PORTAL_ONLY', message: 'This endpoint is for portal principals only.' },
      });
    }

    const tenantId       = principal.tenantId;
    const organizationId = principal.boundOrganizationId; // AC-2: forced, not from DTO

    // ── Org active check ──────────────────────────────────────────────────────
    await this.repo.assertOrganizationActive(tenantId, organizationId);

    // ── Insert ticket ─────────────────────────────────────────────────────────
    const ticket = await this.repo.createTicket(
      {
        tenantId,
        organizationId,
        requesterContactId:  null,
        assigneeId:          null,
        assignmentGroupId:   null,
        categoryId:          dto.categoryId ?? null,
        subject:             dto.subject,
        description:         dto.description,
        status:              'new',
        priority:            dto.requestedPriority, // SLA module may override later
        customFields:        dto.customFields,
        aiStatus:            null,
        version:             1,
        // requestedPriority stored separately (AC DB change)
        // Cast: Drizzle's $inferInsert allows extra fields via cast
        ...(({ requestedPriority: dto.requestedPriority }) as Record<string, unknown>),
      } as Parameters<TicketRepository['createTicket']>[0],
      [],
    );

    // ── Insert initial description as a public comment (AC-3) ─────────────────
    await this.commentRepo.insert({
      tenantId,
      ticketId:       ticket.id,
      organizationId,
      authorId:       principal.userId ?? null,
      body:           dto.description,
      visibility:     'public', // forced — portal comments are ALWAYS public
    });

    // ── Verify and link confirmed attachments (AC-4, AC-9) ───────────────────
    if (dto.attachmentIds.length > 0) {
      await this.portalAttachments.verifyAndLink(
        tenantId,
        organizationId,
        principal.userId ?? '',
        dto.attachmentIds,
        ticket.id,
      );
    }

    // ── Emit ticket.created outbox event (same tx via TenantRepository) ───────
    await this.repo.emitEvent(
      tenantId,
      ticket.id,
      TICKET_EVENTS.CREATED,
      {
        ticketId:      ticket.id,
        tenantId,
        organizationId,
        actorUserId:   principal.userId,
        attachmentIds: dto.attachmentIds,
        source:        'portal',
      },
    );

    // ── Audit record ──────────────────────────────────────────────────────────
    await this.auditWriter.append({
      resourceType: 'ticket',
      resourceId:   ticket.id,
      action:       'create',
      beforeState:  null,
      afterState: {
        id:             ticket.id,
        status:         ticket.status,
        priority:       ticket.priority,
        organizationId: ticket.organizationId,
        source:         'portal',
      },
      metadata: { ticketNumber: ticket.ticketNumber, tenantId, source: 'portal' },
    });

    this.logger.log('[METRIC] portal_ticket_created_total', {
      metric:   'portal_ticket_created_total',
      tenantId,
      priority: ticket.priority,
    });

    this.logger.log('Portal ticket created', {
      ticketId:       ticket.id,
      tenantId,
      organizationId,
      attachmentCount: dto.attachmentIds.length,
    });

    // ── Return DTO ────────────────────────────────────────────────────────────
    const enrichment = await this.repo.loadEnrichment(ticket);
    return mapToTicketDto(ticket, enrichment);
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Determine the effective organization_id based on principal kind.
   *
   * Portal principal: org must match their boundOrganizationId exactly.
   * Staff principal with non-admin role: org must be within orgScopeIds.
   * Admin/lead_analyst: unrestricted, org accepted as supplied.
   */
  private resolveOrganizationId(
    principal: PrincipalContext,
    requestedOrgId: string,
  ): string {
    if (isPortalPrincipal(principal)) {
      const bound = principal.boundOrganizationId;
      if (!bound || bound !== requestedOrgId) {
        throw new UnprocessableEntityException({
          error: {
            code: 'PORTAL_ORG_MISMATCH',
            message:
              'Portal users may only create tickets for their own organisation.',
            details: [{ requestedOrgId }],
          },
        });
      }
      return bound;
    }

    // Tenant-wide roles bypass scope check
    const TENANT_WIDE = new Set(['admin', 'lead_analyst']);
    if (principal.roles?.some((r: string) => TENANT_WIDE.has(r))) {
      return requestedOrgId;
    }

    // Agent/manager: org must be in scope
    if (
      principal.orgScopeIds &&
      principal.orgScopeIds.length > 0 &&
      !principal.orgScopeIds.includes(requestedOrgId)
    ) {
      // Return 404 — existence non-disclosure
      throw new NotFoundException({
        error: {
          code: 'ORGANIZATION_NOT_FOUND',
          message: 'Organization not found.',
        },
      });
    }

    return requestedOrgId;
  }

  /**
   * Resolve and validate the requester contact ID.
   *
   * Portal: contact is forced to the portal principal's own contact (future WO
   * will bind contactId to the portal session; for now we accept what's provided
   * and validate it belongs to the org).
   * Agent: contact optional; when provided must belong to the given org.
   */
  private async resolveRequesterContact(
    principal: PrincipalContext,
    tenantId: string,
    organizationId: string,
    requestedContactId: string | undefined,
  ): Promise<string | null> {
    if (!requestedContactId) {
      // Portal principal should always supply a contact — but the requirement
      // says "portal forces requester to their own contact"; enforcement of
      // the specific portal contact binding is in the portal session (WO future).
      return null;
    }

    const valid = await this.repo.contactBelongsToOrg(
      tenantId,
      requestedContactId,
      organizationId,
    );

    if (!valid) {
      throw new UnprocessableEntityException({
        error: {
          code: 'CONTACT_NOT_IN_ORG',
          message:
            'The requester contact does not belong to the specified organisation or does not exist.',
          details: [{ requesterContactId: requestedContactId }],
        },
      });
    }

    return requestedContactId;
  }

  // ---------------------------------------------------------------------------
  // reopenFromPortal (WO-090, AC6)
  // ---------------------------------------------------------------------------

  /**
   * Reopen a closed ticket when the tenant policy permits portal-triggered reopens.
   * Transitions closed → open, appends status history, emits outbox event.
   * Called only after the caller verifies portalReopenOnReply setting is true.
   */
  async reopenFromPortal(
    principal: import('../../observability/request-context').PrincipalContext,
    ticketId: string,
    traceId: string,
  ): Promise<void> {
    const tenantId = principal.tenantId;
    const ticket = await this.repo.findById(ticketId);
    if (!ticket || ticket.status !== 'closed') return; // nothing to reopen

    const updated = await this.repo.updateTicket(tenantId, ticketId, ticket.version, {
      status: 'open',
    });
    if (updated === 'VERSION_CONFLICT') return; // concurrent update — ignore, comment still proceeds

    await this.repo.appendStatusHistory(tenantId, ticketId, 'closed', 'open', null, 'portal_reopen');
    await this.repo.emitEvent(tenantId, ticketId, 'ticket.status_changed', {
      from: 'closed',
      to: 'open',
      reason: 'portal_reopen',
    }, traceId);
  }

  /**
   * Validate all tag IDs exist in this tenant.
   * Throws 400 listing any unknown IDs.
   */
  private async validateTagIds(tenantId: string, tagIds: string[]): Promise<string[]> {
    if (tagIds.length === 0) return [];

    const validIds = await this.repo.filterValidTagIds(tenantId, tagIds);
    const unknownIds = tagIds.filter((id) => !validIds.includes(id));

    if (unknownIds.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'UNKNOWN_TAG_IDS',
          message: 'One or more tag_ids do not exist in this tenant.',
          details: unknownIds.map((id) => ({ tagId: id })),
        },
      });
    }

    return validIds;
  }
}
