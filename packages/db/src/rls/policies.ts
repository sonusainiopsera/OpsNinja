/**
 * RLS policy SQL helpers — tickets module.
 *
 * Emits ENABLE + FORCE ROW LEVEL SECURITY and the tenant predicate policy DDL
 * for a given table name. Used by the 0018_tickets_core migration to keep
 * all tenant isolation DDL consistent.
 *
 * The USING expression casts to ::uuid so an empty or missing
 * app.current_tenant session variable raises an error rather than returning
 * all rows (fail-closed via invalid cast).
 */

/**
 * Returns the three DDL statements needed to lock down a table to the current
 * tenant session variable.
 */
export function tenantRlsDdl(tableName: string): string {
  return `
ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${tableName} FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_${tableName} ON ${tableName};
CREATE POLICY tenant_isolation_${tableName} ON ${tableName}
  USING  (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
`.trim();
}

/** Tables that belong to the tickets module. */
export const TICKETS_MODULE_TABLES = [
  'tickets',
  'ticket_comments',
  'ticket_attachments',
  'tags',
  'ticket_tags',
  'assignment_groups',
  'assignment_group_members',
  'ticket_status_history',
  'tenant_sequences',
] as const;

export type TicketsModuleTable = (typeof TICKETS_MODULE_TABLES)[number];
