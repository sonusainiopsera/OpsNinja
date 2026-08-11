/**
 * SLA module test fixtures — WO-044.
 *
 * Two tenants, sample calendars (24x7 and business-hours with DST-spanning
 * window and a holiday), and P1–P4 unratified policy defaults.
 */

// ---------------------------------------------------------------------------
// Deterministic UUIDs
// ---------------------------------------------------------------------------

export const SLA_FIXTURE_TENANT_A = 'e0000001-0000-0000-0000-000000000001';
export const SLA_FIXTURE_TENANT_B = 'e0000001-0000-0000-0000-000000000002';
export const SLA_FIXTURE_MANAGER  = 'e0000002-0000-0000-0000-000000000001';
export const SLA_FIXTURE_AGENT    = 'e0000002-0000-0000-0000-000000000002';

export const SLA_FIXTURE_CALENDAR_24x7 = 'e0000003-0000-0000-0000-000000000001';
export const SLA_FIXTURE_CALENDAR_BIZ  = 'e0000003-0000-0000-0000-000000000002';

// ---------------------------------------------------------------------------
// Calendar fixtures
// ---------------------------------------------------------------------------

export const TWENTY_FOUR_SEVEN_CALENDAR = {
  name: '24×7 Support',
  calendarType: 'twenty_four_seven' as const,
  timezone: 'UTC',
  windows: [],
  holidays: [],
};

export const BUSINESS_HOURS_CALENDAR = {
  name: 'Business Hours NYC (EST)',
  calendarType: 'business_hours' as const,
  timezone: 'America/New_York',
  // Mon–Fri 09:00–17:00 — DST-spanning window (America/New_York observes DST)
  windows: [
    { weekday: 0, startLocalTime: '09:00', endLocalTime: '17:00' },
    { weekday: 1, startLocalTime: '09:00', endLocalTime: '17:00' },
    { weekday: 2, startLocalTime: '09:00', endLocalTime: '17:00' },
    { weekday: 3, startLocalTime: '09:00', endLocalTime: '17:00' },
    { weekday: 4, startLocalTime: '09:00', endLocalTime: '17:00' },
  ],
  // US Thanksgiving (last Thursday of November)
  holidays: [
    { holidayDate: '2026-11-26', label: 'US Thanksgiving 2026' },
  ],
};

// ---------------------------------------------------------------------------
// Policy fixtures (unratified defaults)
// ---------------------------------------------------------------------------

export const POLICY_P1_FIXTURE = {
  scopeType: 'tenant' as const,
  scopeId: null,
  priority: 'P1' as const,
  responseTargetMins: 60,
  resolutionTargetMins: 240,
  reminderPctFirst: 50,
  reminderPctSecond: 75,
};

export const POLICY_P2_FIXTURE = {
  scopeType: 'tenant' as const,
  scopeId: null,
  priority: 'P2' as const,
  responseTargetMins: 240,
  resolutionTargetMins: 1440,
  reminderPctFirst: 50,
  reminderPctSecond: 75,
};

export const POLICY_P3_FIXTURE = {
  scopeType: 'tenant' as const,
  scopeId: null,
  priority: 'P3' as const,
  responseTargetMins: 480,
  resolutionTargetMins: 5760,
  reminderPctFirst: 50,
  reminderPctSecond: 75,
};

export const POLICY_P4_FIXTURE = {
  scopeType: 'tenant' as const,
  scopeId: null,
  priority: 'P4' as const,
  responseTargetMins: 2880,
  resolutionTargetMins: 14400,
  reminderPctFirst: 50,
  reminderPctSecond: 75,
};

// ---------------------------------------------------------------------------
// Invalid fixtures (for rejection tests)
// ---------------------------------------------------------------------------

export const INVALID_REMINDER_EQUAL = {
  priority: 'P1' as const,
  responseTargetMins: 60,
  resolutionTargetMins: 240,
  reminderPctFirst: 50,
  reminderPctSecond: 50, // must be > first
  ifMatchVersion: 1,
};

export const INVALID_REMINDER_ZERO = {
  priority: 'P1' as const,
  responseTargetMins: 60,
  resolutionTargetMins: 240,
  reminderPctFirst: 0, // must be > 0
  reminderPctSecond: 75,
  ifMatchVersion: 1,
};

export const INVALID_REMINDER_SECOND_100 = {
  priority: 'P1' as const,
  responseTargetMins: 60,
  resolutionTargetMins: 240,
  reminderPctFirst: 50,
  reminderPctSecond: 100, // must be < 100
  ifMatchVersion: 1,
};

export const INVALID_TARGET_ZERO = {
  priority: 'P2' as const,
  responseTargetMins: 0, // must be >= 1
  resolutionTargetMins: 1440,
  reminderPctFirst: 50,
  reminderPctSecond: 75,
  ifMatchVersion: 1,
};

export const INVALID_TARGET_OVER_MAX = {
  priority: 'P3' as const,
  responseTargetMins: 43201, // must be <= 43200
  resolutionTargetMins: 5760,
  reminderPctFirst: 50,
  reminderPctSecond: 75,
  ifMatchVersion: 1,
};

export const INVALID_TIMEZONE = {
  name: 'Bad TZ Calendar',
  calendarType: 'business_hours' as const,
  timezone: 'NotARealTimezone/Nope',
  windows: [{ weekday: 1, startLocalTime: '09:00', endLocalTime: '17:00' }],
  holidays: [],
};

export const DUPLICATE_HOLIDAY_DATES = {
  name: 'Dup Holidays',
  calendarType: 'twenty_four_seven' as const,
  timezone: 'UTC',
  windows: [],
  holidays: [
    { holidayDate: '2026-01-01', label: 'New Year 1' },
    { holidayDate: '2026-01-01', label: 'New Year 2' }, // duplicate
  ],
};

export const BUSINESS_HOURS_NO_WINDOWS = {
  name: 'No Windows',
  calendarType: 'business_hours' as const,
  timezone: 'UTC',
  windows: [], // must have at least one window
  holidays: [],
};
