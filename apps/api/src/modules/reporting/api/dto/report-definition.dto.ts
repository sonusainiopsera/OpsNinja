import { z } from 'zod';

export const SHARING_SCOPES = ['private', 'team', 'tenant'] as const;
export type SharingScopeValue = (typeof SHARING_SCOPES)[number];

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateReportDefinitionSchema = z.object({
  name:         z.string().min(1).max(255),
  description:  z.string().max(2000).optional(),
  metrics:      z.array(z.string().min(1)).min(1, 'At least one metric required'),
  groupBy:      z.array(z.string().min(1)).default([]),
  filterAst:    z.unknown().optional(),
  chartType:    z.enum(['table', 'bar', 'line']),
  sharingScope: z.enum(SHARING_SCOPES).default('private'),
}).strict();

export type CreateReportDefinitionDto = z.infer<typeof CreateReportDefinitionSchema>;

// ---------------------------------------------------------------------------
// Update (partial + requires version for optimistic concurrency)
// ---------------------------------------------------------------------------

export const UpdateReportDefinitionSchema = z.object({
  name:         z.string().min(1).max(255).optional(),
  description:  z.string().max(2000).optional(),
  metrics:      z.array(z.string().min(1)).min(1).optional(),
  groupBy:      z.array(z.string().min(1)).optional(),
  filterAst:    z.unknown().optional(),
  chartType:    z.enum(['table', 'bar', 'line']).optional(),
  sharingScope: z.enum(SHARING_SCOPES).optional(),
  version:      z.number().int().positive('version is required for optimistic concurrency'),
}).strict();

export type UpdateReportDefinitionDto = z.infer<typeof UpdateReportDefinitionSchema>;

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------

export const ListReportDefinitionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.string().optional()
    .transform((v) => Math.min(Math.max(parseInt(v ?? '25', 10), 1), 100))
    .default('25'),
});

export type ListReportDefinitionsQueryDto = z.infer<typeof ListReportDefinitionsQuerySchema>;
