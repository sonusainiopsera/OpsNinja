/**
 * PortalTicketsController — portal surface for ticket read/comment operations.
 *
 * Route prefix: /api/v1/portal/tickets (global prefix /api/v1 + @Controller('portal/tickets'))
 *
 * Visibility rules enforced at two independent layers:
 *   1. PortalVisibilityGuard: validates portal principal + boundOrganizationId.
 *   2. Repository predicates: org_id AND comment.visibility = 'public' (non-bypassable).
 *   3. Portal DTO mappers: structurally exclude all internal fields.
 *
 * Out-of-scope or internal resources return 404, not 403, to prevent existence disclosure.
 * POST /portal/tickets/:id/comments forces visibility = 'public' server-side;
 * any client-supplied visibility field is rejected with 400 PORTAL_FIELD_NOT_ALLOWED.
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
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { PortalRoute } from '../../../common/auth/portal-route.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PortalVisibilityGuard } from './portal-visibility.guard';
import { TicketRepository } from '../repositories/ticket.repository';
import { CommentRepository } from '../repositories/comment.repository';
import { AttachmentRepository } from '../repositories/attachment.repository';
import { TenantSettingsRepository } from '../repositories/tenant-settings.repository';
import { TicketsService } from '../tickets.service';
import { getPrincipalContext } from '../../../observability/request-context';
import { assertPortalPrincipal } from '../../identity/portal/portal-principal';
import {
  CreatePortalTicketSchema,
  type CreatePortalTicketDto,
} from './dto/create-portal-ticket.dto';
import {
  mapTicketToPortalListItem,
  mapTicketToPortalDetail,
  mapCommentToPortalDto,
  type PortalTicketListItemDto,
  type PortalTicketDetailDto,
  type PortalCommentDto,
} from './portal-ticket.dto';

interface AddCommentBody {
  body: string;
  /** visibility must not be supplied by portal callers — forced to 'public'. */
  visibility?: unknown;
}

@Controller('portal/tickets')
@PortalRoute()
@UseGuards(PortalVisibilityGuard)
@RequirePermission('ticket:read')
export class PortalTicketsController {
  constructor(
    private readonly ticketRepository: TicketRepository,
    private readonly commentRepository: CommentRepository,
    private readonly attachmentRepository: AttachmentRepository,
    private readonly tenantSettingsRepository: TenantSettingsRepository,
    private readonly ticketsService: TicketsService,
  ) {}

  @Get()
  async listTickets(): Promise<PortalTicketListItemDto[]> {
    const tickets = await this.ticketRepository.findAll();
    return tickets.map(mapTicketToPortalListItem);
  }

  @Get(':id')
  async getTicket(@Param('id') id: string): Promise<PortalTicketDetailDto> {
    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);

    const ticket = await this.ticketRepository.findById(id);
    if (!ticket) {
      throw new NotFoundException();
    }

    const [rawComments, settings] = await Promise.all([
      this.commentRepository.findByTicketId(id),
      this.tenantSettingsRepository.findByTenantId(principal.tenantId),
    ]);

    const comments: PortalCommentDto[] = await Promise.all(
      rawComments.map(async (c) => {
        const attachments = await this.attachmentRepository.findByCommentId(c.id);
        return mapCommentToPortalDto(c, attachments);
      }),
    );

    const aiSummaryEnabled = settings?.portalAiSummaryEnabled ?? false;
    return mapTicketToPortalDetail(ticket, comments, aiSummaryEnabled);
  }

  @Post(':id/comments')
  @RequirePermission('ticket:create')
  async addComment(
    @Param('id') ticketId: string,
    @Body() body: AddCommentBody,
  ): Promise<PortalCommentDto> {
    // Reject any client-supplied visibility field — portal comments are always public.
    if (body.visibility !== undefined) {
      throw new BadRequestException({
        code: 'PORTAL_FIELD_NOT_ALLOWED',
        message: 'Field "visibility" is not allowed from the portal; comments are always public',
        field: 'visibility',
      });
    }

    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);

    // Verify ticket exists and belongs to this org (repository applies predicate).
    const ticket = await this.ticketRepository.findById(ticketId);
    if (!ticket) {
      throw new NotFoundException();
    }

    const comment = await this.commentRepository.insert({
      tenantId: principal.tenantId,
      ticketId,
      organizationId: principal.boundOrganizationId,
      authorId: principal.userId,
      body: body.body,
      visibility: 'public', // forced — portal comments are always public
    });

    return mapCommentToPortalDto(comment, []);
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
