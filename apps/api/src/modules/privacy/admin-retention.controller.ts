/**
 * AdminRetentionController — WO-085 administrative endpoints.
 *
 * Routes:
 *   GET /api/v1/admin/retention/status
 *     Returns the last N job runs and per-table purge statistics.
 *     Requires 'privacy:manage' permission (Support Administrator role).
 *
 *   GET /api/v1/admin/privacy/erasure-receipts/:requestId
 *     Returns the immutable erasure receipt for a completed GDPR erasure request.
 *     Requires 'privacy:manage' permission.
 *
 * Error responses use the standard { error: { code, message, traceId } } envelope.
 * No row content, SQL text or stack traces are returned.
 */

import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { eq, and, desc } from 'drizzle-orm';
import { RequirePermission } from '../../common/auth/require-permission.decorator';
import { getPrincipalContext } from '../../observability/request-context';
import { TenantRepository } from '../../data/tenant-repository';
import {
  retentionJobRuns,
  erasureReceipts,
  type RetentionJobRun,
  type ErasureReceipt,
  type ErasureReceiptEntry,
} from '@opsninja/db';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

interface JobRunSummaryEntry {
  table:               string;
  strategy:            string;
  rowsPurged:          number;
  partitionsDropped:   number;
  partitionsSkipped:   number;
  durationMs:          number;
  error?:              string;
}

interface JobRunView {
  id:          string;
  jobName:     string;
  startedAt:   string;
  finishedAt:  string | null;
  outcome:     string;
  tables:      JobRunSummaryEntry[];
}

interface RetentionStatusResponse {
  data: {
    lastSuccessAt: string | null;
    jobs:          JobRunView[];
  };
}

interface ErasureReceiptResponse {
  data: {
    requestId:   string;
    subjectRef:  string;
    completedAt: string;
    entries:     ErasureReceiptEntry[];
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller()
export class AdminRetentionController extends TenantRepository {
  private readonly logger = new Logger(AdminRetentionController.name);

  // --------------------------------------------------------------------------
  // GET /admin/retention/status
  // --------------------------------------------------------------------------

  @Get('admin/retention/status')
  @RequirePermission('privacy:manage')
  async getRetentionStatus(): Promise<RetentionStatusResponse> {
    // Fetch the 20 most recent job runs (no tenant scoping — global worker).
    const runs: RetentionJobRun[] = await this.tx
      .select()
      .from(retentionJobRuns)
      .orderBy(desc(retentionJobRuns.startedAt))
      .limit(20);

    const lastSuccess = runs.find((r) => r.outcome === 'success');

    const jobs: JobRunView[] = runs.map((run) => ({
      id:          run.id,
      jobName:     run.jobName,
      startedAt:   run.startedAt.toISOString(),
      finishedAt:  run.finishedAt?.toISOString() ?? null,
      outcome:     run.outcome,
      tables:      (run.summary as JobRunSummaryEntry[]) ?? [],
    }));

    return {
      data: {
        lastSuccessAt: lastSuccess?.finishedAt?.toISOString() ?? null,
        jobs,
      },
    };
  }

  // --------------------------------------------------------------------------
  // GET /admin/privacy/erasure-receipts/:requestId
  // --------------------------------------------------------------------------

  @Get('admin/privacy/erasure-receipts/:requestId')
  @RequirePermission('privacy:manage')
  async getErasureReceipt(
    @Param('requestId') requestId: string,
  ): Promise<ErasureReceiptResponse> {
    const { tenantId } = getPrincipalContext();

    const rows: ErasureReceipt[] = await this.tx
      .select()
      .from(erasureReceipts)
      .where(
        and(
          eq(erasureReceipts.tenantId, tenantId),
          eq(erasureReceipts.requestId, requestId),
        ),
      )
      .limit(1);

    if (!rows[0]) {
      throw new NotFoundException({
        error: {
          code:    'ERASURE_RECEIPT_NOT_FOUND',
          message: 'No erasure receipt found for this request ID.',
        },
      });
    }

    const receipt = rows[0];
    return {
      data: {
        requestId:   receipt.requestId,
        subjectRef:  receipt.subjectRef,
        completedAt: receipt.completedAt.toISOString(),
        entries:     (receipt.entries as ErasureReceiptEntry[]) ?? [],
      },
    };
  }
}
