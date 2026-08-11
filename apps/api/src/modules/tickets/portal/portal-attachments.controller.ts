/**
 * PortalAttachmentsController — pre-signed download URL endpoint for portal users.
 *
 * Route: GET /api/v1/portal/attachments/:id/download
 *
 * Before minting a URL, AttachmentAccessService:
 *   1. Resolves the attachment (org scope enforced by repository predicate).
 *   2. Resolves the parent comment and checks visibility = 'public'.
 *   3. Returns null when either check fails → this controller returns 404.
 *
 * A pre-signed URL is NEVER issued for an attachment on an internal comment.
 */

import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';

import { RequirePermission } from '../../../common/auth/require-permission.decorator';
import { PortalRoute } from '../../../common/auth/portal-route.decorator';
import { PortalVisibilityGuard } from './portal-visibility.guard';
import { AttachmentAccessService } from '../services/attachment-access.service';
import { getPrincipalContext } from '../../../observability/request-context';
import { assertPortalPrincipal } from '../../identity/portal/portal-principal';
import type { AttachmentDownloadDto } from './portal-ticket.dto';

@Controller('portal/attachments')
@PortalRoute()
@UseGuards(PortalVisibilityGuard)
@RequirePermission('ticket:read')
export class PortalAttachmentsController {
  constructor(private readonly attachmentAccessService: AttachmentAccessService) {}

  @Get(':id/download')
  async download(@Param('id') id: string): Promise<AttachmentDownloadDto> {
    const principal = getPrincipalContext();
    assertPortalPrincipal(principal);

    const result = await this.attachmentAccessService.mintPortalDownloadUrl(id, principal);
    if (!result) {
      // 404, not 403 — prevents existence disclosure of internal attachments.
      throw new NotFoundException();
    }

    return result;
  }
}
