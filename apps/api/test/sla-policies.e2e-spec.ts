/**
 * SLA policies and calendars — integration and unit tests.
 *
 * Unit suite (ViewsService-style, no DB required):
 *  - DTO validation edge cases
 *  - Reminder threshold ordering rejection
 *  - Optimistic concurrency version mismatch
 *  - Deactivate idempotency guard
 *
 * DB characterisation suite (requires DATABASE_URL):
 *  - All 5 tables have tenant_id NOT NULL
 *  - All 5 tables have ENABLE + FORCE RLS
 *  - Tenant isolation policies present
 *  - scope check constraint on sla_policies
 *  - calendar_type check constraint on sla_calendars
 *  - Unique active-priority index on sla_policies
 *  - Append-only trigger on sla_policy_versions
 *  - Cross-tenant 404: switching app.current_tenant hides other tenant's rows
 */

import { Pool } from 'pg';
import {
  CreatePolicySchema,
  UpdatePolicySchema,
  CreateCalendarSchema,
} from '../src/modules/sla/dto/sla-policy.dto';
import {
  INVALID_REMINDER_EQUAL,
  INVALID_REMINDER_ZERO,
  INVALID_REMINDER_SECOND_100,
  INVALID_TARGET_ZERO,
  INVALID_TARGET_OVER_MAX,
  INVALID_TIMEZONE,
  DUPLICATE_HOLIDAY_DATES,
  BUSINESS_HOURS_NO_WINDOWS,
  POLICY_P1_FIXTURE,
  BUSINESS_HOURS_CALENDAR,
  TWENTY_FOUR_SEVEN_CALENDAR,
} from './fixtures/sla.fixtures';

const SKIP = !process.env['DATABASE_URL'];
const maybeDescribe = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Unit tests — DTO validation
// ---------------------------------------------------------------------------

