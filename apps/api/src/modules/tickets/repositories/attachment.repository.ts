import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { ticketAttachments, type TicketAttachment } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { getPrincipalContext } from '../../../observability/request-context';
import { isPortalPrincipal } from '../../identity/portal/portal-principal';
import { portalAttachmentPredicate } from '../../../common/db/scoped-query.helper';

@Injectable()
export class AttachmentRepository extends TenantRepository {
  /**
   * Find a single attachment by ID with org-scope enforcement for portal principals.
   * Does NOT filter on comment visibility — the caller (AttachmentAccessService)
   * performs the visibility check before minting a pre-signed URL.
   */
  async findById(id: string): Promise<TicketAttachment | null> {
    const principal = getPrincipalContext();
    const baseWhere = eq(ticketAttachments.id, id);
    const where = isPortalPrincipal(principal)
      ? and(baseWhere, portalAttachmentPredicate(principal))
      : baseWhere;

    const rows = await this.tx.select().from(ticketAttachments).where(where).limit(1);
    return rows[0] ?? null;
  }

  async findByCommentId(commentId: string): Promise<TicketAttachment[]> {
    const principal = getPrincipalContext();
    const baseWhere = eq(ticketAttachments.commentId, commentId);
    const where = isPortalPrincipal(principal)
      ? and(baseWhere, portalAttachmentPredicate(principal))
      : baseWhere;

    return this.tx.select().from(ticketAttachments).where(where);
  }
}
