/**
 * PortalAttachmentsController — WO-089.
 *
 * Routes:
 *   POST /api/v1/portal/attachments/presign         — issue pre-signed POST policy
 *   POST /api/v1/portal/attachments/:id/confirm     — verify magic bytes, finalize
 *   GET  /api/v1/portal/attachments/:id/download    — pre-signed GET URL (existing)
 *
 * Upload security guarantees:
 *   - Storage keys are server-generated UUIDs; filenames are display-only metadata.
 *   - Pre-signed POST policy carries content-length-range 0..26214400 (25 MB).
 *   - Magic-byte detection on confirm; mismatches delete the object and return 422.
 *   - Ownership check on confirm: tenant_id + org_id + uploaded_by_user_id.
 *   - All errors use 404 for existence non-disclosure on out-of-scope IDs.
 */

import {
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
import { z } from 'zod';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { PortalRoute } from '../../../common/auth/portal-route.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { PortalVisibilityGuard } from './portal-visibility.guard';
import { PortalAttachmentsService } from './portal-attachments.service';
import { AttachmentAccessService } from '../services/attachment-access.service';
import { getPrincipalContext } from '../../../observability/request-context';
import { assertPortalPrincipal } from '../../identity/portal/portal-principal';
import type { AttachmentDownloadDto } from './portal-ticket.dto';

// ---------------------------------------------------------------------------
// Presign request DTO
// ---------------------------------------------------------------------------

const PresignBodySchema = z.object({
  fileName:            z.string().min(1).max(255),
  declaredContentType: z.string().min(1).max(127),
  sizeBytes:           z.number().int().min(1).max(25 * 1024 * 1024),
}).strict();

type PresignBodyDto = z.infer<typeof PresignBodySchema>;

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('portal/attachments')
@PortalRoute()
@UseGuards(PortalVisibilityGuard)
@RequirePermission('ticket:read')
export class PortalAttachmentsController {
  constructor(
    private readonly attachmentAccessService: AttachmentAccessService,
    private readonly portalAttachmentsService: PortalAttachmentsService,
  ) {}

  // --------------------------------------------------------------------------
  // POST /portal/attachments/presign
  // --------------------------------------------------------------------------

  @Post('presign')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('ticket:create')
  async presign(
    @Body(new ZodValidationPipe(PresignBodySchema)) dto: PresignBodyDto,
    @Req() req: Request,
  ) {
    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);

    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.portalAttachmentsService.presign(
      principal.tenantId,
      principal.userId ?? '',
      principal.boundOrganizationId,
      dto,
    );
    return { data, traceId };
  }

  // --------------------------------------------------------------------------
  // POST /portal/attachments/:id/confirm
  // --------------------------------------------------------------------------

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('ticket:create')
  async confirm(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);

    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const data = await this.portalAttachmentsService.confirm(
      principal.tenantId,
      principal.userId ?? '',
      principal.boundOrganizationId,
      id,
    );
    return { data, traceId };
  }

  // --------------------------------------------------------------------------
  // GET /portal/attachments/:id/download
  // --------------------------------------------------------------------------

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);

    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? randomUUID();
    const result = await this.attachmentAccessService.mintPortalDownloadUrl(id, principal);
    if (!result) {
      // 404, not 403 — prevents existence disclosure of internal attachments.
      throw new NotFoundException();
    }

    return { data: result as AttachmentDownloadDto, traceId };
  }
}
