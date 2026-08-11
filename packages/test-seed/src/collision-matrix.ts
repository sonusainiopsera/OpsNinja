/**
 * Tenant collision matrix – natural keys that are intentionally duplicated
 * across two or more tenants to verify that tenant predicates are required
 * for query correctness (i.e., any query without a tenant_id filter returns
 * rows for the wrong tenant).
 *
 * The isolation test suite imports this config to know which collisions to
 * assert against. The seed generator uses it to stamp the duplicate values
 * on the correct rows.
 */

export interface TenantPair {
  readonly tenantAIndex: number;
  readonly tenantBIndex: number;
}

export interface CollisionMatrix {
  /** tenant pairs that share contact email local-parts */
  readonly contactEmailLocalParts: ReadonlyArray<{ pair: TenantPair; localPart: string }>;
  /** tenant pairs that share ticket subjects */
  readonly ticketSubjects: ReadonlyArray<{ pair: TenantPair; subject: string }>;
  /** tenant pairs that share Jira issue keys */
  readonly jiraIssueKeys: ReadonlyArray<{ pair: TenantPair; issueKey: string }>;
  /** tenant pairs that share saved-view names */
  readonly savedViewNames: ReadonlyArray<{ pair: TenantPair; name: string }>;
}

/**
 * Default collision matrix for the small and large seed profiles.
 *
 * Indices refer to the tenants array in the generated seed dataset
 * (0-based: tenant-alpha=0, tenant-beta=1, tenant-gamma=2).
 */
export const DEFAULT_COLLISION_MATRIX: CollisionMatrix = {
  contactEmailLocalParts: [
    { pair: { tenantAIndex: 0, tenantBIndex: 1 }, localPart: 'john.doe' },
    { pair: { tenantAIndex: 0, tenantBIndex: 1 }, localPart: 'jane.smith' },
    { pair: { tenantAIndex: 1, tenantBIndex: 2 }, localPart: 'admin' },
  ],
  ticketSubjects: [
    { pair: { tenantAIndex: 0, tenantBIndex: 1 }, subject: 'Cannot access dashboard' },
    { pair: { tenantAIndex: 0, tenantBIndex: 2 }, subject: 'API rate limit exceeded' },
  ],
  jiraIssueKeys: [
    { pair: { tenantAIndex: 0, tenantBIndex: 1 }, issueKey: 'OPS-1' },
    { pair: { tenantAIndex: 0, tenantBIndex: 1 }, issueKey: 'OPS-2' },
    { pair: { tenantAIndex: 1, tenantBIndex: 2 }, issueKey: 'INFRA-1' },
  ],
  savedViewNames: [
    { pair: { tenantAIndex: 0, tenantBIndex: 1 }, name: 'My Open Tickets' },
    { pair: { tenantAIndex: 0, tenantBIndex: 2 }, name: 'P1 Breached' },
  ],
};
