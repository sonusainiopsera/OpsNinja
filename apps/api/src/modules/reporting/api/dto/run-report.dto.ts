import { z } from 'zod';

const inlineDefinitionSchema = z.object({
  metrics:    z.array(z.string().min(1)).min(1, 'At least one metric is required'),
  groupBy:    z.array(z.string().min(1)).default([]),
  filterAst:  z.unknown().optional(),
  chartType:  z.enum(['table', 'bar', 'line']),
  sort: z.object({
    field:     z.string().min(1),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
}).strict();

export const RunReportSchema = z.object({
  definitionId: z.string().uuid().optional(),
  definition:   inlineDefinitionSchema.optional(),
}).strict().refine(
  (d) => Boolean(d.definitionId) !== Boolean(d.definition),
  { message: 'Provide exactly one of definitionId or definition', path: ['definitionId'] },
);

export type RunReportDto = z.infer<typeof RunReportSchema>;
export type InlineDefinitionDto = z.infer<typeof inlineDefinitionSchema>;
