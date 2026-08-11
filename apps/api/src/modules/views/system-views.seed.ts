import { Injectable } from '@nestjs/common';
import { type FilterAst } from '@opsninja/filter-compiler';
import { computeSignature } from '@opsninja/filter-compiler';
import { ViewsRepository } from './views.repository';

export interface SystemViewDefinition {
  name: string;
  filterAst: FilterAst;
  sortSpec: { field: string; direction: 'asc' | 'desc' }[];
  columns: string[];
}

export const SYSTEM_VIEW_DEFINITIONS: SystemViewDefinition[] = [
  {
    name: 'All Open Tickets',
    filterAst: {
      type: 'group',
      op: 'AND',
      children: [
        { type: 'condition', field: 'status', operator: 'in', value: ['open', 'pending'] },
      ],
    } as FilterAst,
    sortSpec: [{ field: 'created_at', direction: 'desc' }],
    columns: ['ticket_number', 'subject', 'status', 'priority', 'assignee', 'organization', 'created_at'],
  },
  {
    name: 'My Assigned Tickets',
    filterAst: {
      type: 'group',
      op: 'AND',
      children: [
        { type: 'condition', field: 'assignee_id', operator: 'eq', value: 'CURRENT_USER' },
        { type: 'condition', field: 'status', operator: 'in', value: ['open', 'pending'] },
      ],
    } as FilterAst,
    sortSpec: [{ field: 'updated_at', direction: 'desc' }],
    columns: ['ticket_number', 'subject', 'status', 'priority', 'organization', 'updated_at'],
  },
  {
    name: 'Recently Closed Tickets',
    filterAst: {
      type: 'group',
      op: 'AND',
      children: [
        { type: 'condition', field: 'status', operator: 'eq', value: 'closed' },
      ],
    } as FilterAst,
    sortSpec: [{ field: 'updated_at', direction: 'desc' }],
    columns: ['ticket_number', 'subject', 'status', 'assignee', 'organization', 'updated_at'],
  },
  {
    name: 'Approaching SLA Breach',
    filterAst: {
      type: 'group',
      op: 'AND',
      children: [
        { type: 'condition', field: 'status', operator: 'in', value: ['open', 'pending'] },
        { type: 'condition', field: 'sla_state', operator: 'eq', value: 'at_risk' },
      ],
    } as FilterAst,
    sortSpec: [{ field: 'sla_breach_at', direction: 'asc' }],
    columns: ['ticket_number', 'subject', 'status', 'priority', 'assignee', 'sla_breach_at', 'sla_state'],
  },
];

export const SYSTEM_VIEW_NAMES = SYSTEM_VIEW_DEFINITIONS.map((d) => d.name);

@Injectable()
export class SystemViewsSeeder {
  constructor(private readonly repo: ViewsRepository) {}

  /**
   * Idempotently seeds system views for the current tenant.
   * Must be called inside an active tenant transaction.
   */
  async seed(tenantId: string): Promise<void> {
    const existing = await this.repo.findSystemViewsBySlug(SYSTEM_VIEW_NAMES);
    const existingNames = new Set(existing.map((v) => v.name));

    for (const def of SYSTEM_VIEW_DEFINITIONS) {
      if (existingNames.has(def.name)) continue;

      await this.repo.create({
        tenantId,
        ownerUserId: null,
        name: def.name,
        filterAst: def.filterAst,
        sortSpec: def.sortSpec,
        columns: def.columns,
        scope: 'system',
        isActive: true,
        astSignature: computeSignature(def.filterAst),
      });
    }
  }
}
