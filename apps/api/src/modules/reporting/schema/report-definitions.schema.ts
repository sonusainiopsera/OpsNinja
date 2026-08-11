/**
 * Report definitions schema — reporting module exclusive ownership.
 *
 * Re-exports DB schema types and adds reporting-domain DTO schemas.
 * Only the reporting module may query these tables directly.
 */

export {
  reportDefinitions,
  reportChartTypeEnum,
  reportSharingScopeEnum,
  type ReportDefinition,
  type NewReportDefinition,
} from '@opsninja/db';

import { z } from 'zod';
import { ALL_DIMENSION_NAMES, ALL_METRIC_NAMES } from '../domain/report-field-catalog';

// ── Zod DTOs ──────────────────────────────────────────────────────────────────

export const CreateReportDefinitionDto = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    metrics: z
      .array(z.string().refine(m => ALL_METRIC_NAMES.includes(m), 'Unknown metric'))
      .min(1, 'At least one metric required'),
    groupBy: z
      .array(z.string().refine(d => ALL_DIMENSION_NAMES.includes(d), 'Unknown dimension'))
      .default([]),
    filterAst: z.unknown().optional().nullable(),
    chartType: z.enum(['table', 'bar', 'line', 'pie', 'area', 'heatmap']).default('table'),
    sharingScope: z.enum(['private', 'team', 'tenant']).default('private'),
    schedule: z.unknown().optional().nullable(),
  })
  .strict();

export type CreateReportDefinitionInput = z.infer<typeof CreateReportDefinitionDto>;

export const UpdateReportDefinitionDto = CreateReportDefinitionDto.partial().strict();
export type UpdateReportDefinitionInput = z.infer<typeof UpdateReportDefinitionDto>;
