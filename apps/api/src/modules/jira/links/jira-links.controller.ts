/**
 * JiraLinksController — endpoints for ticket ↔ Jira issue link management (WO-053).
 *
 * Routes (all under /api/v1):
 *   POST   /tickets/:ticketId/jira-links              — escalate (202)
 *   GET    /tickets/:ticketId/jira-links              — list links
 *   POST   /tickets/:ticketId/jira-links/:linkId/retry — retry failed link (202)
 *   DELETE /tickets/:ticketId/jira-links/:linkId      — unlink (204)
 *
 * RBAC:
 *   ticket:escalate — escalate, retry, unlink
 *   ticket:read     — list
 */

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  HttpCode,
  UsePipes,
} from '@nestjs/common';
import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { JiraLinksService } from './jira-links.service';
import { getPrincipalContext } from '../../../observability/request-context';
import {
  EscalateLinkSchema,
  type EscalateLinkDto,
  type EscalateLinkResponse,
  type JiraLinksListResponse,
} from './jira-links.dto';

@Controller('tickets/:ticketId/jira-links')
export class JiraLinksController {
  constructor(private readonly service: JiraLinksService) {}

  // --------------------------------------------------------------------------
  // POST /tickets/:ticketId/jira-links — escalate
  // --------------------------------------------------------------------------

  @Post()
  @HttpCode(202)
  @RequirePermission('ticket:escalate')
  @UsePipes(new ZodValidationPipe(EscalateLinkSchema))
  async escalate(
    @Param('ticketId') ticketId: string,
    @Body() dto: EscalateLinkDto,
  ): Promise<EscalateLinkResponse> {
    const principal = getPrincipalContext();
    return this.service.escalate(ticketId, dto, principal);
  }

  // --------------------------------------------------------------------------
  // GET /tickets/:ticketId/jira-links — list
  // --------------------------------------------------------------------------

  @Get()
  @RequirePermission('ticket:read')
  async list(@Param('ticketId') ticketId: string): Promise<JiraLinksListResponse> {
    const principal = getPrincipalContext();
    return this.service.list(ticketId, principal);
  }

  // --------------------------------------------------------------------------
  // POST /tickets/:ticketId/jira-links/:linkId/retry — retry
  // --------------------------------------------------------------------------

  @Post(':linkId/retry')
  @HttpCode(202)
  @RequirePermission('ticket:escalate')
  async retry(
    @Param('ticketId') ticketId: string,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    const principal = getPrincipalContext();
    return this.service.retry(ticketId, linkId, principal);
  }

  // --------------------------------------------------------------------------
  // DELETE /tickets/:ticketId/jira-links/:linkId — unlink
  // --------------------------------------------------------------------------

  @Delete(':linkId')
  @HttpCode(204)
  @RequirePermission('ticket:escalate')
  async unlink(
    @Param('ticketId') ticketId: string,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    const principal = getPrincipalContext();
    return this.service.unlink(ticketId, linkId, principal);
  }
}
