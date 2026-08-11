/**
 * Tenant collision matrix.
 *
 * Explicitly lists which natural keys are duplicated across tenant pairs to
 * prove that tenant predicates are required for correct data isolation.
 *
 * This config is consumed by both the generator (factories pick shared keys
 * from these lists) and the isolation test suite (assertions verify the same
 * natural key exists in multiple tenants and is NOT visible across them).
 *
 * If any test SELECTs across tenants and returns unexpected rows, the missing
 * predicate surfaces immediately.
 */

export interface CollisionMatrix {
  /**
   * Email local-parts shared across all tenants.
   * Each tenant gets a user with alice@example.com, bob@example.com, etc.
   */
  sharedEmailLocalParts: string[];

  /**
   * Ticket subjects shared across all tenants.
   * Same subject string exists in multiple tenants.
   */
  sharedTicketSubjects: string[];

  /**
   * Jira issue keys shared across tenant pairs (allowed at DB level as
   * the unique constraint is per (tenant_id, ticket_id)).
   */
  sharedJiraIssueKeys: string[];

  /**
   * Saved view names shared across all tenants.
   */
  sharedSavedViewNames: string[];

  /**
   * Organization names shared across all tenants.
   */
  sharedOrgNames: string[];
}

export const COLLISION_MATRIX: CollisionMatrix = {
  sharedEmailLocalParts: ['alice', 'bob', 'charlie', 'support', 'admin'],
  sharedTicketSubjects: [
    'Cannot log in to portal',
    'Data export request',
    'Billing discrepancy',
    'Feature request: bulk export',
    'Password reset not received',
  ],
  sharedJiraIssueKeys: ['OPS-1', 'OPS-2', 'OPS-3', 'SUP-100', 'BUG-42'],
  sharedSavedViewNames: ['My Open Tickets', 'P1 Escalations', 'Unassigned'],
  sharedOrgNames: ['Acme Corp', 'Global Tech', 'Startup Inc'],
};

/** The three canonical tenant identifiers used throughout seeds and tests. */
export const SEED_TENANT_SLUGS = ['alpha-corp', 'beta-inc', 'gamma-llc'] as const;
export type SeedTenantSlug = (typeof SEED_TENANT_SLUGS)[number];
