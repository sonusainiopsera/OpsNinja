import { z } from 'zod';

// ── Timezone allow-list ───────────────────────────────────────────────────────

let _tzCache: Set<string> | null = null;
function getValidTimezones(): Set<string> {
  if (!_tzCache) {
    try {
      _tzCache = new Set(Intl.supportedValuesOf('timeZone'));
    } catch {
      // Node < 18 fallback — accept anything non-empty; validated by DB on write
      _tzCache = new Set();
    }
  }
  return _tzCache;
}

const TimezoneSchema = z.string().min(1).refine(
  (tz) => {
    const zones = getValidTimezones();
    return zones.size === 0 || zones.has(tz);
  },
  { message: 'timezone must be a valid IANA timezone identifier' },
);

// ── Calendar window ───────────────────────────────────────────────────────────

const CalendarWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  start_local_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'must be HH:MM or HH:MM:SS'),
  end_local_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'must be HH:MM or HH:MM:SS'),
}).refine(
  (w) => w.start_local_time < w.end_local_time,
  { message: 'start_local_time must be before end_local_time', path: ['end_local_time'] },
);

// ── Calendar holiday ──────────────────────────────────────────────────────────

const CalendarHolidaySchema = z.object({
  holiday_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  label: z.string().min(1).max(255),
});

// ── Create calendar ───────────────────────────────────────────────────────────

export const CreateCalendarSchema = z.object({
  name: z.string().min(1).max(255),
  calendar_type: z.enum(['business_hours', 'twenty_four_seven']),
  timezone: TimezoneSchema,
  windows: z.array(CalendarWindowSchema).optional().default([]),
  holidays: z.array(CalendarHolidaySchema).optional().default([]),
}).strict().superRefine((val, ctx) => {
  if (val.calendar_type === 'business_hours' && val.windows.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'business_hours calendar must have at least one window',
      path: ['windows'],
    });
  }
  // Duplicate holiday dates
  const dates = val.holidays.map((h) => h.holiday_date);
  const seen = new Set<string>();
  dates.forEach((d, i) => {
    if (seen.has(d)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duplicate holiday_date in payload',
        path: ['holidays', i, 'holiday_date'],
      });
    }
    seen.add(d);
  });
});

export type CreateCalendarDto = z.infer<typeof CreateCalendarSchema>;

export const UpdateCalendarSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  calendar_type: z.enum(['business_hours', 'twenty_four_seven']).optional(),
  timezone: TimezoneSchema.optional(),
  windows: z.array(CalendarWindowSchema).optional(),
  holidays: z.array(CalendarHolidaySchema).optional(),
}).strict().superRefine((val, ctx) => {
  if (val.calendar_type === 'business_hours' && val.windows !== undefined && val.windows.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'business_hours calendar must have at least one window',
      path: ['windows'],
    });
  }
});

export type UpdateCalendarDto = z.infer<typeof UpdateCalendarSchema>;

// ── Create SLA policy ─────────────────────────────────────────────────────────

export const CreatePolicySchema = z.object({
  scope_type: z.enum(['tenant', 'organization', 'ticket_type']).default('tenant'),
  scope_id: z.string().uuid().nullable().optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']),
  response_target_mins: z.number().int().min(1).max(43200),
  resolution_target_mins: z.number().int().min(1).max(43200),
  calendar_id: z.string().uuid(),
  reminder_pct_first: z.number().int().min(1).max(98),
  reminder_pct_second: z.number().int().min(2).max(99),
}).strict().superRefine((val, ctx) => {
  if (val.resolution_target_mins < val.response_target_mins) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resolution_target_mins must be >= response_target_mins',
      path: ['resolution_target_mins'],
    });
  }
  if (val.reminder_pct_first >= val.reminder_pct_second) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reminder_pct_first must be less than reminder_pct_second',
      path: ['reminder_pct_first'],
    });
  }
  if (val.reminder_pct_second >= 100) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reminder_pct_second must be less than 100',
      path: ['reminder_pct_second'],
    });
  }
});

export type CreatePolicyDto = z.infer<typeof CreatePolicySchema>;

export const UpdatePolicySchema = z.object({
  scope_type: z.enum(['tenant', 'organization', 'ticket_type']).optional(),
  scope_id: z.string().uuid().nullable().optional(),
  priority: z.enum(['P1', 'P2', 'P3', 'P4']).optional(),
  response_target_mins: z.number().int().min(1).max(43200).optional(),
  resolution_target_mins: z.number().int().min(1).max(43200).optional(),
  calendar_id: z.string().uuid().optional(),
  reminder_pct_first: z.number().int().min(1).max(98).optional(),
  reminder_pct_second: z.number().int().min(2).max(99).optional(),
  if_match_version: z.number().int().min(1),
}).strict().superRefine((val, ctx) => {
  const resMin = val.resolution_target_mins;
  const respMin = val.response_target_mins;
  if (resMin !== undefined && respMin !== undefined && resMin < respMin) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resolution_target_mins must be >= response_target_mins',
      path: ['resolution_target_mins'],
    });
  }
  const pctFirst = val.reminder_pct_first;
  const pctSecond = val.reminder_pct_second;
  if (pctFirst !== undefined && pctSecond !== undefined && pctFirst >= pctSecond) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'reminder_pct_first must be less than reminder_pct_second',
      path: ['reminder_pct_first'],
    });
  }
});

export type UpdatePolicyDto = z.infer<typeof UpdatePolicySchema>;

// ── Cursor pagination ─────────────────────────────────────────────────────────

export const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

export type ListQueryDto = z.infer<typeof ListQuerySchema>;

// ── Response shapes ───────────────────────────────────────────────────────────

export interface CalendarWindowResponse {
  id: string;
  weekday: number;
  start_local_time: string;
  end_local_time: string;
}

export interface CalendarHolidayResponse {
  id: string;
  holiday_date: string;
  label: string;
}

export interface CalendarResponse {
  id: string;
  name: string;
  calendar_type: string;
  timezone: string;
  is_active: boolean;
  windows: CalendarWindowResponse[];
  holidays: CalendarHolidayResponse[];
  updated_at: string;
}

export interface PolicyResponse {
  id: string;
  scope_type: string;
  scope_id: string | null;
  priority: string;
  response_target_mins: number;
  resolution_target_mins: number;
  calendar_id: string;
  reminder_pct_first: number;
  reminder_pct_second: number;
  is_active: boolean;
  targets_ratified: boolean;
  version: number;
  updated_at: string;
  updated_by: string;
}

export interface PagedResponse<T> {
  data: T[];
  next_cursor: string | null;
}
