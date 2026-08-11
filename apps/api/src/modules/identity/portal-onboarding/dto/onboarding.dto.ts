/**
 * Portal onboarding DTOs — WO-088.
 *
 * Strict Zod schemas shared between controller validation and the portal SPA.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// verify-organization step
// ---------------------------------------------------------------------------

const ChangeRequestFieldSchema = z.object({
  key:           z.string().min(1).max(100),
  currentValue:  z.string().max(2000),
  proposedValue: z.string().max(2000),
  note:          z.string().max(500).optional(),
});

export const VerifyOrgStepSchema = z
  .discriminatedUnion('action', [
    z.object({
      action:  z.literal('confirm'),
      version: z.number().int().min(1),
    }),
    z.object({
      action:  z.literal('request_change'),
      fields:  z.array(ChangeRequestFieldSchema).min(1).max(20),
      version: z.number().int().min(1),
    }),
  ])
  .and(z.object({})); // keep discriminated union clean

export type VerifyOrgStepDto = z.infer<typeof VerifyOrgStepSchema>;

// ---------------------------------------------------------------------------
// preferences step
// ---------------------------------------------------------------------------

export const ALLOWED_CHANNELS    = ['email', 'webhook'] as const;
export const ALLOWED_CADENCES    = ['immediate', 'daily_digest', 'weekly_digest'] as const;

export const PreferencesStepSchema = z
  .object({
    channels:      z.array(z.enum(ALLOWED_CHANNELS)).min(0).max(10),
    digestCadence: z.enum(ALLOWED_CADENCES),
    version:       z.number().int().min(1),
  })
  .strict();

export type PreferencesStepDto = z.infer<typeof PreferencesStepSchema>;

// ---------------------------------------------------------------------------
// tutorial step
// ---------------------------------------------------------------------------

export const TutorialStepSchema = z
  .object({
    action:         z.enum(['complete', 'skip']),
    contentVersion: z.string().min(1).max(50),
    version:        z.number().int().min(1),
  })
  .strict();

export type TutorialStepDto = z.infer<typeof TutorialStepSchema>;
