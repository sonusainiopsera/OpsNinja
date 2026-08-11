/**
 * Fixture saved-view definitions for use in queue, UI and integration tests.
 * These cover every supported filter field and operator combination.
 */

import type { NewSavedView } from '../../src/schema/saved-views';

export const FIXTURE_TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const FIXTURE_USER_ID   = '00000000-0000-0000-0000-000000000002';
export const FIXTURE_USER_B_ID = '00000000-0000-0000-0000-000000000003';

export const FIXTURE_VIEWS: NewSavedView[] = [
  // ── Status filters ────────────────────────────────────────────────────────
  {
    tenantId: FIXTURE_TENANT_ID,
    ownerUserId: FIXTURE_USER_ID,
    name: 'Open Tickets',
    filterAst: { type: 'group', op: 'AND', children: [{ type: 'condition', field: 'status', operator: 'eq', value: 'open' }] },
    sortSpec: [{ field: 'created_at', direction: 'desc' }],
    columns: ['ticket_number', 'subject', 'status', 'assignee'],
    scope: 'private',
    isActive: true,
    astSignature: '',
  },
  {
    tenantId: FIXTURE_TENANT_ID,
    ownerUserId: FIXTURE_USER_ID,
    name: 'Multi-Status View',
    filterAst: { type: 'group', op: 'AND', children: [{ type: 'condition', field: 'status', operator: 'in', value: ['open', 'pending'] }] },
    sortSpec: [{ field: 'priority', direction: 'asc' }],
    columns: ['ticket_number', 'subject', 'status', 'priority'],
    scope: 'private',
    isActive: true,
    astSignature: '',
  },
  // ── Priority filter ───────────────────────────────────────────────────────
  {
    tenantId: FIXTURE_TENANT_ID,
    ownerUserId: FIXTURE_USER_ID,
    name: 'Urgent Tickets',
    filterAst: { type: 'group', op: 'AND', children: [{ type: 'condition', field: 'priority', operator: 'eq', value: 'urgent' }] },
    sortSpec: [{ field: 'created_at', direction: 'asc' }],
    columns: ['ticket_number', 'subject', 'priority', 'assignee', 'sla_breach_at'],
    scope: 'private',
    isActive: true,
    astSignature: '',
  },
  // ── Assignee placeholder ──────────────────────────────────────────────────
  {
    tenantId: FIXTURE_TENANT_ID,
    ownerUserId: FIXTURE_USER_ID,
    name: 'My Tickets (placeholder)',
    filterAst: { type: 'group', op: 'AND', children: [{ type: 'condition', field: 'assignee_id', operator: 'eq', value: 'CURRENT_USER' }] },
    sortSpec: [],
    columns: ['ticket_number', 'subject', 'status'],
    scope: 'private',
    isActive: true,
    astSignature: '',
  },
  // ── Organization scope placeholder ────────────────────────────────────────
  {
    tenantId: FIXTURE_TENANT_ID,
    ownerUserId: FIXTURE_USER_ID,
    name: 'My Org Tickets (placeholder)',
    filterAst: { type: 'group', op: 'AND', children: [{ type: 'condition', field: 'organization_id', operator: 'in', value: 'CURRENT_ORG_SCOPE' }] },
    sortSpec: [],
    columns: ['ticket_number', 'subject', 'organization'],
    scope: 'private',
    isActive: true,
    astSignature: '',
  },
  // ── SLA / date range ──────────────────────────────────────────────────────
  {
    tenantId: FIXTURE_TENANT_ID,
    ownerUserId: FIXTURE_USER_ID,
    name: 'SLA At Risk',
    filterAst: {
      type: 'group', op: 'AND', children: [
        { type: 'condition', field: 'status', operator: 'in', value: ['open', 'pending'] },
        { type: 'condition', field: 'sla_state', operator: 'eq', value: 'at_risk' },
      ],
    },
    sortSpec: [{ field: 'sla_breach_at', direction: 'asc' }],
    columns: ['ticket_number', 'subject', 'sla_state', 'sla_breach_at', 'assignee'],
    scope: 'private',
    isActive: true,
    astSignature: '',
  },
  // ── Nested AND / OR ───────────────────────────────────────────────────────
  {
    tenantId: FIXTURE_TENANT_ID,
    ownerUserId: FIXTURE_USER_ID,
    name: 'Urgent Open or Pending Tickets',
    filterAst: {
      type: 'group', op: 'AND', children: [
        { type: 'condition', field: 'priority', operator: 'eq', value: 'urgent' },
        {
          type: 'group', op: 'OR', children: [
            { type: 'condition', field: 'status', operator: 'eq', value: 'open' },
            { type: 'condition', field: 'status', operator: 'eq', value: 'pending' },
          ],
        },
      ],
    },
    sortSpec: [{ field: 'created_at', direction: 'desc' }],
    columns: ['ticket_number', 'subject', 'status', 'priority'],
    scope: 'private',
    isActive: true,
    astSignature: '',
  },
  // ── Shared view (owned by user B) ─────────────────────────────────────────
  {
    tenantId: FIXTURE_TENANT_ID,
    ownerUserId: FIXTURE_USER_B_ID,
    name: 'Team Shared View',
    filterAst: { type: 'group', op: 'AND', children: [{ type: 'condition', field: 'status', operator: 'eq', value: 'open' }] },
    sortSpec: [],
    columns: ['ticket_number', 'subject', 'status', 'assignee'],
    scope: 'shared',
    isActive: true,
    astSignature: '',
  },
];
