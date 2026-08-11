/**
 * Seed profiles define the scale of generated data.
 *
 * - small: unit/integration test suite baseline (~seconds to generate)
 * - large: year-1 volume simulation (~minutes, configurable fraction)
 */

export type ProfileName = 'small' | 'large';

export interface SeedProfile {
  readonly name: ProfileName;
  /** Number of tenants to generate */
  readonly tenantCount: number;
  /** Organizations per tenant */
  readonly orgsPerTenant: number;
  /** Contacts per organization */
  readonly contactsPerOrg: number;
  /** Staff users per tenant */
  readonly staffPerTenant: number;
  /** Tickets total across all tenants */
  readonly ticketCount: number;
  /** Comments total across all tickets */
  readonly commentCount: number;
  /** created_at window in months back from now (negative = past) */
  readonly partitionWindowMonthsBack: number;
  /** created_at window in months forward from now */
  readonly partitionWindowMonthsForward: number;
  /** Fraction of large-volume totals (only used for large profile) */
  readonly scaleFraction?: number;
}

export const SMALL_PROFILE: SeedProfile = {
  name: 'small',
  tenantCount: 3,
  orgsPerTenant: 4,
  contactsPerOrg: 4,         // 3 × 4 × 4 = 48 ≥ 40 contacts
  staffPerTenant: 7,          // 3 × 7 = 21 ≥ 20 staff
  ticketCount: 400,
  commentCount: 3000,
  partitionWindowMonthsBack: 14,
  partitionWindowMonthsForward: 1,
};

export const LARGE_PROFILE: SeedProfile = {
  name: 'large',
  tenantCount: 10,
  orgsPerTenant: 20,
  contactsPerOrg: 10,
  staffPerTenant: 50,
  ticketCount: 12_000,        // 1% of 1.2M
  commentCount: 100_000,      // 1% of 10M
  partitionWindowMonthsBack: 14,
  partitionWindowMonthsForward: 1,
  scaleFraction: 0.01,
};

export const PROFILES: Record<ProfileName, SeedProfile> = {
  small: SMALL_PROFILE,
  large: LARGE_PROFILE,
};

/** Month range [start, end) as Date objects spanning the partition window. */
export function partitionWindow(profile: SeedProfile, now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  start.setMonth(start.getMonth() - profile.partitionWindowMonthsBack);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setMonth(end.getMonth() + profile.partitionWindowMonthsForward + 1);
  end.setDate(1);
  end.setHours(0, 0, 0, 0);

  return { start, end };
}

/**
 * Returns a list of distinct monthly partition labels (YYYY-MM) within the
 * window. Used to pre-create partitions before inserting rows.
 */
export function partitionMonths(profile: SeedProfile, now: Date): string[] {
  const { start, end } = partitionWindow(profile, now);
  const months: string[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    months.push(`${y}-${m}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}
