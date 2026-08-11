/**
 * Scale profiles for the test-seed generator.
 *
 * small  — fast unit/integration runs
 * medium — smoke-test scale
 * large  — year-1 volume fraction (configurable via LARGE_FRACTION env)
 */

export type Profile = 'small' | 'medium' | 'large';

export interface SeedProfile {
  name: Profile;
  tenantCount: number;
  orgsPerTenant: number;
  usersPerTenant: number;
  ticketsPerTenant: number;
  commentsPerTicket: number;
  auditLogsPerTenant: number;
  webhookEndpointsPerTenant: number;
  /** Months back from now for partition window start. */
  partitionWindowMonthsBack: number;
  /** Months forward from now for partition window end. */
  partitionWindowMonthsForward: number;
  /** Batch size for DB inserts. */
  batchSize: number;
}

/** Year-1 volumes at 100%. Use LARGE_FRACTION=0.01 for 1% runs. */
const YEAR1_BASE = {
  tickets: 1_200_000,
  comments: 10_000_000,
  auditLogs: 25_000_000,
};

const fraction = parseFloat(process.env['LARGE_FRACTION'] ?? '0.01');

export const PROFILES: Record<Profile, SeedProfile> = {
  small: {
    name: 'small',
    tenantCount: 3,
    orgsPerTenant: 4,
    usersPerTenant: 7,
    ticketsPerTenant: 135,      // ~400 total across 3 tenants
    commentsPerTicket: 7,       // ~3000 total across ~400 tickets
    auditLogsPerTenant: 100,
    webhookEndpointsPerTenant: 2,
    partitionWindowMonthsBack: 14,
    partitionWindowMonthsForward: 1,
    batchSize: 500,
  },
  medium: {
    name: 'medium',
    tenantCount: 3,
    orgsPerTenant: 20,
    usersPerTenant: 50,
    ticketsPerTenant: 5_000,
    commentsPerTicket: 8,
    auditLogsPerTenant: 10_000,
    webhookEndpointsPerTenant: 5,
    partitionWindowMonthsBack: 14,
    partitionWindowMonthsForward: 1,
    batchSize: 1_000,
  },
  large: {
    name: 'large',
    tenantCount: 3,
    orgsPerTenant: 200,
    usersPerTenant: 200,
    ticketsPerTenant: Math.ceil((YEAR1_BASE.tickets / 3) * fraction),
    commentsPerTicket: Math.ceil((YEAR1_BASE.comments / (YEAR1_BASE.tickets)) * 0.9),
    auditLogsPerTenant: Math.ceil((YEAR1_BASE.auditLogs / 3) * fraction),
    webhookEndpointsPerTenant: 10,
    partitionWindowMonthsBack: 14,
    partitionWindowMonthsForward: 2,
    batchSize: 2_000,
  },
};
