/**
 * TicketSlaController — GET /api/v1/tickets/:id/sla (WO-050).
 *
 * Returns per-clock SLA state computed by the shared clock functions.
 * Guards:
 *   - sla:read permission (Manager or Agent with sla:read)
 *   - Organisation-scope check delegated to TicketsService.getById():
 *     out-of-scope or missing ticket returns 404 to avoid existence disclosure.
 *
 * This controller lives in the sla/ module directory but is registered in
 * TicketsModule to avoid a circular dependency (TicketsModule → SlaModule).
 */

import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { getPrincipalContext } from '../../observability/request-context';
import { SlaQueryService } from './sla-query.service';
import { TicketsService } from '../tickets/tickets.service';

@Controller('tickets')
export class TicketSlaController {
  private readonly logger = new Logger(TicketSlaController.name);

  constructor(
    private readonly slaQueryService: SlaQueryService,
    private readonly ticketsService: TicketsService,
  ) {}

  /**
   * GET /api/v1/tickets/:id/sla
   *
   * Returns 200 with empty clocks array and reason='no_policy' when the ticket
   * has no matching SLA policy. Returns 404 for missing or out-of-scope tickets.
   */
  @Get(':id/sla')
  @RequirePermission('sla:read', 'sla:manage', 'ticket:read')
  async getTicketSla(@Param('id') id: string) {
    const principal = getPrincipalContext();
    const { tenantId } = principal;

    // Validate ticket existence and org scope by loading via TicketsService.
    // findById returns null for missing/out-of-scope tickets (existence non-disclosure).
    const ticket = await this.ticketsService.findById(id);
    if (!ticket) {
      throw new NotFoundException({
        error: { code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' },
      });
    }

    const result = await this.slaQueryService.getTicketSla(tenantId, id);

    return {
      data: result,
    };
  }
}
