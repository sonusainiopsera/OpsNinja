/**
 * Performance dataset configuration.
 *
 * All performance runs use a fixed seed so numbers are comparable across
 * releases.  The LARGE_FRACTION env var controls year-1 volume fraction
 * (default 0.05 = 5%, i.e. 60k tickets across tenants).  CI peak runs use
 * LARGE_FRACTION=0.1; staging gate runs use LARGE_FRACTION=1.0.
 *
 * Three synthetic tenants are seeded:
 *   tenant-perf-a  — normal load, 200 orgs, 200 users
 *   tenant-perf-b  — noisy-neighbour: 1 org with disproportionately large data
 *   tenant-perf-c  — empty tenant (ensures empty-tenant fast paths are covered)
 */

/** Fixed seed for reproducible dataset generation. */
export const PERF_SEED = 0xdeadbeef;

/** Tenant slugs used in performance runs. */
export const PERF_TENANTS = {
  normal: 'tenant-perf-a',
  noisyNeighbour: 'tenant-perf-b',
  empty: 'tenant-perf-c',
} as const;

/**
 * Year-1 volume fraction consumed from env, defaulting to 0.05 (5%).
 * Full-scale staging runs set LARGE_FRACTION=1.0.
 */
export const LARGE_FRACTION = parseFloat(process.env['LARGE_FRACTION'] ?? '0.05');

/** Base year-1 volumes at 100%. Matches PROFILES.large in @opsninja/test-seed. */
export const YEAR1_VOLUMES = {
  ticketsPerTenant: 400_000,
  commentsPerTicket: 8,
  auditLogsPerTenant: 8_000_000,
} as const;

/** Effective ticket count at the configured fraction. */
export const EFFECTIVE_TICKET_COUNT = Math.ceil(
  YEAR1_VOLUMES.ticketsPerTenant * LARGE_FRACTION,
);

/**
 * Minimum partition span: 14 months back so tickets span multiple monthly
 * partitions, ensuring partition pruning is exercised realistically.
 */
export const PARTITION_MONTHS_BACK = 14;

/** Agent user prefix in seeded dataset for authentication. */
export const AGENT_USER_EMAIL_PREFIX = 'agent';
/** Portal user prefix in seeded dataset for authentication. */
export const PORTAL_USER_EMAIL_PREFIX = 'portal';
/** Seeded user password (synthetic environment only). */
export const SEEDED_USER_PASSWORD = 'PerfTest!2024#Seed';

/**
 * Wide-scope agent: belongs to an org set spanning all 200 orgs in tenant-perf-a.
 * Models the "org scope wider predicate" edge case (AC: wide predicate mix).
 */
export const WIDE_SCOPE_AGENT_EMAIL = `agent-wide@${PERF_TENANTS.normal}.perf.local`;
