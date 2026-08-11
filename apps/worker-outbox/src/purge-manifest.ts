/**
 * Retention purge manifest.
 *
 * Defines which tenant-scoped tables are subject to nightly physical deletion
 * once a ticket has exceeded its tenant-configured retention horizon.
 *
 * Purge order matters: derived tables (AI, comments) must be deleted before
 * the parent tickets row to satisfy referential integrity where FKs exist.
 * For ticket_ai_summaries and ticket_affected_areas the FK to tickets was
 * intentionally omitted (partitioned-table limitation; see migration 0060),
 * so these tables must be explicitly included in the purge manifest.
 */

export interface PurgeTarget {
  /** PostgreSQL table name. */
  readonly table: string;
  /** Column that holds the ticket FK. */
  readonly ticketIdColumn: string;
  /** Column that holds the tenant FK (for safe batch scoping). */
  readonly tenantIdColumn: string;
  /** Whether to use physical DELETE (true) or soft-delete (false). */
  readonly physicalDelete: boolean;
}

/**
 * Ordered list of tables to purge when a set of expired ticket IDs is
 * identified by the retention scheduler.
 *
 * Delete derived tables first, then the parent ticket rows last to avoid
 * FK violations where constraints do exist.
 */
export const PURGE_MANIFEST: readonly PurgeTarget[] = [
  // AI synthesis derived tables — no FK to tickets, must be explicit.
  {
    table: 'ticket_ai_summaries',
    ticketIdColumn: 'ticket_id',
    tenantIdColumn: 'tenant_id',
    physicalDelete: true,
  },
  {
    table: 'ticket_affected_areas',
    ticketIdColumn: 'ticket_id',
    tenantIdColumn: 'tenant_id',
    physicalDelete: true,
  },
  // Ticket comments — no FK to partitioned parent (documented exception).
  {
    table: 'ticket_comments',
    ticketIdColumn: 'ticket_id',
    tenantIdColumn: 'tenant_id',
    physicalDelete: true,
  },
  // Outbox events associated with the expired tickets.
  {
    table: 'outbox_events',
    ticketIdColumn: 'aggregate_id',
    tenantIdColumn: 'tenant_id',
    physicalDelete: true,
  },
  // Audit logs are retained per their own retention_policies row; the
  // retention scheduler checks audit_logs separately and this entry is a
  // safety net for tickets that have a shorter horizon than audit retention.
  {
    table: 'audit_logs',
    ticketIdColumn: 'resource_id',
    tenantIdColumn: 'tenant_id',
    physicalDelete: true,
  },
  // Parent ticket rows — deleted last.
  {
    table: 'tickets',
    ticketIdColumn: 'id',
    tenantIdColumn: 'tenant_id',
    physicalDelete: true,
  },
] as const;

/**
 * Returns the manifest entries that apply to AI-synthesis derived tables.
 * Used by the DataSubjectErasure orchestrator to scope AI erasure separately
 * from ticket deletion (erasure happens before retention horizon).
 */
export function aiPurgeTargets(): readonly PurgeTarget[] {
  return PURGE_MANIFEST.filter(
    (t) => t.table === 'ticket_ai_summaries' || t.table === 'ticket_affected_areas',
  );
}
