/**
 * PortalTicketsController — portal surface for ticket read/comment/download operations.
 *
 * Route prefix: /api/v1/portal/tickets (global prefix /api/v1 + @Controller('portal/tickets'))
 *
 * WO-089: POST /portal/tickets — create support request
 * WO-090: GET  /portal/tickets — keyset-paginated list with filters (AC1, AC2)
 *         GET  /portal/tickets/:id — detail with public comments, SLA, status history (AC3)
 *         POST /portal/tickets/:id/comments — reply with forced public visibility (AC5, AC6)
 *         GET  /portal/attachments/:id/download — pre-signed download after ownership check (AC8)
 *
 * Visibility rules enforced at three independent layers:
 *   1. PortalVisibilityGuard: validates portal principal + boundOrganizationId.
 *   2. Repository/service predicates: org_id AND comment.visibility = 'public' (non-bypassable).
 *   3. Portal DTO mappers: structurally exclude all internal fields (AC7).
 *
 * Out-of-scope or internal resources return 404, never 403 (existence non-disclosure, AC4).
 */

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { PortalRoute } from '../../../common/auth/portal-route.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PortalVisibilityGuard } from './portal-visibility.guard';
import { TicketRepository } from '../repositories/ticket.repository';
import { CommentRepository } from '../repositories/comment.repository';
import { TenantSettingsRepository } from '../repositories/tenant-settings.repository';
import { TicketsService } from '../tickets.service';
import { PortalTicketReadService } from './portal-ticket-read.service';
import { getPrincipalContext } from '../../../observability/request-context';
import { assertPortalPrincipal } from '../../identity/portal/portal-principal';
import {
  CreatePortalTicketSchema,
  type CreatePortalTicketDto,
} from './dto/create-portal-ticket.dto';
import {
  mapCommentToPortalDto,
  type PortalTicketListPageDto,
  type PortalTicketDetailDto,
  type PortalCommentDto,
  type AttachmentDownloadDto,
} from './portal-ticket.dto';

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const AddCommentSchema = z.object({
  body: z.string().min(1).max(20_000),
  attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  // visibility MUST NOT be accepted from portal callers (AC5)
  visibility: z.undefined({
    errorMap: () => ({ message: 'Field "visibility" is not allowed from the portal.' }),
  }).optional(),
});

type AddCommentDto = z.infer<typeof AddCommentSchema>;

const ListQuerySchema = z.object({
  status:  z.string().optional(),
  q:       z.string().optional(),
  cursor:  z.string().optional(),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('portal/tickets')
@PortalRoute()
@UseGuards(PortalVisibilityGuard)
@RequirePermission('ticket:read')
export class PortalTicketsController {
  constructor(
    private readonly ticketRepository: TicketRepository,
    private readonly commentRepository: CommentRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly ticketsService: TicketsService,
    private readonly portalReadService: PortalTicketReadService,
  ) {}

  // ---------------------------------------------------------------------------
  // GET /portal/tickets — keyset-paginated list with filters (AC1, AC2, AC10)
  // ---------------------------------------------------------------------------

  @Get()
  async listTickets(
    @Query() rawQuery: Record<string, string>,
  ): Promise<PortalTicketListPageDto> {
    const parsed = ListQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        error: {
          code: 'INVALID_QUERY',
          message: 'Invalid query parameters',
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }
    const { status, q, cursor, limit } = parsed.data;
    return this.portalReadService.listTickets({ status, q }, cursor, limit);
  }

  // ---------------------------------------------------------------------------
  // GET /portal/tickets/:id — detail with public comments + SLA (AC3, AC4, AC7)
  // ---------------------------------------------------------------------------

  @Get(':id')
  async getTicket(@Param('id') id: string): Promise<PortalTicketDetailDto> {
    return this.portalReadService.getTicketDetail(id);
  }

  // ---------------------------------------------------------------------------
  // POST /portal/tickets/:id/comments — reply with forced public (AC5, AC6)
  // ---------------------------------------------------------------------------

  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('ticket:create')
  async addComment(
    @Param('id') ticketId: string,
    @Body(new ZodValidationPipe(AddCommentSchema)) dto: AddCommentDto,
    @Req() req: Request,
  ): Promise<PortalCommentDto> {
    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    // Verify ticket exists and belongs to this org (repository applies org predicate, AC4)
    const ticket = await this.ticketRepository.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Ticket not found.' } });
    }

    // AC6 — Reject replies on closed tickets unless tenant policy permits reopen
    if (ticket.status === 'closed') {
      const settings = await this.tenantSettingsRepository.findByTenantId(principal.tenantId);
      const reopenAllowed = (settings as unknown as { portalReopenOnReply?: boolean })
        ?.portalReopenOnReply ?? false;

      if (!reopenAllowed) {
        throw new UnprocessableEntityException({
          error: {
            code: 'TICKET_CLOSED',
            message: 'This ticket is closed. Please submit a new request.',
            details: [{ ticketId, status: ticket.status }],
          },
        });
      }

      // Reopen ticket — audited in ticket service
      await this.ticketsService.reopenFromPortal(principal, ticketId, traceId);
    }

    // AC5 — visibility forced to 'public' — no client override possible (Zod rejects visibility)
    const comment = await this.commentRepository.insert({
      tenantId:       principal.tenantId,
      ticketId,
      organizationId: principal.boundOrganizationId,
      authorId:       principal.userId,
      body:           dto.body,
      visibility:     'public',
    });

    // Emit ticket.comment_added outbox event in the transaction
    await this.commentRepository.emitCommentAddedEvent(
      principal.tenantId,
      ticketId,
      comment.id,
      'public',
      principal.userId,
      traceId,
    );

    // Invalidate cached list pages for this user (AC10)
    await this.portalReadService.invalidateUserCache(principal.userId);

    return mapCommentToPortalDto(comment, [], 'Customer', 'customer');
  }

  // ---------------------------------------------------------------------------
  // POST /portal/tickets — create a support request (WO-089)
  // ---------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('ticket:create')
  async createTicket(
    @Body(new ZodValidationPipe(CreatePortalTicketSchema)) dto: CreatePortalTicketDto,
    @Req() req: Request,
  ) {
    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);

    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.ticketsService.createFromPortal(principal, dto);
    return { data, traceId };
  }
}

// ---------------------------------------------------------------------------
// Attachment download — separate controller at /portal/attachments/:id/download
// to match the API contract (AC8)
// ---------------------------------------------------------------------------

import { Controller as NestController, Get as NestGet, Param as NestParam, UseGuards as NestUseGuards } from '@nestjs/common';

@NestController('portal/attachments')
@PortalRoute()
@NestUseGuards(PortalVisibilityGuard)
@RequirePermission('ticket:read')
export class PortalAttachmentDownloadController {
  constructor(private readonly portalReadService: PortalTicketReadService) {}

  @NestGet(':id/download')
  async downloadAttachment(
    @NestParam('id') attachmentId: string,
  ): Promise<AttachmentDownloadDto> {
    return this.portalReadService.getAttachmentDownloadUrl(attachmentId);
  }
}
