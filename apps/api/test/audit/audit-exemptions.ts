/**
 * Audit Coverage Exemptions
 *
 * This file is the authoritative allow-list of write-capable repository/service
 * methods that are exempted from the @Auditable coverage requirement.
 *
 * Every entry must include a justification. CI will fail if an unlisted method
 * is missing @Auditable. Add entries here ONLY after a deliberate review.
 *
 * Format: `ClassName.methodName` — same key used by AuditCoverageRegistry.
 */

export interface AuditExemption {
  /** `ClassName.methodName` key. */
  key: string;
  /** Why this method is exempt from audit coverage. */
  reason: string;
}

export const AUDIT_EXEMPTIONS: AuditExemption[] = [
  // ---------------------------------------------------------------------------
  // Modules not yet implemented (will be addressed in their respective WOs)
  // ---------------------------------------------------------------------------
  {
    key: 'OrganizationRepository.create',
    reason: 'OrganizationRepository does not exist yet — pending future WO for organizations module.',
  },
  {
    key: 'OrganizationRepository.update',
    reason: 'OrganizationRepository does not exist yet — pending future WO for organizations module.',
  },
  {
    key: 'OrganizationRepository.deactivate',
    reason: 'OrganizationRepository does not exist yet — pending future WO for organizations module.',
  },
  {
    key: 'JiraConnectionRepository.create',
    reason: 'JiraConnectionRepository does not exist yet — pending Jira integration WO.',
  },
  {
    key: 'JiraConnectionRepository.update',
    reason: 'JiraConnectionRepository does not exist yet — pending Jira integration WO.',
  },
  {
    key: 'JiraFieldMappingRepository.upsert',
    reason: 'JiraFieldMappingRepository does not exist yet — pending Jira integration WO.',
  },
  {
    key: 'SlaConfigRepository.create',
    reason: 'SlaConfigRepository does not exist yet — pending SLA module WO.',
  },
  {
    key: 'SlaConfigRepository.update',
    reason: 'SlaConfigRepository does not exist yet — pending SLA module WO.',
  },
  // ViewsRepository.create/update/softDelete — implemented in WO-039 with @Auditable
  // ---------------------------------------------------------------------------
  // AuditService (auth events) — writes directly to audit_logs, not auditable itself
  // ---------------------------------------------------------------------------
  {
    key: 'AuditService.writeAuthEvent',
    reason: 'Auth-event writer that produces audit records; annotating it would be circular.',
  },
  // ---------------------------------------------------------------------------
  // WebhookEndpointsRepository — audit handled inline via writeAudit() in service layer
  // (pre-WO-093 pattern, will be migrated to @Auditable in a subsequent WO)
  // ---------------------------------------------------------------------------
  {
    key: 'WebhookEndpointsRepository.create',
    reason: 'Audit written inline in WebhookEndpointsService — migration to @Auditable deferred.',
  },
  {
    key: 'WebhookEndpointsRepository.update',
    reason: 'Audit written inline in WebhookEndpointsService — migration to @Auditable deferred.',
  },
  {
    key: 'WebhookEndpointsRepository.softDelete',
    reason: 'Audit written inline in WebhookEndpointsService — migration to @Auditable deferred.',
  },
];

/** Set of exempt keys for O(1) lookup. */
export const EXEMPT_KEYS = new Set(AUDIT_EXEMPTIONS.map((e) => e.key));
