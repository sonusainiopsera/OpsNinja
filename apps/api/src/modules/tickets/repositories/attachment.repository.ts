import { Injectable } from '@nestjs/common';
import { eq, inArray, attachments } from '@opsninja/db';
import type { Attachment } from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';

@Injectable()
export class AttachmentRepository extends TenantRepository {
  /** Returns a single attachment by ID within the current tenant. */
  async findById(id: string): Promise<Attachment | undefined> {
    const rows = await this.db
      .select()
      .from(attachments)
      .where(eq(attachments.id, id));
    return rows[0];
  }

  /** Returns all attachments for a set of comment IDs. */
  async findByCommentIds(commentIds: string[]): Promise<Attachment[]> {
    if (commentIds.length === 0) return [];
    return this.db
      .select()
      .from(attachments)
      .where(inArray(attachments.commentId, commentIds));
  }
}
