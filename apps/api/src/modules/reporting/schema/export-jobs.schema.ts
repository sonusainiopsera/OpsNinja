/**
 * Export jobs schema — reporting module exclusive ownership.
 *
 * Re-exports DB schema types and adds export-job DTO schemas.
 * Only the reporting module may query these tables directly.
 */

export {
  exportJobs,
  exportJobFormatEnum,
  exportJobStatusEnum,
  type ExportJob,
  type NewExportJob,
} from '@opsninja/db';

import { z } from 'zod';

// ── Zod DTOs ──────────────────────────────────────────────────────────────────

export const CreateExportJobDto = z
  .object({
    reportDefinitionId: z.string().uuid().optional().nullable(),
    format: z.enum(['csv', 'xlsx', 'pdf']),
  })
  .strict();

export type CreateExportJobInput = z.infer<typeof CreateExportJobDto>;

export const ExportJobStatusUpdateDto = z
  .object({
    status: z.enum(['pending', 'processing', 'completed', 'failed', 'expired']),
    s3Key: z.string().optional(),
    rowCount: z.number().int().nonnegative().optional(),
    byteSize: z.number().int().nonnegative().optional(),
    errorCode: z.string().optional(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();

export type ExportJobStatusUpdateInput = z.infer<typeof ExportJobStatusUpdateDto>;
