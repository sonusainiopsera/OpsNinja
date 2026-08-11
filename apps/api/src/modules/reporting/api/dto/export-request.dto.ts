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

export const CreateExportSchema = z.object({
  /** UUID of a saved report definition — mutually exclusive with `definition`. */
  definitionId: z.string().uuid().optional(),
  /** Inline definition — mutually exclusive with `definitionId`. */
  definition:   inlineExportDefinitionSchema.optional(),
  format:       z.literal('csv'),
}).strict().refine(
  (d) => Boolean(d.definitionId) !== Boolean(d.definition),
  { message: 'Provide exactly one of definitionId or definition', path: ['definitionId'] },
);

export type CreateExportDto = z.infer<typeof CreateExportSchema>;
