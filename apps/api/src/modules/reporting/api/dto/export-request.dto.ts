import { z } from 'zod';

const inlineExportDefinitionSchema = z.object({
  metrics:   z.array(z.string().min(1)).min(1, 'At least one metric is required'),
  groupBy:   z.array(z.string().min(1)).default([]),
  filterAst: z.unknown().optional(),
  sort: z.object({
    field:     z.string().min(1),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
}).strict();

/**
 * PDF exports are capped at PDF_ROW_CAP rows (default 5 000).
 * Requests exceeding the cap are rejected with EXPORT_FORMAT_ROW_LIMIT.
 */
export const PDF_ROW_CAP = parseInt(
  process.env['PDF_ROW_CAP'] ?? '5000',
  10,
);

export const CreateExportSchema = z.object({
  /** UUID of a saved report definition — mutually exclusive with `definition`. */
  definitionId: z.string().uuid().optional(),
  /** Inline definition — mutually exclusive with `definitionId`. */
  definition:   inlineExportDefinitionSchema.optional(),
  /** Export format. PDF is limited to PDF_ROW_CAP rows; use csv for bulk exports. */
  format:       z.enum(['csv', 'pdf']).default('csv'),
}).strict().refine(
  (d) => Boolean(d.definitionId) !== Boolean(d.definition),
  { message: 'Provide exactly one of definitionId or definition', path: ['definitionId'] },
);

export type CreateExportDto = z.infer<typeof CreateExportSchema>;
