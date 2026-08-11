/**
 * @opsninja/test-seed — public API.
 *
 * Exports all factory functions, the seed runner, validator, and profile configs
 * so test suites can import them directly without going through the CLI.
 */

// Core
export { SeededRandom } from './prng';
export { PROFILES, type Profile, type SeedProfile } from './profiles';
export { COLLISION_MATRIX, SEED_TENANT_SLUGS, type SeedTenantSlug } from './collision-matrix';
export { buildPartitionWindow, spreadAcrossPartitions, pickPartitionDate, type PartitionWindow } from './partition-dates';

// Factories (pure, no DB)
export { buildTenants, type TenantSeed } from './factories/tenant.factory';
export { buildOrganizations, type OrgSeed } from './factories/organization.factory';
export { buildUsers, ALLOWED_EMAIL_DOMAINS, STAFF_ROLES, type UserSeed } from './factories/user.factory';
export { buildTickets, TICKET_STATUSES, TICKET_PRIORITIES, type TicketSeed } from './factories/ticket.factory';
export { buildComments, type CommentSeed } from './factories/comment.factory';
export { buildAuditLogs, type AuditLogSeed } from './factories/audit-log.factory';

// Persistence shell
export { SeedRunner, type SeedManifest, type SeedOptions } from './persistence/seed-runner';

// Validation
export { AnonymisationValidator, type ValidationResult, type ValidationViolation } from './validation/anonymisation-validator';
