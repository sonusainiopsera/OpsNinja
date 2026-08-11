/**
 * CommentsController — agent/staff comment endpoints.
 *
 * Endpoint map (under /api/v1/tickets/:ticketId/comments):
 *   POST /                    Create comment  → 201 CommentDto  (ticket:create)
 *   GET  /                    List comments   → 200 CommentPageDto (ticket:read)
 *
 * Security:
 *   - @RequirePermission enforces AuthGuard RBAC.
 *   - Portal visibility enforcement is in the repository predicate (not here).
 *   - 403 is returned when a portal principal requests internal visibility.
 *   - 404 for unknown/out-of-scope tickets — existence non-disclosure.
 *   - Comment bodies are never logged (Confidential-tier).
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Req,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../../observability/request-context';
import { CommentsService } from './comments.service';
import { CreateCommentSchema, type CreateCommentDto } from './create-comment.dto';

@Controller('tickets/:ticketId/comments')
export class CommentsController {
  constructor(private readonly service: CommentsService) {}

  // --------------------------------------------------------------------------
  // POST /api/v1/tickets/:ticketId/comments
  // --------------------------------------------------------------------------

  /**
   * Create a new comment on a ticket.
   *
   * visibility defaults to 'public'. Portal principals cannot post internal
   * comments — a 403 is returned if they attempt it.
   *
   * Portal principals cannot comment on closed tickets (422).
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('ticket:create')
  async create(
    @Param('ticketId') ticketId: string,
    @Body(new ZodValidationPipe(CreateCommentSchema)) dto: CreateCommentDto,
    @Req() req: Request,
  ) {
    const principal = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const comment = await this.service.create(principal, ticketId, dto, traceId);

    return { data: comment, traceId };
  }

  // --------------------------------------------------------------------------
  // GET /api/v1/tickets/:ticketId/comments
  // --------------------------------------------------------------------------

  /**
   * Return a cursor-paginated list of comments for a ticket.
   *
   * Portal principals receive only public comments (enforced at repository level).
   * Limit is capped at 100 in the repository.
   *
   * Query params:
   *   cursor — opaque base64url from a previous page response.
   *   limit  — page size, 1–100, default 50.
   */
  @Get()
  @RequirePermission('ticket:read')
  async list(
    @Param('ticketId') ticketId: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Req() req: Request,
  ) {
    const principal = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const page = await this.service.listPage(principal, ticketId, cursor, limit);

    return { ...page, traceId };
  }
}
