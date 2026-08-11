/**
 * AttachmentsController — agent/staff attachment presign, finalize and download.
 *
 * Endpoint map:
 *   POST /api/v1/tickets/:ticketId/attachments/presign    → 201 PresignResult   (ticket:create)
 *   POST /api/v1/tickets/:ticketId/attachments/finalize   → 200 AttachmentDto   (ticket:create)
 *   GET  /api/v1/attachments/:id/download                 → 200 DownloadDto     (ticket:read)
 *
 * Security:
 *   - S3 keys are NEVER derived from user input; only server-generated UUIDs.
 *   - Portal principals cannot access attachments on internal comments (404).
 *   - 404 for all unknown/out-of-scope IDs — existence non-disclosure.
 *   - Download URL TTL: 60 seconds.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { randomUUID } from 'crypto';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { getPrincipalContext } from '../../../observability/request-context';
import { AttachmentsService } from './attachments.service';
import { PresignAttachmentSchema, type PresignAttachmentDto } from './dto/presign-attachment.dto';
import { FinalizeAttachmentSchema, type FinalizeAttachmentDto } from './dto/finalize-attachment.dto';

// ---------------------------------------------------------------------------
// Ticket-scoped endpoints
// ---------------------------------------------------------------------------

@Controller('tickets/:ticketId/attachments')
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

  /**
   * Issue a pre-signed S3 POST policy for direct client-to-S3 upload.
   *
   * Returns a server-generated key, upload URL and form fields.
   * The client must POST to uploadUrl with the fields as multipart/form-data,
   * then call /finalize to activate the attachment.
   */
  @Post('presign')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('ticket:create')
  async presign(
    @Param('ticketId') ticketId: string,
    @Body(new ZodValidationPipe(PresignAttachmentSchema)) dto: PresignAttachmentDto,
    @Req() req: Request,
  ) {
    const principal = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const result = await this.service.presign(principal, ticketId, dto);
    return { data: result, traceId };
  }

  /**
   * Finalize an attachment after S3 upload is complete.
   *
   * Verifies the object exists, checks magic bytes, cross-validates the
   * extension, and activates the attachment row.
   *
   * Idempotent: calling twice on the same attachment returns the existing row.
   */
  @Post('finalize')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ticket:create')
  async finalize(
    @Param('ticketId') ticketId: string,
    @Body(new ZodValidationPipe(FinalizeAttachmentSchema)) dto: FinalizeAttachmentDto,
    @Req() req: Request,
  ) {
    const principal = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const result = await this.service.finalize(principal, ticketId, dto.attachment_id);
    return { data: result, traceId };
  }
}

// ---------------------------------------------------------------------------
// Tenant-scoped download endpoint (not ticket-scoped, as ID is globally unique per tenant)
// ---------------------------------------------------------------------------

@Controller('attachments')
export class AttachmentDownloadController {
  constructor(private readonly service: AttachmentsService) {}

  /**
   * Mint a 60-second pre-signed GET URL for a finalized attachment.
   *
   * Returns 404 for:
   *   - Unknown attachment IDs
   *   - Attachments in another tenant
   *   - Portal: attachments outside own org or on internal comments
   */
  @Get(':id/download')
  @RequirePermission('ticket:read')
  async download(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const principal = getPrincipalContext();
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    const result = await this.service.download(principal, id);
    return { data: result, traceId };
  }
}
