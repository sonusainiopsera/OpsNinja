/**
 * DTOs for AI summary update and regenerate endpoints — WO-065.
 *
 * UpdateAiSummarySchema:
 *   Validates PATCH /api/v1/tickets/:id/ai-summary.
 *   - Strict: rejects unknown properties.
 *   - version is required for optimistic-concurrency.
 *   - crux/resolution capped at 2 000 chars each.
 *   - affectedAreas: each label max 100 chars, confidence enum.
 *
 * All validations produce standard { error: { code, message, details[] } }
 * via ZodValidationPipe.
 */

import { z } from 'zod';

const ConfidenceEnum = z.enum(['low', 'medium', 'high']);

const AffectedAreaItemSchema = z
  .object({
    areaLabel:  z.string().min(1).max(100),
    confidence: ConfidenceEnum,
  })
  .strict();

export const UpdateAiSummarySchema = z
  .object({
    /** Optimistic-concurrency version — required; mismatch → 409. */
    version: z.number().int().positive(),
    /** Updated crux sentence. If omitted, the existing crux is preserved. */
    crux:        z.string().min(1).max(2000).optional(),
    /** Updated resolution paragraph. */
    resolution:  z.string().min(1).max(2000).optional(),
    /**
     * Full replacement list of affected areas.
     * If provided, replaces the entire set; all rows get source='human'.
     */
    affectedAreas: z
      .array(AffectedAreaItemSchema)
      .min(0)
      .max(50)
      .optional(),
  })
  .strict();

export type UpdateAiSummaryDto = z.infer<typeof UpdateAiSummarySchema>;
