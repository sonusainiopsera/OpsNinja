/**
 * AI-settings DTOs — WO-063.
 *
 * Strict Zod schemas (z.strict()) so unknown properties return 400 rather
 * than being silently ignored.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// GET response
// ---------------------------------------------------------------------------

export interface AiSettingsResponse {
  aiEnabled:           boolean;
  monthlyTokenBudget:  number | null;
  warnThresholdPct:    number;
  updatedAt:           string;
  version:             number;
}

// ---------------------------------------------------------------------------
// PUT request
// ---------------------------------------------------------------------------

export const UpdateAiSettingsSchema = z
  .object({
    aiEnabled:          z.boolean().optional(),
    monthlyTokenBudget: z.number().int().positive().nullable().optional(),
    warnThresholdPct:   z.number().int().min(1).max(100).optional(),
    /** Current version — required for optimistic-concurrency check. */
    version:            z.number().int().min(1),
  })
  .strict();

export type UpdateAiSettingsDto = z.infer<typeof UpdateAiSettingsSchema>;

// ---------------------------------------------------------------------------
// GET /admin/ai-usage query
// ---------------------------------------------------------------------------

export const AiUsageQuerySchema = z
  .object({
    /** Period in YYYY-MM format. Defaults to current month when omitted. */
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM')
      .optional(),
  })
  .strict();

export type AiUsageQueryDto = z.infer<typeof AiUsageQuerySchema>;

// ---------------------------------------------------------------------------
// GET /admin/ai-usage response
// ---------------------------------------------------------------------------

export interface AiUsageResponse {
  period:               string;
  inputTokens:          number;
  outputTokens:         number;
  requestCount:         number;
  estimatedCostMicros:  number;
  /** Approximate cost in USD (derived from estimatedCostMicros). */
  estimatedCostUsd:     number;
  /** 0–100 percentage of monthly budget consumed. Null when no budget set. */
  budgetUtilisationPct: number | null;
}
