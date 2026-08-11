/**
 * Fixture data for SLA policy and calendar integration tests.
 *
 * Two tenants, a 24x7 calendar, a business-hours calendar with a holiday and
 * DST-spanning window, and seed P1-P4 policies flagged as unratified defaults.
 */

export const SLA_FIXTURE_TENANT_A = '10000000-0000-0000-0000-000000000001';
export const SLA_FIXTURE_TENANT_B = '20000000-0000-0000-0000-000000000002';
export const SLA_FIXTURE_SYSTEM_USER = '30000000-0000-0000-0000-000000000003';

export const FIXTURE_CALENDAR_24X7 = {
  name: '24x7 Support',
  calendarType: 'twenty_four_seven' as const,
  timezone: 'UTC',
  windows: [],
  holidays: [],
};

export const FIXTURE_CALENDAR_BUSINESS_HOURS = {
  name: 'Business Hours (NY, DST-spanning)',
  calendarType: 'business_hours' as const,
  timezone: 'America/New_York',
  windows: [
    // Mon-Fri 09:00-17:00 New York time
    { weekday: 1, startLocalTime: '09:00:00', endLocalTime: '17:00:00' },
    { weekday: 2, startLocalTime: '09:00:00', endLocalTime: '17:00:00' },
    { weekday: 3, startLocalTime: '09:00:00', endLocalTime: '17:00:00' },
    { weekday: 4, startLocalTime: '09:00:00', endLocalTime: '17:00:00' },
    { weekday: 5, startLocalTime: '09:00:00', endLocalTime: '17:00:00' },
    // DST spring-forward gap: 2026-03-08 02:00 → 03:00 in New York
    // This window starts during the gap hour — intentionally included for SLA engine testing
    { weekday: 0, startLocalTime: '02:30:00', endLocalTime: '04:00:00' },
  ],
  holidays: [
    // New Year's Day (leap year 2028 not needed — 2026 is standard)
    { holidayDate: '2026-01-01', label: "New Year's Day" },
    // DST-adjacent holiday
    { holidayDate: '2026-07-04', label: 'Independence Day' },
  ],
};

export const FIXTURE_POLICIES_UNRATIFIED = [
  { priority: 'P1' as const, responseTargetMins: 15,  resolutionTargetMins: 240,  reminderPctFirst: 50, reminderPctSecond: 80,  targetsRatified: false },
  { priority: 'P2' as const, responseTargetMins: 60,  resolutionTargetMins: 480,  reminderPctFirst: 50, reminderPctSecond: 80,  targetsRatified: false },
  { priority: 'P3' as const, responseTargetMins: 240, resolutionTargetMins: 1440, reminderPctFirst: 60, reminderPctSecond: 85,  targetsRatified: false },
  { priority: 'P4' as const, responseTargetMins: 480, resolutionTargetMins: 2880, reminderPctFirst: 60, reminderPctSecond: 85,  targetsRatified: false },
];