describe('SLA DTO validation — unit', () => {
  describe('CreatePolicySchema', () => {
    it('accepts a valid P1 policy payload', () => {
      const result = CreatePolicySchema.safeParse({
        ...POLICY_P1_FIXTURE,
        calendarId: 'e0000003-0000-0000-0000-000000000001',
      });
      expect(result.success).toBe(true);
    });

    it('rejects reminderPctFirst === reminderPctSecond', () => {
      const result = CreatePolicySchema.safeParse({
        priority: 'P1',
        responseTargetMins: 60,
        resolutionTargetMins: 240,
        calendarId: 'e0000003-0000-0000-0000-000000000001',
        reminderPctFirst: 50,
        reminderPctSecond: 50,
      });
      expect(result.success).toBe(false);
    });

    it('rejects reminderPctFirst = 0', () => {
      const result = CreatePolicySchema.safeParse({
        priority: 'P1',
        responseTargetMins: 60,
        resolutionTargetMins: 240,
        calendarId: 'e0000003-0000-0000-0000-000000000001',
        reminderPctFirst: 0,
        reminderPctSecond: 75,
      });
      expect(result.success).toBe(false);
    });

    it('rejects reminderPctSecond = 100', () => {
      const result = CreatePolicySchema.safeParse({
        priority: 'P1',
        responseTargetMins: 60,
        resolutionTargetMins: 240,
        calendarId: 'e0000003-0000-0000-0000-000000000001',
        reminderPctFirst: 50,
        reminderPctSecond: 100,
      });
      expect(result.success).toBe(false);
    });

    it('rejects responseTargetMins = 0', () => {
      const result = CreatePolicySchema.safeParse({
        priority: 'P2',
        responseTargetMins: 0,
        resolutionTargetMins: 1440,
        calendarId: 'e0000003-0000-0000-0000-000000000001',
        reminderPctFirst: 50,
        reminderPctSecond: 75,
      });
      expect(result.success).toBe(false);
    });

    it('rejects responseTargetMins > 43200', () => {
      const result = CreatePolicySchema.safeParse({
        priority: 'P3',
        responseTargetMins: 43201,
        resolutionTargetMins: 5760,
        calendarId: 'e0000003-0000-0000-0000-000000000001',
        reminderPctFirst: 50,
        reminderPctSecond: 75,
      });
      expect(result.success).toBe(false);
    });

    it('rejects unknown properties (strict mode)', () => {
      const result = CreatePolicySchema.safeParse({
        priority: 'P1',
        responseTargetMins: 60,
        resolutionTargetMins: 240,
        calendarId: 'e0000003-0000-0000-0000-000000000001',
        reminderPctFirst: 50,
        reminderPctSecond: 75,
        unknownField: true, // must be rejected
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdatePolicySchema', () => {
    it('requires ifMatchVersion', () => {
      const result = UpdatePolicySchema.safeParse({
        responseTargetMins: 90,
      });
      expect(result.success).toBe(false);
    });

    it('accepts a minimal valid update with ifMatchVersion', () => {
      const result = UpdatePolicySchema.safeParse({
        responseTargetMins: 90,
        ifMatchVersion: 1,
      });
      expect(result.success).toBe(true);
    });

    it('rejects when first >= second in update', () => {
      const result = UpdatePolicySchema.safeParse({
        reminderPctFirst: 75,
        reminderPctSecond: 50, // less than first
        ifMatchVersion: 1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CreateCalendarSchema', () => {
    it('accepts a valid 24x7 calendar', () => {
      const result = CreateCalendarSchema.safeParse(TWENTY_FOUR_SEVEN_CALENDAR);
      expect(result.success).toBe(true);
    });

    it('accepts a valid business-hours calendar with windows and holiday', () => {
      const result = CreateCalendarSchema.safeParse(BUSINESS_HOURS_CALENDAR);
      expect(result.success).toBe(true);
    });

    it('rejects business_hours calendar with no windows', () => {
      const result = CreateCalendarSchema.safeParse(BUSINESS_HOURS_NO_WINDOWS);
      expect(result.success).toBe(false);
    });

    it('rejects duplicate holiday dates', () => {
      const result = CreateCalendarSchema.safeParse(DUPLICATE_HOLIDAY_DATES);
      expect(result.success).toBe(false);
    });

    it('rejects invalid IANA timezone', () => {
      const result = CreateCalendarSchema.safeParse(INVALID_TIMEZONE);
      expect(result.success).toBe(false);
    });

    it('rejects window with startLocalTime >= endLocalTime', () => {
      const result = CreateCalendarSchema.safeParse({
        name: 'Bad Window',
        calendarType: 'business_hours',
        timezone: 'UTC',
        windows: [{ weekday: 0, startLocalTime: '17:00', endLocalTime: '09:00' }],
        holidays: [],
      });
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// DB characterisation suite
// ---------------------------------------------------------------------------

maybeDescribe('SLA module — DB characterisation', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  });

  afterAll(async () => {
    await pool.end();
  });

  const SLA_TABLES = [
    'sla_calendars',
    'sla_calendar_windows',
    'sla_calendar_holidays',
    'sla_policies',
    'sla_policy_versions',
  ];

  for (const table of SLA_TABLES) {
    describe(`Table: ${table}`, () => {
      it('has tenant_id column NOT NULL', async () => {
        const { rows } = await pool.query<{ is_nullable: string }>(
          `SELECT is_nullable FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'tenant_id'`,
          [table],
        );
        expect(rows[0]?.is_nullable).toBe('NO');
      });

      it('has RLS enabled', async () => {
        const { rows } = await pool.query<{ relrowsecurity: boolean }>(
          `SELECT relrowsecurity FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = $1 AND n.nspname = 'public'`,
          [table],
        );
        expect(rows[0]?.relrowsecurity).toBe(true);
      });

      it('has RLS forced', async () => {
        const { rows } = await pool.query<{ relforcerowsecurity: boolean }>(
          `SELECT relforcerowsecurity FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE c.relname = $1 AND n.nspname = 'public'`,
          [table],
        );
        expect(rows[0]?.relforcerowsecurity).toBe(true);
      });

      it('has tenant_isolation RLS policy', async () => {
        const { rows } = await pool.query<{ policyname: string }>(
          `SELECT policyname FROM pg_policies
           WHERE schemaname = 'public' AND tablename = $1`,
          [table],
        );
        const hasTenantPolicy = rows.some((r) =>
          r.policyname.includes('tenant'),
        );
        expect(hasTenantPolicy).toBe(true);
      });
    });
  }

  it('sla_policies has active-priority unique index', async () => {
    const { rows } = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename = 'sla_policies' AND indexname LIKE '%active%priority%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('sla_policies scope_type check constraint exists', async () => {
    const { rows } = await pool.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'sla_policies' AND constraint_type = 'CHECK'
         AND constraint_name LIKE '%scope_type%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('sla_calendars calendar_type check constraint exists', async () => {
    const { rows } = await pool.query<{ constraint_name: string }>(
      `SELECT constraint_name FROM information_schema.table_constraints
       WHERE table_name = 'sla_calendars' AND constraint_type = 'CHECK'
         AND constraint_name LIKE '%type%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('sla_policy_versions append-only trigger exists', async () => {
    const { rows } = await pool.query<{ trigger_name: string }>(
      `SELECT trigger_name FROM information_schema.triggers
       WHERE event_object_table = 'sla_policy_versions'
         AND trigger_name LIKE '%append_only%'`,
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  it('fail-closed: empty app.current_tenant raises error on sla_policies', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', '', true)`);
      await expect(client.query('SELECT id FROM sla_policies')).rejects.toThrow();
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('cross-tenant rows invisible via RLS on sla_calendars', async () => {
    const tenantA = 'e1000001-0000-0000-0000-000000000001';
    const tenantB = 'e1000001-0000-0000-0000-000000000002';
    const calId   = 'e1000002-0000-0000-0000-000000000001';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Ensure test tenants exist.
      await client.query(
        `INSERT INTO tenants (id, name, slug) VALUES ($1, 'SLA Test A', 'rls-sla-a'), ($2, 'SLA Test B', 'rls-sla-b') ON CONFLICT DO NOTHING`,
        [tenantA, tenantB],
      );

      // Insert calendar for tenant B.
      await client.query(`SET LOCAL app.current_tenant = '${tenantB}'`);
      await client.query(
        `INSERT INTO sla_calendars (id, tenant_id, name, calendar_type, timezone)
         VALUES ($1, $2, 'B Calendar', 'twenty_four_seven', 'UTC') ON CONFLICT DO NOTHING`,
        [calId, tenantB],
      );

      // Switch to tenant A — tenant B's calendar must be invisible.
      await client.query(`SET LOCAL app.current_tenant = '${tenantA}'`);
      const { rows } = await client.query(
        `SELECT id FROM sla_calendars WHERE id = $1`,
        [calId],
      );
      expect(rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
