import { Injectable } from '@nestjs/common';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { ticketAttachments, type TicketAttachment, type NewTicketAttachment } from '@opsninja/db';
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

  /** Find a single finalized attachment by ID (no portal predicate — for agent/download use). */
  async findFinalizedById(id: string, tenantId: string): Promise<TicketAttachment | null> {
    const rows = await this.tx
      .select()
      .from(ticketAttachments)
      .where(
        and(
          eq(ticketAttachments.id, id),
          eq(ticketAttachments.tenantId, tenantId),
          eq(ticketAttachments.isFinalized, true),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Find an unfinalized attachment row by ID (used during finalize endpoint). */
  async findUnfinalizedById(id: string, tenantId: string): Promise<TicketAttachment | null> {
    const rows = await this.tx
      .select()
      .from(ticketAttachments)
      .where(
        and(
          eq(ticketAttachments.id, id),
          eq(ticketAttachments.tenantId, tenantId),
          eq(ticketAttachments.isFinalized, false),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByCommentId(commentId: string): Promise<TicketAttachment[]> {
    const principal = getPrincipalContext();
    const baseWhere = and(
      eq(ticketAttachments.commentId, commentId),
      eq(ticketAttachments.isFinalized, true),
    );
    const where = isPortalPrincipal(principal)
      ? and(baseWhere, portalAttachmentPredicate(principal))
      : baseWhere;

    return this.tx.select().from(ticketAttachments).where(where!);
  }

  // --------------------------------------------------------------------------
  // Write — WO-035
  // --------------------------------------------------------------------------

  /**
   * Insert an unfinalized attachment row.
   * Called by the presign endpoint; isFinalized defaults to false.
   */
  async insertUnfinalized(
    data: Omit<NewTicketAttachment, 'id' | 'createdAt' | 'isFinalized' | 'finalizedAt'>,
  ): Promise<TicketAttachment> {
    const rows = await this.tx
      .insert(ticketAttachments)
      .values({ ...data, isFinalized: false })
      .returning();
    const row = rows[0];
    if (!row) throw new Error('Attachment insert returned no rows');
    return row;
  }

  /**
   * Finalize an attachment row — sets isFinalized=true, detectedMime, checksum,
   * fileSizeBytes and finalizedAt in one atomic UPDATE.
   *
   * Idempotent: if the row is already finalized, returns the existing row.
   * Returns null when the attachment ID is not found in this tenant.
   */
  async finalizeAttachment(
    id: string,
    tenantId: string,
    detectedMime: string,
    checksum: string,
    fileSizeBytes: number,
  ): Promise<TicketAttachment | null> {
    const rows = await this.tx
      .update(ticketAttachments)
      .set({
        isFinalized: true,
        detectedMime,
        checksum,
        fileSizeBytes,
        finalizedAt: sql`now()`,
      })
      .where(
        and(
          eq(ticketAttachments.id, id),
          eq(ticketAttachments.tenantId, tenantId),
        ),
      )
      .returning();
    return rows[0] ?? null;
  }

  /**
   * Find unfinalized attachment rows older than the given cutoff.
   * Used by the orphan-reaper to find stale uploads.
   */
  async findOrphanedAttachments(
    tenantId: string,
    olderThan: Date,
  ): Promise<TicketAttachment[]> {
    return this.tx
      .select()
      .from(ticketAttachments)
      .where(
        and(
          eq(ticketAttachments.tenantId, tenantId),
          eq(ticketAttachments.isFinalized, false),
          lt(ticketAttachments.createdAt, olderThan),
        ),
      );
  }

  /**
   * Hard-delete an attachment row (called by the orphan-reaper after the
   * S3 object has been deleted).
   */
  async deleteById(id: string, tenantId: string): Promise<void> {
    await this.tx
      .delete(ticketAttachments)
      .where(
        and(
          eq(ticketAttachments.id, id),
          eq(ticketAttachments.tenantId, tenantId),
        ),
      );
  }
}
