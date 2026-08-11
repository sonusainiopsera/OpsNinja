/**
 * ExportJobsRepository — data access for export_jobs.
 *
 * All writes (create, status transitions) use @Auditable so every mutation
 * appears in the immutable audit trail.
 *
 * Tenant scoping: all reads filter by tenantId. Missing or out-of-scope jobs
 * return null (404), not 403, to avoid existence disclosure.
 *
 * Idempotency guard: markProcessing uses a conditional UPDATE WHERE status='queued'
 * and returns null when no rows are affected, so the SQS consumer can detect
 * a redelivery without an in-memory set or a second query.
 */

import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  exportJobs,
  type ExportJob,
  type NewExportJob,
} from '@opsninja/db';
import { TenantRepository } from '../../../data/tenant-repository';
import { Auditable } from '../../audit/auditable.decorator';

@Injectable()
export class ExportJobsRepository extends TenantRepository {

  // --------------------------------------------------------------------------
  // Reads
  // --------------------------------------------------------------------------

  async findById(tenantId: string, id: string): Promise<ExportJob | null> {
    const rows = await this.tx
      .select()
      .from(exportJobs)
      .where(
        and(
          eq(exportJobs.tenantId, tenantId),
          eq(exportJobs.id, id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  // --------------------------------------------------------------------------
  // Writes — all decorated with @Auditable
  // --------------------------------------------------------------------------

  @Auditable({ resourceType: 'export_job', action: 'create' })
  async create(data: NewExportJob): Promise<ExportJob> {
    const rows = await this.tx
      .insert(exportJobs)
      .values(data)
      .returning();
    return rows[0]!;
  }

  /**
   * Atomically transitions status from 'queued' → 'processing'.
   *
   * Returns the job id on success, null when the transition did not apply
   * (already processing/completed/failed — i.e., a redelivered SQS message).
   * This is the idempotency guard for the export worker.
   */
  @Auditable({ resourceType: 'export_job', action: 'update', resourceIdArg: 0 })
  async markProcessing(id: string, sqsMessageId: string): Promise<string | null> {
    const rows = await this.tx
      .update(exportJobs)
      .set({ status: 'processing', errorCode: sqsMessageId }) // reuse errorCode as scratch; cleared on complete
      .where(
        and(
          eq(exportJobs.id, id),
          eq(exportJobs.status, 'queued'),
        ),
      )
      .returning({ id: exportJobs.id });
    return rows[0]?.id ?? null;
  }

  @Auditable({ resourceType: 'export_job', action: 'update', resourceIdArg: 0 })
  async markCompleted(
    id: string,
    update: { rowCount: number; byteSize: number; truncated: boolean; s3Key: string },
  ): Promise<void> {
    await this.tx
      .update(exportJobs)
      .set({
        status:      'completed',
        rowCount:    update.rowCount,
        byteSize:    update.byteSize,
        truncated:   update.truncated,
        s3Key:       update.s3Key,
        errorCode:   null,
        completedAt: new Date(),
      })
      .where(eq(exportJobs.id, id));
  }

  @Auditable({ resourceType: 'export_job', action: 'update', resourceIdArg: 0 })
  async markFailed(id: string, errorCode: string): Promise<void> {
    await this.tx
      .update(exportJobs)
      .set({ status: 'failed', errorCode, completedAt: new Date() })
      .where(eq(exportJobs.id, id));
  }
}
