/**
 * SubjectRequestService — WO-096.
 *
 * Orchestrates the GDPR data-subject rights lifecycle:
 *   access       → assemble export archive, upload to S3, return pre-signed URL
 *   portability  → same as access (machine-readable JSON format)
 *   rectification → record the request; human workflow handles correction
 *   erasure      → delegate to crypto-shred / tombstone pipeline (WO-085),
 *                  report pending | deferred | completed
 *
 * Duplicate detection:
 *   The unique partial index (tenant_id, type, subject_id) WHERE status IN
 *   ('queued','running') prevents concurrent duplicate requests at DB level.
 *   A 409 is returned when the constraint fires.
 *
 * The service operates within the existing withTenantTransaction() context
 * (i.e. injected via TenantRepository pattern).  No raw pool access needed.
 */

import {
  Injectable,
  ConflictException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';

import { subjectRequests } from '@opsninja/db';
import type { SubjectRequest, SubjectRequestType, SubjectRequestStatus } from '@opsninja/db';
import { TenantRepository } from '../../data/tenant-repository';
import { getPrincipalContext } from '../../observability/request-context';

export interface CreateSubjectRequestDto {
  type:        SubjectRequestType;
  subjectType: string;
  subjectId:   string;
  note?:       string;
}

export interface SubjectRequestView {
  requestId:      string;
  type:           SubjectRequestType;
  status:         SubjectRequestStatus;
  statusUrl:      string;
  deferralReason?: string | null;
  downloadUrl?:   string | null;
  expiresAt?:     Date | null;
  completedAt?:   Date | null;
}

@Injectable()
export class SubjectRequestService extends TenantRepository {
  private readonly logger = new Logger(SubjectRequestService.name);

  // --------------------------------------------------------------------------
  // Create a new subject request (or return existing in-flight one)
  // --------------------------------------------------------------------------

  async create(dto: CreateSubjectRequestDto): Promise<SubjectRequestView> {
    const { tenantId, userId } = getPrincipalContext();

    const id = randomUUID();

    try {
      await this.tx
        .insert(subjectRequests)
        .values({
          id,
          tenantId,
          type:        dto.type,
          subjectType: dto.subjectType,
          subjectId:   dto.subjectId,
          requestedBy: userId,
          status:      'queued',
        });
    } catch (err: unknown) {
      // Unique partial index violation — an in-flight request already exists.
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        // Fetch the existing in-flight request to return its status URL.
        const existing = await this.tx
          .select()
          .from(subjectRequests)
          .where(
            and(
              eq(subjectRequests.tenantId, tenantId),
              eq(subjectRequests.type, dto.type),
              eq(subjectRequests.subjectId, dto.subjectId),
            ),
          )
          .limit(1);

        if (existing[0]) {
          return this.toView(existing[0]);
        }

        throw new ConflictException({
          error: {
            code:    'SUBJECT_REQUEST_DUPLICATE',
            message: 'A request of this type for this subject is already in progress.',
          },
        });
      }
      throw err;
    }

    this.logger.log(
      `[privacy] subject_request created id=${id} type=${dto.type} ` +
      `subject=${dto.subjectType}/${dto.subjectId} tenant=${tenantId}`,
    );

    return {
      requestId: id,
      type:      dto.type,
      status:    'queued',
      statusUrl: `/api/v1/privacy/subject-requests/${id}`,
    };
  }

  // --------------------------------------------------------------------------
  // Get request status
  // --------------------------------------------------------------------------

  async getById(id: string): Promise<SubjectRequestView | null> {
    const { tenantId } = getPrincipalContext();

    const rows = await this.tx
      .select()
      .from(subjectRequests)
      .where(
        and(
          eq(subjectRequests.id, id),
          eq(subjectRequests.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!rows[0]) return null;
    return this.toView(rows[0]);
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private toView(row: SubjectRequest): SubjectRequestView {
    return {
      requestId:      row.id,
      type:           row.type as SubjectRequestType,
      status:         row.status as SubjectRequestStatus,
      statusUrl:      `/api/v1/privacy/subject-requests/${row.id}`,
      deferralReason: row.deferralReason ?? null,
      downloadUrl:    null,   // populated by export worker on completion
      expiresAt:      null,
      completedAt:    row.completedAt ?? null,
    };
  }
}
