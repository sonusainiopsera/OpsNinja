import { CreatePolicySchema, UpdatePolicySchema, CreateCalendarSchema } from '../dto/sla.dto';

describe('SLA DTO validation', () => {
  // ── CreatePolicySchema ────────────────────────────────────────────────────

  describe('CreatePolicySchema', () => {
    const base = {
      priority: 'P1',
      response_target_mins: 15,
      resolution_target_mins: 240,
      calendar_id: 'cccc0000-0000-0000-0000-000000000003',
      reminder_pct_first: 50,
      reminder_pct_second: 80,
    };

    it('accepts a valid policy', () => {
      expect(() => CreatePolicySchema.parse(base)).not.toThrow();
    });

    it('rejects unknown properties (strict mode)', () => {
      expect(() => CreatePolicySchema.parse({ ...base, extra: 'field' })).toThrow();
    });

    it('rejects zero response_target_mins', () => {
      expect(() => CreatePolicySchema.parse({ ...base, response_target_mins: 0 })).toThrow();
    });

    it('rejects response_target_mins > 43200', () => {
      expect(() => CreatePolicySchema.parse({ ...base, response_target_mins: 43201 })).toThrow();
    });

    it('rejects resolution_target_mins < response_target_mins', () => {
      expect(() => CreatePolicySchema.parse({ ...base, resolution_target_mins: 10 })).toThrow();
    });

    it('rejects reminder_pct_first >= reminder_pct_second', () => {
      expect(() => CreatePolicySchema.parse({ ...base, reminder_pct_first: 80, reminder_pct_second: 80 })).toThrow();
    });

    it('rejects reminder_pct_first = 0', () => {
      expect(() => CreatePolicySchema.parse({ ...base, reminder_pct_first: 0 })).toThrow();
    });

    it('rejects reminder_pct_second = 100', () => {
      expect(() => CreatePolicySchema.parse({ ...base, reminder_pct_second: 100 })).toThrow();
    });

    it('rejects non-integer reminder percentages', () => {
      expect(() => CreatePolicySchema.parse({ ...base, reminder_pct_first: 50.5 })).toThrow();
    });

    it('rejects invalid priority', () => {
      expect(() => CreatePolicySchema.parse({ ...base, priority: 'P5' })).toThrow();
    });
  });

  // ── UpdatePolicySchema ────────────────────────────────────────────────────

  describe('UpdatePolicySchema', () => {
    it('requires if_match_version', () => {
      expect(() => UpdatePolicySchema.parse({ response_target_mins: 30 })).toThrow();
    });

    it('accepts a valid partial update with version', () => {
      expect(() => UpdatePolicySchema.parse({
        response_target_mins: 30,
        if_match_version: 2,
      })).not.toThrow();
    });

    it('rejects unknown properties (strict mode)', () => {
      expect(() => UpdatePolicySchema.parse({
        if_match_version: 1,
        unknown_field: 'x',
      })).toThrow();
    });
  });

  // ── CreateCalendarSchema ──────────────────────────────────────────────────

  describe('CreateCalendarSchema', () => {
    it('accepts a valid 24x7 calendar', () => {
      expect(() => CreateCalendarSchema.parse({
        name: '24x7',
        calendar_type: 'twenty_four_seven',
        timezone: 'UTC',
      })).not.toThrow();
    });

    it('rejects business_hours calendar with no windows', () => {
      expect(() => CreateCalendarSchema.parse({
        name: 'BH',
        calendar_type: 'business_hours',
        timezone: 'UTC',
        windows: [],
      })).toThrow();
    });

    it('accepts business_hours with at least one window', () => {
      expect(() => CreateCalendarSchema.parse({
        name: 'BH',
        calendar_type: 'business_hours',
        timezone: 'UTC',
        windows: [{ weekday: 1, start_local_time: '09:00', end_local_time: '17:00' }],
      })).not.toThrow();
    });

    it('rejects window where start >= end', () => {
      expect(() => CreateCalendarSchema.parse({
        name: 'BH',
        calendar_type: 'business_hours',
        timezone: 'UTC',
        windows: [{ weekday: 1, start_local_time: '17:00', end_local_time: '09:00' }],
      })).toThrow();
    });

    it('rejects weekday out of range', () => {
      expect(() => CreateCalendarSchema.parse({
        name: 'BH',
        calendar_type: 'business_hours',
        timezone: 'UTC',
        windows: [{ weekday: 7, start_local_time: '09:00', end_local_time: '17:00' }],
      })).toThrow();
    });

    it('rejects invalid timezone', () => {
      expect(() => CreateCalendarSchema.parse({
        name: 'BH',
        calendar_type: 'twenty_four_seven',
        timezone: 'Not/A/Real/Zone',
      })).toThrow();
    });

    it('rejects duplicate holiday dates in payload', () => {
      expect(() => CreateCalendarSchema.parse({
        name: 'BH',
        calendar_type: 'twenty_four_seven',
        timezone: 'UTC',
        holidays: [
          { holiday_date: '2026-01-01', label: 'NY1' },
          { holiday_date: '2026-01-01', label: 'NY2' },
        ],
      })).toThrow();
    });

    it('rejects unknown properties (strict mode)', () => {
      expect(() => CreateCalendarSchema.parse({
        name: 'BH',
        calendar_type: 'twenty_four_seven',
        timezone: 'UTC',
        extra_field: 'bad',
      })).toThrow();
    });
  });
});
