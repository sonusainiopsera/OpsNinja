/**
 * @opsninja/test-seed – public API surface.
 *
 * Consumers import factories for unit tests (no DB needed) or
 * SeedRunner for integration/E2E test setup.
 */

// PRNG
export { SeededPrng } from './prng';

// Profiles
export { SMALL_PROFILE, LARGE_PROFILE, PROFILES, partitionWindow, partitionMonths } from './profiles';
export type { SeedProfile, ProfileName } from './profiles';

// Collision matrix
export { DEFAULT_COLLISION_MATRIX } from './collision-matrix';
export type { CollisionMatrix, TenantPair } from './collision-matrix';

// Factories (pure — no DB dependency)
export { buildTenants, buildOrganizations } from './factories/organizations.factory';
export type { SeedTenant, SeedOrganization } from './factories/organizations.factory';

export { buildStaffUsers, buildContacts } from './factories/users.factory';
export type { SeedUser, SeedContact, UserRole } from './factories/users.factory';

export { buildTickets } from './factories/tickets.factory';
export type { SeedTicket, TicketStatus, TicketPriority } from './factories/tickets.factory';

export { buildComments } from './factories/comments.factory';
export type { SeedComment } from './factories/comments.factory';

export { buildSlaPolicies, buildSlaTimers } from './factories/sla.factory';
export type { SeedSlaPolicy, SeedSlaTimer, SlaTimerStatus } from './factories/sla.factory';

export { buildJiraConnections, buildJiraLinks, buildJiraSyncEvents } from './factories/jira.factory';
export type { SeedJiraConnection, SeedJiraLink, SeedJiraSyncEvent } from './factories/jira.factory';

export { buildAuditLogs } from './factories/audit-logs.factory';
export type { SeedAuditLog } from './factories/audit-logs.factory';

// Validation
export { AnonymisationValidator } from './validation/anonymisation-validator';
export type { ValidationError } from './validation/anonymisation-validator';

// Persistence shell
export { SeedRunner } from './persistence/seed-runner';
export type { SeedRunnerOptions, SeedManifest } from './persistence/seed-runner';

// Partition provisioning SQL helper
export { buildPartitionSql, buildAllPartitionSql } from './persistence/partition-provisioner';
