/**
 * Notification Preferences DTOs — WO-081.
 *
 * Strict Zod schemas for the portal and admin preference endpoints.
 * z.strict() on all object schemas ensures unknown properties return 400
 * rather than being silently accepted (AC-5 requirement).
 *
 * API contracts:
 *
 * Portal (contact-level):
 *   GET  /api/v1/portal/me/notification-preferences
 *     → { data: { defaults: [...], overrides: [...], version } }
 *   PUT  /api/v1/portal/me/notification-preferences
 *     body: { overrides: [...], version }
 *     → { data: { defaults: [...], overrides: [...], version } }
 *     409 on version mismatch, 400 on unknown eventType or unknown property
 *
 * Admin (org defaults):
 *   GET  /api/v1/organizations/{id}/notification-defaults
 *     → { data: { defaults: [...], overrides: [], version } }
 *   PUT  /api/v1/organizations/{id}/notification-defaults
 *     body: { overrides: [...], version }
 *     → { data: { defaults: [...], overrides: [], version } }
 */

import { z } from 'zod';
import { NOTIFICATION_EVENT_TYPES } from '../event-catalogue';

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

export const NotificationModeSchema = z.enum(['immediate', 'off']);

export const PreferenceEntrySchema = z.object({
  eventType: z.string().refine(
    (v) => NOTIFICATION_EVENT_TYPES.has(v),
    (v) => ({ message: `"${v}" is not a valid notification event type` }),
  ),
  channel: z.enum(['email']),
  mode: NotificationModeSchema,
});

export type PreferenceEntryDto = z.infer<typeof PreferenceEntrySchema>;

// ---------------------------------------------------------------------------
// PUT request body schemas (z.strict() rejects unknown properties → 400)
// ---------------------------------------------------------------------------

export const UpdatePreferencesBodySchema = z.object({
  overrides: z.array(PreferenceEntrySchema),
  /**
   * Optimistic concurrency version. Returned by GET and must be supplied on PUT.
   * 409 ConflictException is returned if the version in the DB differs.
   */
  version: z.number().int().min(0),
}).strict();

export type UpdatePreferencesBodyDto = z.infer<typeof UpdatePreferencesBodySchema>;

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export const PreferencesResponseSchema = z.object({
  data: z.object({
    defaults: z.array(PreferenceEntrySchema),
    overrides: z.array(PreferenceEntrySchema),
    version: z.number().int().min(0),
  }),
});

export type PreferencesResponseDto = z.infer<typeof PreferencesResponseSchema>;
