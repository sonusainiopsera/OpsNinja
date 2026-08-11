/**
 * TicketsController — agent/staff ticket create and read-by-id endpoints.
 *
 * Endpoint map (all under /api/v1/tickets):
 *   POST /           Create ticket  → 201 TicketDto  (ticket:create)
 *   GET  /:id        Read by id     → 200 TicketDto  (ticket:read)
 *
 * Coexists with QueueController (also @Controller('tickets')):
 *   - QueueController handles GET /api/v1/tickets (list/queue).
 *   - TicketsController handles POST + GET /:id.
 * NestJS resolves both via HTTP method + path combination with no conflict.
 *
 * Security:
 *   - @RequirePermission ensures the AuthGuard RBAC check.
 *   - TicketsService enforces org-scope rules and portal restrictions.
 *   - All out-of-scope or unknown IDs return 404 — existence non-disclosure.
 *   - tenant_id is stamped server-side from principal; any attempt to supply
 *     it in the request body is rejected by the strict Zod schema with 400.
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../observability/request-context';
import { TicketsService } from './tickets.service';
import { CreateTicketSchema, type CreateTicketDto } from './dto/create-ticket.dto';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly service: TicketsService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/tickets
  // --------------------------------------------------------------------------

  /**
   * Create a new ticket.
   *
   * Strict Zod validation rejects unknown properties with 400.
   * tenant_id is stamped from the JWT principal; any body attempt is rejected.
   * Portal principals are forced to their own org (enforced in service).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('ticket:create')
  async create(
    @Body(new ZodValidationPipe(CreateTicketSchema)) dto: CreateTicketDto,
    @Req() req: Request,
  ) {
    const principal = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const ticket = await this.service.create(principal, dto);

    return { data: ticket, traceId };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/tickets/:id
  // --------------------------------------------------------------------------

  /**
   * Retrieve a single ticket by ID.
   *
   * Returns 404 for:
   *   - Unknown ticket IDs
   *   - Tickets belonging to another tenant
   *   - Tickets outside the principal's org scope
   *
   * Never returns 403 for out-of-scope tickets (existence non-disclosure).
   */
  @Get(':id')
  @RequirePermission('ticket:read')
  async findById(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const ticket = await this.service.findById(id);

    if (!ticket) {
      throw new NotFoundException({
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Ticket not found.',
          traceId,
        },
      });
    }

    return { data: ticket, traceId };
  }
}
