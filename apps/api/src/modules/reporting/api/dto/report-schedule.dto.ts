/**
 * DTOs for report schedule CRUD — WO-075.
 *
 * Cadence allow-list enforces a minimum 1-hour interval.
 * Recipients are validated by RecipientPolicy at the service layer.
 */

import { z } from 'zod';
import { ALLOWED_CADENCES, CADENCE_PRESETS } from '../../domain/cron-next-fire';

// ---------------------------------------------------------------------------
// Recipient schema
// ---------------------------------------------------------------------------

const recipientSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('user'),     userId: z.string().uuid() }),
    z.object({ type: z.literal('external'), email:  z.string().email() }),
  ]);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateScheduleSchema = z
  .object({
    cadence: z.enum(ALLOWED_CADENCES as [string, ...string[]]),
    /**
     * Required for cadence='custom'; auto-derived for presets.
     * Must be a valid 5-field cron expression.
     */
    cronExpression: z.string().min(1).max(200).optional(),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine(
        (tz) => {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: tz });
            return true;
          } catch {
            return false;
          }
        },
        { message: 'Invalid IANA timezone string.' },
      ),
    format: z.enum(['csv', 'pdf']).default('csv'),
    recipients: z.array(recipientSchema).min(1, 'At least one recipient is required.').max(50),
    enabled: z.boolean().default(true),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.cadence === 'custom' && !data.cronExpression) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'cronExpression is required when cadence is "custom".',
        path: ['cronExpression'],
      });
    }
  });

export type CreateScheduleDto = z.infer<typeof CreateScheduleSchema>;

// ---------------------------------------------------------------------------
// Update (partial patch)
// ---------------------------------------------------------------------------

export const UpdateScheduleSchema = z
  .object({
    cadence:        z.enum(ALLOWED_CADENCES as [string, ...string[]]).optional(),
    cronExpression: z.string().min(1).max(200).optional(),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine(
        (tz) => {
          try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
          catch { return false; }
        },
        { message: 'Invalid IANA timezone string.' },
      )
      .optional(),
    format:     z.enum(['csv', 'pdf']).optional(),
    recipients: z.array(recipientSchema).min(1).max(50).optional(),
    enabled:    z.boolean().optional(),
  })
  .strict();

export type UpdateScheduleDto = z.infer<typeof UpdateScheduleSchema>;

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export interface ScheduleResponse {
  id: string;
  reportDefinitionId: string;
  cadence: string;
  cronExpression: string;
  timezone: string;
  format: string;
  recipients: unknown[];
  enabled: boolean;
  nextFireAt: string | null;
  lastFiredAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleListResponse {
  data: ScheduleResponse[];
}

// ---------------------------------------------------------------------------
// Helper — resolve cron expression from cadence + override
// ---------------------------------------------------------------------------

export function resolveCronExpression(cadence: string, cronExpression?: string): string {
  if (cadence === 'custom') {
    if (!cronExpression) throw new Error('cronExpression required for custom cadence');
    return cronExpression;
  }
  return CADENCE_PRESETS[cadence] ?? '0 8 * * *';
}
