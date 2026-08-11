/**
 * System view seeder — WO-039.
 *
 * Creates the four immutable system views for a tenant if they do not already
 * exist. Uses INSERT ... ON CONFLICT DO NOTHING (idempotent) keyed on the
 * (tenant_id, slug) unique constraint, so re-running never duplicates rows.
 *
 * Placeholder tokens in filter_ast:
 *   CURRENT_USER        — substituted with the requesting user's UUID at read time.
 *   CURRENT_ORG_SCOPE   — substituted with the requesting agent's org scope IDs at read time.
 *
 * These tokens allow a single stored definition to serve every agent correctly.
 */

import { savedViews } from '@opsninja/db';
import type { TxHandle } from '@opsninja/db';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// System view definitions
// ---------------------------------------------------------------------------

interface SystemViewDef {
  slug: string;
  name: string;
  filterAst: unknown;
  sortSpec: Array<{ field: string; direction: 'asc' | 'desc' }>;
  columns: string[];
}

const SYSTEM_VIEW_DEFS: SystemViewDef[] = [
  {
    slug: 'all-open-tickets',
    name: 'All Open Tickets',
    filterAst: {
      op: 'and',
      conditions: [
        { field: 'status', operator: 'in', value: ['open', 'in_progress', 'pending'] },
      ],
    },
    sortSpec: [{ field: 'created_at', direction: 'desc' }],
    columns: ['subject', 'status', 'priority', 'organization', 'assignee', 'sla_state', 'created_at'],
  },
  {
    slug: 'my-assigned-tickets',
    name: 'My Assigned Tickets',
    filterAst: {
      op: 'and',
      conditions: [
        { field: 'status', operator: 'in', value: ['open', 'in_progress', 'pending'] },
        // CURRENT_USER token — substituted at read time with the requesting user's UUID.
        { field: 'assignee_user_id', operator: 'eq', value: 'CURRENT_USER' },
      ],
    },
    sortSpec: [{ field: 'priority', direction: 'asc' }],
    columns: ['subject', 'status', 'priority', 'organization', 'sla_state', 'updated_at'],
  },
  {
    slug: 'recently-closed-tickets',
    name: 'Recently Closed Tickets',
    filterAst: {
      op: 'and',
      conditions: [
        { field: 'status', operator: 'in', value: ['resolved', 'closed'] },
        { field: 'resolved_at', operator: 'gte', value: 'LAST_7_DAYS' },
      ],
    },
    sortSpec: [{ field: 'resolved_at', direction: 'desc' }],
    columns: ['subject', 'status', 'priority', 'organization', 'assignee', 'resolved_at'],
  },
  {
    slug: 'approaching-sla-breach',
    name: 'Approaching SLA Breach',
    filterAst: {
      op: 'and',
      conditions: [
        { field: 'status', operator: 'in', value: ['open', 'in_progress', 'pending'] },
        { field: 'sla_state', operator: 'in', value: ['warning', 'breached'] },
      ],
    },
    sortSpec: [{ field: 'sla_state', direction: 'asc' }],
    columns: ['subject', 'priority', 'organization', 'sla_state', 'assignee', 'created_at'],
  },
];

// ---------------------------------------------------------------------------
// Seeder
// ---------------------------------------------------------------------------

/**
 * Seeds the four system views for the given tenant inside the supplied
 * Drizzle transaction. Safe to call multiple times — uses ON CONFLICT DO NOTHING.
 */
export async function seedSystemViews(
  tx: TxHandle,
  tenantId: string,
): Promise<void> {
  for (const def of SYSTEM_VIEW_DEFS) {
    await tx
      .insert(savedViews)
      .values({
        tenantId,
        ownerUserId: null,
        name: def.name,
        filterAst: def.filterAst,
        sortSpec: def.sortSpec,
        columns: def.columns,
        scope: 'system',
        isActive: true,
        slug: def.slug,
      })
      .onConflictDoNothing({ target: sql`(tenant_id, slug) WHERE slug IS NOT NULL` });
  }
}

export { SYSTEM_VIEW_DEFS };
