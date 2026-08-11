/**
 * QueueController — agent ticket queue REST endpoint — WO-040.
 *
 * GET /api/v1/tickets
 *   Accepts: view_id, filter (inline AST), sort, cursor, limit
 *   Returns: { data: QueueRow[], next_cursor, total_estimate, trace_id }
 *
 * Requires: ticket:read permission.
 * 400 on invalid cursor, sort, or filter AST.
 * 403 on missing permission (handled by global AuthGuard).
 *
 * This controller is staff-facing only (portal tickets use PortalTicketsController).
 */

import {
  Controller,
  Get,
  Query,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { getPrincipalContext } from '../../../observability/request-context';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { QueueService } from './queue.service';
import { QueueQuerySchema, type QueueQueryDto } from './queue.dto';

@Controller('tickets')
export class QueueController {
  private readonly logger = new Logger(QueueController.name);

  constructor(private readonly queueService: QueueService) {}

  /**
   * GET /api/v1/tickets
   *
   * Lists tickets for the agent queue with keyset pagination, compiled view
   * filters, org-scope enforcement and Redis caching.
   */
  @Get()
  @RequirePermission('ticket:read')
  async list(@Query(new ZodValidationPipe(QueueQuerySchema)) query: QueueQueryDto) {
    const principal = getPrincipalContext();
    const traceId = principal.traceId ?? randomUUID();

    const { page, next_cursor, cache_hit } = await this.queueService.listTickets(principal, {
      viewId: query.view_id,
      filterRaw: query.filter,
      sortRaw: query.sort,
      cursorEncoded: query.cursor,
      limit: query.limit,
    });

    this.logger.debug('Queue response', {
      tenantId: principal.tenantId,
      rows: page.rows.length,
      cache_hit,
      traceId,
    });

    return {
      data: page.rows,
      next_cursor,
      total_estimate: page.totalEstimate,
      trace_id: traceId,
    };
  }
}
