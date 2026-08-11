/**
 * SLA policy and calendar DTOs — strict Zod schemas.
 *
 * .strict() rejects unknown properties (AC-10).
 * Timezone strings are validated against Intl.supportedValuesOf('timeZone').
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared constants and validators
// ---------------------------------------------------------------------------

export const SLA_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export const SLA_SCOPE_TYPES = ['tenant', 'organization', 'custom'] as const;
export const SLA_CALENDAR_TYPES = ['business_hours', 'twenty_four_seven'] as const;

/** IANA timezone allow-list derived at module load time. */
const VALID_TIMEZONES: ReadonlySet<string> = (() => {
  try {
    return new Set(Intl.supportedValuesOf('timeZone'));
  } catch {
    // Node 18+ supports this; fall back to an empty set (runtime check skipped)
    return new Set<string>();
  }
})();

const ianaTimezoneSchema = z.string().superRefine((val, ctx) => {
  if (VALID_TIMEZONES.size > 0 && !VALID_TIMEZONES.has(val)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `"${val}" is not a valid IANA timezone identifier`,
      path: [],
    });
  }
});

const localTimeSchema = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/,
  'Must be a valid HH:MM or HH:MM:SS local time string',
);

const dateSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}$/,
  'Must be a valid YYYY-MM-DD date',
);

// ---------------------------------------------------------------------------
// Calendar window
// ---------------------------------------------------------------------------

export const CreateCalendarWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startLocalTime: localTimeSchema,
  endLocalTime: localTimeSchema,
}).strict().superRefine((val, ctx) => {
  if (val.startLocalTime >= val.endLocalTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'startLocalTime must be before endLocalTime',
      path: ['startLocalTime'],
    });
  }
});

export type CreateCalendarWindowDto = z.infer<typeof CreateCalendarWindowSchema>;

// ---------------------------------------------------------------------------
// Calendar holiday
// ---------------------------------------------------------------------------

export const CreateCalendarHolidaySchema = z.object({
  holidayDate: dateSchema,
  label: z.string().min(1).max(200),
}).strict();

export type CreateCalendarHolidayDto = z.infer<typeof CreateCalendarHolidaySchema>;

// ---------------------------------------------------------------------------
// sla_calendars create / update
// ---------------------------------------------------------------------------

export const CreateCalendarSchema = z.object({
  name: z.string().min(1).max(200),
  calendarType: z.enum(SLA_CALENDAR_TYPES),
  timezone: ianaTimezoneSchema,
  windows: z.array(CreateCalendarWindowSchema).optional().default([]),
  holidays: z.array(CreateCalendarHolidaySchema).optional().default([]),
}).strict().superRefine((val, ctx) => {
  if (val.calendarType === 'business_hours' && val.windows.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A business_hours calendar must have at least one working window',
      path: ['windows'],
    });
  }
  // Reject duplicate holiday dates within one request.
  const dates = val.holidays.map((h) => h.holidayDate);
  const unique = new Set(dates);
  if (unique.size !== dates.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Duplicate holiday dates in the same request are not permitted',
      path: ['holidays'],
    });
  }
});

export type CreateCalendarDto = z.infer<typeof CreateCalendarSchema>;

export const UpdateCalendarSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  calendarType: z.enum(SLA_CALENDAR_TYPES).optional(),
  timezone: ianaTimezoneSchema.optional(),
  windows: z.array(CreateCalendarWindowSchema).optional(),
  holidays: z.array(CreateCalendarHolidaySchema).optional(),
}).strict();

export type UpdateCalendarDto = z.infer<typeof UpdateCalendarSchema>;

// ---------------------------------------------------------------------------
// sla_policies create / update
// ---------------------------------------------------------------------------

export const CreatePolicySchema = z.object({
  scopeType: z.enum(SLA_SCOPE_TYPES).optional().default('tenant'),
  scopeId: z.string().uuid().nullable().optional(),
  priority: z.enum(SLA_PRIORITIES),
  responseTargetMins: z.number().int().min(1, 'Must be > 0').max(43200, 'Must be <= 43200'),
  resolutionTargetMins: z.number().int().min(1, 'Must be > 0').max(43200, 'Must be <= 43200'),
  calendarId: z.string().uuid(),
  reminderPctFirst: z.number().int().min(1, 'Must be > 0').max(98, 'Must be < reminderPctSecond'),
  reminderPctSecond: z.number().int().min(2, 'Must be > reminderPctFirst').max(99, 'Must be < 100'),
}).strict().superRefine((val, ctx) => {
  if (val.reminderPctFirst >= val.reminderPctSecond) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reminderPctFirst must be less than reminderPctSecond',
      path: ['reminderPctFirst'],
    });
  }
});

export type CreatePolicyDto = z.infer<typeof CreatePolicySchema>;

export const UpdatePolicySchema = z.object({
  responseTargetMins: z.number().int().min(1).max(43200).optional(),
  resolutionTargetMins: z.number().int().min(1).max(43200).optional(),
  calendarId: z.string().uuid().optional(),
  reminderPctFirst: z.number().int().min(1).max(98).optional(),
  reminderPctSecond: z.number().int().min(2).max(99).optional(),
  targetsRatified: z.boolean().optional(),
  /** Optimistic concurrency — must match current version or 409 is returned. */
  ifMatchVersion: z.number().int().min(1),
}).strict().superRefine((val, ctx) => {
  if (
    val.reminderPctFirst !== undefined &&
    val.reminderPctSecond !== undefined &&
    val.reminderPctFirst >= val.reminderPctSecond
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reminderPctFirst must be less than reminderPctSecond',
      path: ['reminderPctFirst'],
    });
  }
});

export type UpdatePolicyDto = z.infer<typeof UpdatePolicySchema>;

// ---------------------------------------------------------------------------
// Response types (never include audit-internal fields)
// ---------------------------------------------------------------------------

export interface SlaCalendarWindowResponse {
  id: string;
  weekday: number;
  startLocalTime: string;
  endLocalTime: string;
}

export interface SlaCalendarHolidayResponse {
  id: string;
  holidayDate: string;
  label: string;
}

export interface SlaCalendarResponse {
  id: string;
  name: string;
  calendarType: string;
  timezone: string;
  isActive: boolean;
  windows: SlaCalendarWindowResponse[];
  holidays: SlaCalendarHolidayResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface SlaPolicyResponse {
  id: string;
  scopeType: string;
  scopeId: string | null;
  priority: string;
  responseTargetMins: number;
  resolutionTargetMins: number;
  calendarId: string;
  reminderPctFirst: number;
  reminderPctSecond: number;
  isActive: boolean;
  targetsRatified: boolean;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextCursor: string | null;
}
