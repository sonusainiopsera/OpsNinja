/**
 * SLA settings API types — WO-049.
 *
 * These mirror the server DTOs in apps/api/src/modules/sla/dto/sla-policy.dto.ts
 * so client and server shapes cannot silently drift.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export type SlaPriority = 'P1' | 'P2' | 'P3' | 'P4';
export type SlaScopeType = 'tenant' | 'organization' | 'custom';
export type SlaCalendarType = 'business_hours' | 'twenty_four_seven';

export interface SlaPriorityTarget {
  priority: SlaPriority;
  responseMinutes: number;
  resolutionMinutes: number;
}

export interface SlaPolicy {
  id: string;
  name: string;
  scopeType: SlaScopeType;
  scopeId: string | null;
  calendarId: string | null;
  calendarName: string | null;
  appliedOrganizationCount: number;
  targetsRatified: boolean;
  version: number;
  targets: SlaPriorityTarget[];
  pauseConditions: string[];
  firstReminderPct: number;
  secondReminderPct: number;
  onCallRoutingId: string | null;
  channelEmail: boolean;
  channelWebhook: boolean;
  channelPagerDuty: boolean;
}

export interface SlaCalendar {
  id: string;
  name: string;
  calendarType: SlaCalendarType;
  timezone: string;
}

export type SchedulerHealthStatus = 'healthy' | 'degraded' | 'unknown';

export interface SchedulerHealth {
  status: SchedulerHealthStatus;
  lagMs: number | null;
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// API response envelopes
// ---------------------------------------------------------------------------

export interface SlaPoliciesListResponse {
  data: SlaPolicy[];
}

export interface SlaPolicyResponse {
  data: SlaPolicy;
}

export interface SlaCalendarsListResponse {
  data: SlaCalendar[];
}

export interface SchedulerHealthResponse {
  data: SchedulerHealth;
}

// ---------------------------------------------------------------------------
// Form schema (mirrors server DTO for identical validation)
// ---------------------------------------------------------------------------

const priorityTargetSchema = z.object({
  priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  responseMinutes: z
    .number({ invalid_type_error: 'Must be a number' })
    .int('Must be a whole number')
    .min(1, 'Must be at least 1 minute')
    .max(43200, 'Cannot exceed 43,200 minutes (30 days)'),
  resolutionMinutes: z
    .number({ invalid_type_error: 'Must be a number' })
    .int('Must be a whole number')
    .min(1, 'Must be at least 1 minute')
    .max(43200, 'Cannot exceed 43,200 minutes (30 days)'),
});

export const slaPolicyFormSchema = z
  .object({
    name: z.string().min(1, 'Policy name is required'),
    targets: z.array(priorityTargetSchema).length(4, 'All four priority targets are required'),
    calendarId: z.string().uuid().nullable(),
    pauseConditions: z.array(z.string()),
    firstReminderPct: z
      .number({ invalid_type_error: 'Must be a number' })
      .int()
      .min(1, 'Must be at least 1%')
      .max(98, 'Must be less than 99%'),
    secondReminderPct: z
      .number({ invalid_type_error: 'Must be a number' })
      .int()
      .min(2, 'Must be at least 2%')
      .max(99, 'Must be less than 100%'),
    onCallRoutingId: z.string().nullable(),
    channelEmail: z.boolean(),
    channelWebhook: z.boolean(),
    channelPagerDuty: z.boolean(),
    changeAuditNote: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.firstReminderPct >= data.secondReminderPct) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `First reminder (${data.firstReminderPct}%) must be less than second reminder (${data.secondReminderPct}%)`,
        path: ['secondReminderPct'],
      });
    }
  });

export type SlaPolicyFormValues = z.infer<typeof slaPolicyFormSchema>;

// ---------------------------------------------------------------------------
// Default form values
// ---------------------------------------------------------------------------

export const DEFAULT_FORM_VALUES: SlaPolicyFormValues = {
  name: '',
  targets: [
    { priority: 'P1', responseMinutes: 15, resolutionMinutes: 60 },
    { priority: 'P2', responseMinutes: 60, resolutionMinutes: 240 },
    { priority: 'P3', responseMinutes: 240, resolutionMinutes: 1440 },
    { priority: 'P4', responseMinutes: 480, resolutionMinutes: 2880 },
  ],
  calendarId: null,
  pauseConditions: [],
  firstReminderPct: 50,
  secondReminderPct: 75,
  onCallRoutingId: null,
  channelEmail: true,
  channelWebhook: false,
  channelPagerDuty: false,
  changeAuditNote: '',
};

// Available pause conditions — ticket statuses that can pause the SLA clock
export const PAUSE_CONDITIONS = [
  { value: 'pending_customer_input', label: 'Pending Customer Input' },
  { value: 'pending_vendor', label: 'Pending Vendor' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'awaiting_change_window', label: 'Awaiting Change Window' },
] as const;
